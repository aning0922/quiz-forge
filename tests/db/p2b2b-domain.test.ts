import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  openTestDatabase,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import {
  domainFixture,
  resetDomainDatabase,
  acknowledgeDomainStop,
  domainSettledAttempt,
} from "./p2b2b-domain-fixture";
import {
  claimValidation,
  appendValidationEvidence,
  beginArchiving,
  completeValidation,
  recoverValidationClaim,
  retryValidationClaim,
} from "@/features/quizpack/validation/transactions";
import {
  parseValidationAttempts,
  serializeValidationAttempts,
} from "@/features/quizpack/validation/repository";
import type { ValidationRow } from "@/features/quizpack/validation/repository";
let db: TestDatabase;
let f: Awaited<ReturnType<typeof domainFixture>>;
beforeAll(async () => {
  db = await safe(openTestDatabase);
});
beforeEach(async () => {
  // D's dedicated instance contains synthetic rows only and no uploaded/validation/blob files.
  await resetDomainDatabase(db);
  f = await domainFixture(db);
});
afterAll(async () => {
  if (db) {
    await resetDomainDatabase(db);
    await db.close();
  }
});
const authority = (r: ValidationRow) => ({
  validationId: r.id,
  expectedStateRevision: r.state_revision,
  fence: r.fence,
  attemptId: r.current_attempt_id,
});
const claim = () =>
  claimValidation(db.app, f.auth.credentials, f.scope, {
    expectedImportStateRevision: 1,
    expectedValidationKey: f.binding.validationKey,
    binding: f.binding,
    owner: f.owner,
  });
const evidence = (r: ValidationRow) =>
  appendValidationEvidence(db.app, f.auth.credentials, f.scope, {
    authority: authority(r),
    projection: f.projection(r),
    mediaStop: "confirmed",
    candidate: f.candidate,
    outcome: "accepted",
    errorCode: null,
  });
