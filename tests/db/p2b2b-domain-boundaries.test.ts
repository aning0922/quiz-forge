import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  openTestDatabase,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import {
  domainFixture,
  acknowledgeDomainStop,
  domainSettledAttempt,
  hash,
  resetDomainDatabase,
} from "./p2b2b-domain-fixture";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
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
  validationKey,
  type ValidationRow,
} from "@/features/quizpack/validation/repository";
let db: TestDatabase;
let f: Awaited<ReturnType<typeof domainFixture>>;
beforeAll(async () => {
  db = await safe(openTestDatabase);
});
beforeEach(async () => {
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
async function rejected(work: () => PromiseLike<unknown>, expected = "23514") {
  let code: string | undefined;
  try {
    await work();
  } catch (e) {
    code = (e as { code?: string }).code;
  }
  expect(code).toBe(expected);
}
async function anotherImport(archiveSha256: string) {
  const importId = randomUUID();
  const productId = f.scope.productId;
  await safe(
    () =>
      db.admin
        .sql`INSERT INTO qf.quizpack_import(id,product_id,created_by,idempotency_key,request_fingerprint,expected_archive_sha256,expected_archive_bytes,target_kind,created_at,status,state_revision,updated_at,storage_condition,fence,attempts,actual_archive_sha256,actual_archive_bytes,archive_storage_key,received_at) VALUES(${importId},${productId},${f.auth.id},${randomUUID()},${hash("synthetic")},${archiveSha256},100,'new-draft',clock_timestamp(),'received',1,clock_timestamp(),'clean',0,'[]',${archiveSha256},100,${`imports/${importId}/archive.quizpack`},clock_timestamp())`,
  );
  const scope = { productId, importId };
  const binding = {
    ...f.binding,
    validationKey: validationKey({
      ...scope,
      archiveSha256,
      archiveBytes: 100,
      identitySha256: f.binding.identitySha256,
      archivePolicyVersion: f.binding.archivePolicyVersion,
      archivePolicySha256: f.binding.archivePolicySha256,
    }),
  };
  return { scope, binding };
}
describe("B2-2B SQL failure boundaries and current auth", () => {
  it("SQL accepts A prefix ordering a before a-cover", async () => {
    await resetDomainDatabase(db);
    f = await domainFixture(db, true);
    const accepted = await evidence((await claim()).row);
    expect(accepted.status).toBe("validated");
  });
  it("same archive becomes direct alias; alias target cannot become a chain", async () => {
    const accepted = await evidence((await claim()).row);
    let archiving = await beginArchiving(
      db.app,
      f.auth.credentials,
      f.scope,
      authority(accepted),
    );
    archiving = await acknowledgeDomainStop(db, f, archiving);
    const canonical = await completeValidation(
      db.app,
      f.auth.credentials,
      f.scope,
      { authority: authority(archiving), blobs: f.blobs, accountedBytes: 0 },
    );
    const next = await anotherImport(canonical.archive_sha256);
    const row = (
      await claimValidation(db.app, f.auth.credentials, next.scope, {
        expectedImportStateRevision: 1,
        expectedValidationKey: next.binding.validationKey,
        binding: next.binding,
        owner: f.owner,
      })
    ).row;
    const alias = await appendValidationEvidence(
      db.app,
      f.auth.credentials,
      next.scope,
      {
        authority: authority(row),
        projection: f.projection(row),
        mediaStop: "confirmed",
        candidate: f.candidate,
        outcome: "accepted",
        errorCode: null,
      },
    );
    expect(alias.identity_kind).toBe("alias");
    expect(alias.canonical_validation_id).toBe(canonical.id);
    let archivingAlias = await beginArchiving(
      db.app,
      f.auth.credentials,
      next.scope,
      authority(alias),
    );
    archivingAlias = await acknowledgeDomainStop(
      db,
      { ...f, scope: next.scope },
      archivingAlias,
    );
    const readyAlias = await completeValidation(
      db.app,
      f.auth.credentials,
      next.scope,
      {
        authority: authority(archivingAlias),
        blobs: f.blobs,
        accountedBytes: 0,
      },
    );
    expect(readyAlias.status).toBe("ready");
    const refs = await safe(
      () => db.admin.sql`SELECT source_validation_id FROM qf.product_asset`,
    );
    expect(refs).toHaveLength(4);
    expect(refs.every((r) => r.source_validation_id === canonical.id)).toBe(
      true,
    );
    await rejected(
      () =>
        db.admin
          .sql`UPDATE qf.quizpack_validation SET canonical_validation_id=${alias.id},identity_kind='alias',state_revision=state_revision+1 WHERE id=${canonical.id}`,
    );
  });
  it("cross-product import snapshot and immutable identity updates cannot be written", async () => {
    const row = (await claim()).row;
    await rejected(
      () =>
        db.app
          .sql`UPDATE qf.quizpack_validation SET identity_text='{}' WHERE id=${row.id}`,
      "42501",
    );
    await rejected(
      () =>
        db.admin
          .sql`UPDATE qf.quizpack_validation SET archive_sha256=${"b".repeat(64)},state_revision=state_revision+1 WHERE id=${row.id}`,
    );
    await rejected(
      () =>
        db.admin
          .sql`UPDATE qf.quizpack_validation SET product_id='foreign-product',state_revision=state_revision+1 WHERE id=${row.id}`,
    );
  });
  it("report redundancy/hash, UTF8 bytes and metadata controls budgets reject mutations", async () => {
    const row = (await claim()).row;
    const p = f.projection(row);
    const reports = [canonicalP1Json({ injected: true })];
    const [mismatch] = await safe(
      () =>
        db.admin.sql<
          { valid: boolean }[]
        >`SELECT qf.validation_evidence_valid(${p.evidenceText},${db.admin.sql.array(reports)},${p.metadataText},${p.attemptsControlText}) AS valid`,
    );
    expect(mismatch!.valid).toBe(false);
    const [oversize] = await safe(
      () =>
        db.admin.sql<
          { valid: boolean }[]
        >`SELECT qf.validation_evidence_valid(${p.evidenceText},${db.admin.sql.array(["é".repeat(131073)])},${p.metadataText},${p.attemptsControlText}) AS valid`,
    );
    expect(oversize!.valid).toBe(false);
    const [metadata] = await safe(
      () =>
        db.admin.sql<
          { valid: boolean }[]
        >`SELECT qf.validation_evidence_valid(${p.evidenceText},${db.admin.sql.array([...p.reportTexts])},${" ".repeat(65537)},${p.attemptsControlText}) AS valid`,
    );
    expect(metadata!.valid).toBe(false);
    const accepted = await evidence(row);
    await rejected(
      () =>
        db.admin
          .sql`UPDATE qf.quizpack_validation SET report_texts=${db.admin.sql.array([p.reportTexts[0]! + " "])},state_revision=state_revision+1 WHERE id=${accepted.id}`,
    );
  });
  it("blob/product_asset UPDATE DELETE TRUNCATE and direct trigger helpers are denied", async () => {
    await rejected(() => db.app.sql`UPDATE qf.asset_blob SET bytes=1`, "42501");
    await rejected(() => db.app.sql`DELETE FROM qf.product_asset`, "42501");
    await rejected(() => db.app.sql`TRUNCATE qf.quizpack_validation`, "42501");
    await rejected(() => db.app.sql`SELECT qf.protect_validation()`, "42501");
  });
  it("frozen resource declaration and fake blob dimensions cannot complete", async () => {
    const accepted = await evidence((await claim()).row);
    let archiving = await beginArchiving(
      db.app,
      f.auth.credentials,
      f.scope,
      authority(accepted),
    );
    archiving = await acknowledgeDomainStop(db, f, archiving);
    await expect(
      completeValidation(db.app, f.auth.credentials, f.scope, {
        authority: authority(archiving),
        blobs: f.blobs.map((b, i) =>
          i === 0 ? { ...b, width: b.width + 1 } : b,
        ),
        accountedBytes: 0,
      }),
    ).rejects.toThrow("STUDIO_UNAVAILABLE");
    const [facts] = await safe(
      () =>
        db.admin.sql<
          { n: number }[]
        >`SELECT count(*)::int n FROM qf.product_asset`,
    );
    expect(facts!.n).toBe(0);
  });
  it("same resource version with changed license is a recorded rejection", async () => {
    const accepted = await evidence((await claim()).row);
    let archiving = await beginArchiving(
      db.app,
      f.auth.credentials,
      f.scope,
      authority(accepted),
    );
    archiving = await acknowledgeDomainStop(db, f, archiving);
    await completeValidation(db.app, f.auth.credentials, f.scope, {
      authority: authority(archiving),
      blobs: f.blobs,
      accountedBytes: 0,
    });
    const content = JSON.parse(
      f.candidate.facts.canonicalContentText,
    ) as typeof f.candidate.facts.content;
    const manifest = JSON.parse(
      f.candidate.facts.canonicalManifestText,
    ) as typeof f.candidate.facts.manifest;
    // Independent synthetic DB fixture; no claim of executed P1 or physically received archive.
    const changedContent = {
      ...content,
      resources: content.resources.map((r, i) =>
        i === 0
          ? {
              ...r,
              license: {
                ...r.license,
                evidence: "Different synthetic license evidence",
              },
            }
          : r,
      ),
    };
    const contentText = canonicalP1Json(changedContent);
    const changedManifest = {
      ...manifest,
      packVersion: "1.0.1",
      files: manifest.files.map((f) =>
        f.path === "content.json"
          ? {
              ...f,
              bytes: Buffer.byteLength(contentText),
              sha256: hash(contentText),
            }
          : f,
      ),
    };
    const manifestText = canonicalP1Json(changedManifest);
    const archiveSha256 = hash(
      "Different synthetic archive for license conflict",
    );
    const next = await anotherImport(archiveSha256);
    const row = (
      await claimValidation(db.app, f.auth.credentials, next.scope, {
        expectedImportStateRevision: 1,
        expectedValidationKey: next.binding.validationKey,
        binding: next.binding,
        owner: f.owner,
      })
    ).row;
    const { sealCandidateResultEvidence } =
      await import("@/features/quizpack/server/validation/contracts");
    const { sealSupportedReport } =
      await import("@/features/quizpack/server/validation/report");
    const oldReport = f.result.evidence.report;
    if (oldReport.status !== "sealed") throw new Error("TEST_EVIDENCE_INVALID");
    const result = sealCandidateResultEvidence({
      outcome: "accepted",
      evidence: {
        ...f.result.evidence,
        input: {
          status: "snapshotted",
          archiveSha256,
          archiveBytes: 100,
          targetProductId: f.scope.productId,
        },
        report: sealSupportedReport({
          ...oldReport.value,
          archiveSha256,
          manifestSha256: hash(manifestText),
          contentSha256: hash(contentText),
        }),
      },
    });
    if (result.outcome !== "accepted") throw new Error("TEST_EVIDENCE_INVALID");
    const files = new Map(f.files);
    files.set("manifest.json", Buffer.from(manifestText));
    files.set("content.json", Buffer.from(contentText));
    const { issuePrivateCandidate } =
      await import("@/features/quizpack/server/validation/private-candidate");
    const facts = issuePrivateCandidate(result, files).facts;
    const assetSetText = canonicalP1Json({
      schemaVersion: "quizpack-candidate-asset-set.v1",
      productId: f.scope.productId,
      resources: facts.resources.map((r) => ({
        resourceId: r.declaration.id,
        resourceVersion: r.declaration.version,
        productId: r.declaration.productId,
        blobSha256: r.blobSha256,
        declarationSha256: r.declarationSha256,
      })),
    });
    const rejected = await appendValidationEvidence(
      db.app,
      f.auth.credentials,
      next.scope,
      {
        authority: authority(row),
        projection: f.projection(row, result),
        mediaStop: "confirmed",
        candidate: {
          facts: { ...facts, assetSetText },
          manifestSha256: hash(manifestText),
          contentSha256: hash(contentText),
        },
        outcome: "accepted",
        errorCode: null,
      },
    );
    expect(rejected.status).toBe("rejected");
    expect(rejected.last_error_code).toBe("RESOURCE_DECLARATION_CONFLICT");
    expect(rejected.identity_kind).toBe("canonical");
    expect(rejected.validated_at).not.toBe(null);
    const [refs] = await safe(
      () =>
        db.admin.sql<
          { n: number }[]
        >`SELECT count(*)::int n FROM qf.product_asset`,
    );
    expect(refs!.n).toBe(4);
  });
  it("unproved media remains held across recovery and disables retry", async () => {
    const row = (await claim()).row;
    const recovered = await recoverValidationClaim(
      db.app,
      f.auth.credentials,
      f.scope,
      {
        authority: authority(row),
        settledAttempts: [],
        accountedBytes: 0,
        storageCondition: "unknown",
        errorCode: "VALIDATION_RECOVERY_REQUIRED",
      },
    );
    expect(Number(recovered.reserved_bytes)).toBe(134283264);
    expect(parseValidationAttempts(recovered.attempts_text)[0]!.mediaStop).toBe(
      "unconfirmed",
    );
    expect(recovered.fence).toBe(2);
    await expect(
      retryValidationClaim(db.app, f.auth.credentials, f.scope, recovered.id, {
        expectedStateRevision: recovered.state_revision,
        binding: f.binding,
        owner: f.owner,
      }),
    ).rejects.toThrow("VALIDATION_RECOVERY_REQUIRED");
  });
  it("fresh disabled actor and archived Product block evidence before business writes", async () => {
    const row = (await claim()).row;
    await safe(
      () =>
        db.admin
          .sql`UPDATE qf.product SET archived_at=clock_timestamp(),metadata_revision=metadata_revision+1,updated_at=clock_timestamp() WHERE id=${f.scope.productId}`,
    );
    await expect(evidence(row)).rejects.toThrow("PRODUCT_ARCHIVED");
    await safe(
      () =>
        db.admin
          .sql`UPDATE qf.operator SET status='disabled',disabled_at=clock_timestamp() WHERE id=${f.auth.id}`,
    );
    await expect(evidence(row)).rejects.toThrow("UNAUTHENTICATED");
  });
  it("archive retry starts not-started and keeps accepted evidence byte-for-byte", async () => {
    const row = await acknowledgeDomainStop(
      db,
      f,
      await evidence((await claim()).row),
    );
    const recovered = await recoverValidationClaim(
      db.app,
      f.auth.credentials,
      f.scope,
      {
        authority: authority(row),
        settledAttempts: [domainSettledAttempt(row)],
        accountedBytes: 0,
        storageCondition: "clean",
        errorCode: null,
      },
    );
    expect(recovered.status).toBe("validated");
    expect(recovered.lease_until).toBe(null);
    const retry = await retryValidationClaim(
      db.app,
      f.auth.credentials,
      f.scope,
      row.id,
      {
        expectedStateRevision: recovered.state_revision,
        binding: f.binding,
        owner: f.owner,
      },
    );
    expect(parseValidationAttempts(retry.attempts_text)[1]!.kind).toBe(
      "archive",
    );
    expect(parseValidationAttempts(retry.attempts_text)[1]!.mediaStop).toBe(
      "not-started",
    );
    expect(retry.evidence_text).toBe(row.evidence_text);
    const controls = serializeValidationAttempts(
      parseValidationAttempts(retry.attempts_text).map((a, i) =>
        i === 1 ? { ...a, mediaStop: "unconfirmed" } : a,
      ),
    );
    await rejected(
      () =>
        db.admin
          .sql`UPDATE qf.quizpack_validation SET attempts_text=${controls},state_revision=state_revision+1 WHERE id=${row.id}`,
    );
  });
});