const rejected = async (work: () => PromiseLike<unknown>) => {
  let code: string | undefined;
  try {
    await work();
  } catch (e) {
    code = (e as { code?: string }).code;
  }
  expect(code).toBeDefined();
};
describe("B2-2B actual PostgreSQL transactions and immutable boundaries", () => {
  it("atomically claims unconfirmed+held and exact replay ignores stale CAS without audit", async () => {
    const first = await claim();
    expect(first.created).toBe(true);
    expect(Number(first.row.reserved_bytes)).toBe(134283264);
    expect(parseValidationAttempts(first.row.attempts_text)[0]!.mediaStop).toBe(
      "unconfirmed",
    );
    const replay = await claimValidation(db.app, f.auth.credentials, f.scope, {
      expectedImportStateRevision: 123,
      expectedValidationKey: f.binding.validationKey,
      binding: { ...f.binding, identityText: "unavailable" },
      owner: f.owner,
    });
    expect(replay.created).toBe(false);
    expect(replay.row.id).toBe(first.row.id);
    const rows = await safe(
      () =>
        db.admin
          .sql`SELECT action FROM qf.audit_event WHERE target_kind='validation'`,
    );
    expect(rows).toHaveLength(1);
  });
  it("commits complete refs+ready+release+audit; recover replays ready without audit", async () => {
    const accepted = await evidence((await claim()).row);
    expect(accepted.identity_kind).toBe("canonical");
    let archiving = await beginArchiving(
      db.app,
      f.auth.credentials,
      f.scope,
      authority(accepted),
    );
    archiving = await acknowledgeDomainStop(db, f, archiving);
    const ready = await completeValidation(
      db.app,
      f.auth.credentials,
      f.scope,
      { authority: authority(archiving), blobs: f.blobs, accountedBytes: 0 },
    );
    expect(ready.status).toBe("ready");
    expect(Number(ready.reserved_bytes)).toBe(0);
    const refs = await safe(
      () => db.app.sql`SELECT resource_id FROM qf.product_asset`,
    );
    expect(refs).toHaveLength(4);
    expect(
      (
        await recoverValidationClaim(db.app, f.auth.credentials, f.scope, {
          authority: authority(archiving),
          settledAttempts: [],
          accountedBytes: 0,
          storageCondition: "clean",
          errorCode: null,
        })
      ).state_revision,
    ).toBe(ready.state_revision);
    const events = await safe(
      () =>
        db.app
          .sql`SELECT action FROM qf.audit_event WHERE action='validation_completed'`,
    );
    expect(events).toHaveLength(1);
  });
  it("recover increments fence without attempt; retry consumes exactly three and fourth fails", async () => {
    let row = (await claim()).row;
    for (let n = 1; n <= 3; n++) {
      row = await acknowledgeDomainStop(db, f, row, "not-started");
      row = await recoverValidationClaim(db.app, f.auth.credentials, f.scope, {
        authority: authority(row),
        settledAttempts: [domainSettledAttempt(row)],
        accountedBytes: 0,
        storageCondition: "clean",
        errorCode: "VALIDATION_CANCELLED",
      });
      expect(parseValidationAttempts(row.attempts_text)).toHaveLength(n);
      expect(row.fence).toBe(2 * n);
      if (n < 3)
        row = await retryValidationClaim(
          db.app,
          f.auth.credentials,
          f.scope,
          row.id,
          {
            expectedStateRevision: row.state_revision,
            binding: f.binding,
            owner: f.owner,
          },
        );
    }
    await expect(
      retryValidationClaim(db.app, f.auth.credentials, f.scope, row.id, {
        expectedStateRevision: row.state_revision,
        binding: f.binding,
        owner: f.owner,
      }),
    ).rejects.toThrow("VALIDATION_ATTEMPT_LIMIT");
  });
  it("same-fence lease clear is allowed, renewal and released resurrection are rejected", async () => {
    const row = await acknowledgeDomainStop(
      db,
      f,
      (await claim()).row,
      "not-started",
    );
    await rejected(
      () =>
        db.admin
          .sql`UPDATE qf.quizpack_validation SET lease_until=lease_until+interval '1 second',state_revision=state_revision+1 WHERE id=${row.id}`,
    );
    await safe(
      () =>
        db.admin
          .sql`UPDATE qf.quizpack_validation SET lease_until=NULL,status='retryable-failed',state_revision=state_revision+1 WHERE id=${row.id}`,
    );
    const attempts = parseValidationAttempts(row.attempts_text).map((a) => ({
      ...a,
      mediaStop: "not-started" as const,
      disposition: "released" as const,
    }));
    await safe(
      () =>
        db.admin
          .sql`UPDATE qf.quizpack_validation SET attempts_text=${serializeValidationAttempts(attempts)},reserved_bytes=0,state_revision=state_revision+1 WHERE id=${row.id}`,
    );
    await rejected(
      () =>
        db.admin
          .sql`UPDATE qf.quizpack_validation SET attempts_text=${serializeValidationAttempts(attempts.map((a) => ({ ...a, disposition: "held" })))},reserved_bytes=134283264,state_revision=state_revision+1 WHERE id=${row.id}`,
    );
  });
  it("non-null evidence with null hash is rejected; no-report empty array is valid", async () => {
    const row = (await claim()).row;
    const p = f.projection(row);
    await rejected(
      () =>
        db.admin
          .sql`UPDATE qf.quizpack_validation SET evidence_text=${p.evidenceText},report_texts=${db.admin.sql.array([...p.reportTexts])},evidence_metadata_text=${p.metadataText},state_revision=state_revision+1 WHERE id=${row.id}`,
    );
    const result = {
      outcome: "rejected",
      code: "AUTHORED_NOT_SUPPORTED",
      evidence: {
        ...f.result.evidence,
        report: { status: "not-run", reason: "BACKEND_POLICY_REJECTED" },
        policy: { status: "rejected", code: "AUTHORED_NOT_SUPPORTED" },
      },
    };
    const { canonicalP1Json } =
      await import("@/features/quizpack/v1/canonical");
    const { hash } = await import("./p2b2b-domain-fixture");
    const text = canonicalP1Json({
      schemaVersion: "quizpack-evidence-envelope.v1",
      attempts: [{ attempt: 1, result }],
    });
    await safe(
      () =>
        db.admin
          .sql`UPDATE qf.quizpack_validation SET status='rejected',evidence_text=${text},evidence_sha256=${hash(text)},report_texts='{}',evidence_metadata_text=${text},state_revision=state_revision+1 WHERE id=${row.id}`,
    );
  });
  it("deferred ready check rejects missing refs and source refs cannot commit partial", async () => {
    const row = await acknowledgeDomainStop(
      db,
      f,
      await evidence((await claim()).row),
    );
    const controls = serializeValidationAttempts(
      parseValidationAttempts(row.attempts_text).map((a) => ({
        ...a,
        disposition: "released",
      })),
    );
    await rejected(
      () =>
        db.admin
          .sql`UPDATE qf.quizpack_validation SET status='ready',ready_at=clock_timestamp(),lease_until=NULL,reserved_bytes=0,storage_condition='clean',attempts_text=${controls},state_revision=state_revision+1 WHERE id=${row.id}`,
    );
    const r = f.candidate.facts.resources[0]!;
    const d = r.declaration;
    await rejected(() =>
      db.admin.sql.begin(async (tx) => {
        await tx`INSERT INTO qf.asset_blob(sha256,bytes,media_type,width,height,frames,storage_key,created_at) VALUES(${r.blobSha256},${r.bytes},${d.mediaType},${d.width},${d.height},1,${`blobs/${r.blobSha256}.blob`},clock_timestamp())`;
        await tx`INSERT INTO qf.product_asset(product_id,resource_id,resource_version,blob_sha256,declaration_text,declaration_sha256,purpose,source_validation_id,created_at) VALUES(${f.scope.productId},${d.id},${d.version},${r.blobSha256},${r.canonicalDeclarationText},${r.declarationSha256},${d.purpose},${row.id},clock_timestamp())`;
      }),
    );
    const rows = await safe(
      () => db.admin.sql`SELECT sha256 FROM qf.asset_blob`,
    );
    expect(rows).toHaveLength(0);
  });
});
