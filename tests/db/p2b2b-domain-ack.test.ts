import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  openTestDatabase,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import {
  domainFixture,
  resetDomainDatabase,
  syntheticFileStopProof,
  acknowledgeDomainStop,
  domainSettledAttempt,
} from "./p2b2b-domain-fixture";
import {
  acknowledgeValidationFileStop,
  appendValidationEvidence,
  claimValidation,
  completeValidation,
  interruptValidation,
  recoverValidationClaim,
} from "@/features/quizpack/validation/transactions";
import {
  parseValidationAttempts,
  serializeValidationAttempts,
  type ValidationRow,
} from "@/features/quizpack/validation/repository";
let db: TestDatabase;
let f: Awaited<ReturnType<typeof domainFixture>>;
const authority = (r: ValidationRow) => ({
  validationId: r.id,
  expectedStateRevision: r.state_revision,
  fence: r.fence,
  attemptId: r.current_attempt_id,
});
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
const claim = async () =>
  (
    await claimValidation(db.app, f.auth.credentials, f.scope, {
      expectedImportStateRevision: 1,
      expectedValidationKey: f.binding.validationKey,
      binding: f.binding,
      owner: f.owner,
    })
  ).row;
const rejectsSql = async (fn: () => PromiseLike<unknown>) => {
  let code: string | undefined;
  try {
    await fn();
  } catch (e) {
    code = (e as { code?: string }).code;
  }
  expect(code).toBe("23514");
};
describe("durable validation files-and-media acknowledgement", () => {
  it("first evidence reserves the whole 8KiB controls budget through a 56KiB metadata cap", async () => {
    const row = await claim();
    const projection = f.projection(row);
    const padding = " ".repeat(
      57344 - Buffer.byteLength(projection.metadataText!, "utf8"),
    );
    await expect(
      appendValidationEvidence(db.app, f.auth.credentials, f.scope, {
        authority: authority(row),
        projection: {
          ...projection,
          metadataText: projection.metadataText + padding + " ",
        },
        mediaStop: "confirmed",
        candidate: f.candidate,
        outcome: "accepted",
        errorCode: null,
      }),
    ).rejects.toThrow("EVIDENCE_INVALID");
    const accepted = await appendValidationEvidence(
      db.app,
      f.auth.credentials,
      f.scope,
      {
        authority: authority(row),
        projection,
        mediaStop: "confirmed",
        candidate: f.candidate,
        outcome: "accepted",
        errorCode: null,
      },
    );
    await safe(
      () =>
        db.app
          .sql`UPDATE qf.quizpack_validation SET evidence_metadata_text=${projection.metadataText + padding},state_revision=state_revision+1 WHERE id=${accepted.id}`,
    );
    await rejectsSql(
      () =>
        db.app
          .sql`UPDATE qf.quizpack_validation SET evidence_metadata_text=${projection.metadataText + padding + " "},state_revision=state_revision+1 WHERE id=${accepted.id}`,
    );
  });
  it("ACK changes only proof, media stop, revision and audit; exact replay is read-only", async () => {
    const row = await claim();
    const proof = syntheticFileStopProof(row, "not-started");
    const acknowledged = await acknowledgeValidationFileStop(
      db.app,
      f.auth.credentials,
      f.scope,
      { authority: authority(row), proof },
    );
    expect(acknowledged.state_revision).toBe(row.state_revision + 1);
    expect(acknowledged.status).toBe(row.status);
    expect(acknowledged.fence).toBe(row.fence);
    expect(acknowledged.lease_until).toEqual(row.lease_until);
    expect(acknowledged.reserved_bytes).toBe(row.reserved_bytes);
    expect(acknowledged.accounted_bytes).toBe(row.accounted_bytes);
    expect(
      parseValidationAttempts(acknowledged.attempts_text)[0]!.disposition,
    ).toBe("held");
    const replay = await acknowledgeValidationFileStop(
      db.app,
      f.auth.credentials,
      f.scope,
      { authority: authority(row), proof },
    );
    expect(replay.state_revision).toBe(acknowledged.state_revision);
    const events = await safe(
      () =>
        db.app
          .sql`SELECT id FROM qf.audit_event WHERE action='validation_file_stop_acknowledged'`,
    );
    expect(events).toHaveLength(1);
    await expect(
      acknowledgeValidationFileStop(db.app, f.auth.credentials, f.scope, {
        authority: authority(acknowledged),
        proof: { ...proof, receiptSha256: "b".repeat(64) },
      }),
    ).rejects.toThrow("VALIDATION_STORAGE_CONFLICT");
  });
  it("wrong row, owner, attempt, fence, protocol and unknown fields never become an ACK", async () => {
    const row = await claim();
    const proof = syntheticFileStopProof(row, "not-started");
    const mutations = [
      { validationId: randomUUID() },
      { attemptId: randomUUID() },
      { ownerNonce: "b".repeat(43) },
      { ownerPid: proof.ownerPid + 1 },
      { fence: proof.fence + 1 },
      { protocol: "files-and-media.v1" },
      { untrusted: true },
    ];
    for (const mutation of mutations) {
      const controls = JSON.parse(row.attempts_text);
      controls[0].mediaStop = "not-started";
      controls[0].fileStopProof = { ...proof, ...mutation };
      await rejectsSql(
        () =>
          db.app
            .sql`UPDATE qf.quizpack_validation SET attempts_text=${JSON.stringify(controls)},state_revision=state_revision+1 WHERE id=${row.id}`,
      );
    }
    const [stored] = await safe(
      () =>
        db.app.sql<
          { attempts_text: string }[]
        >`SELECT attempts_text FROM qf.quizpack_validation WHERE id=${row.id}`,
    );
    expect(stored!.attempts_text).toBe(row.attempts_text);
  });
  it("proof and release or cleanup in one UPDATE are refused; previous committed ACK permits one interrupt", async () => {
    const row = await claim();
    const proof = syntheticFileStopProof(row, "not-started");
    const controls = serializeValidationAttempts(
      parseValidationAttempts(row.attempts_text).map((a) => ({
        ...a,
        mediaStop: "not-started",
        fileStopProof: proof,
        disposition: "released",
      })),
    );
    await rejectsSql(
      () =>
        db.app
          .sql`UPDATE qf.quizpack_validation SET attempts_text=${controls},status='retryable-failed',lease_until=NULL,reserved_bytes=0,state_revision=state_revision+1 WHERE id=${row.id}`,
    );
    const acknowledged = await acknowledgeDomainStop(db, f, row, "not-started");
    const finalInput = {
      authority: authority(acknowledged),
      settledAttempts: [domainSettledAttempt(acknowledged)],
      accountedBytes: 0,
      storageCondition: "clean" as const,
      errorCode: null,
    };
    const released = await interruptValidation(
      db.app,
      f.auth.credentials,
      f.scope,
      finalInput,
    );
    expect(Number(released.reserved_bytes)).toBe(0);
    await expect(
      interruptValidation(db.app, f.auth.credentials, f.scope, finalInput),
    ).rejects.toThrow("VALIDATION_STATE_CONFLICT");
  });
  it("file-stop proof remains immutable across recovery; input cannot invent an ACK", async () => {
    const row = await claim();
    await expect(
      recoverValidationClaim(db.app, f.auth.credentials, f.scope, {
        authority: authority(row),
        settledAttempts: [
          {
            attemptId: row.current_attempt_id,
            mediaStop: "not-started",
            fileStopProof: syntheticFileStopProof(row, "not-started"),
          },
        ],
        accountedBytes: 0,
        storageCondition: "clean",
        errorCode: null,
      }),
    ).rejects.toThrow("VALIDATION_RECOVERY_REQUIRED");
    await expect(
      completeValidation(db.app, f.auth.credentials, f.scope, {
        authority: authority(row),
        blobs: f.blobs,
        accountedBytes: 0,
      }),
    ).rejects.toThrow("VALIDATION_RECOVERY_REQUIRED");
    await expect(
      interruptValidation(db.app, f.auth.credentials, f.scope, {
        authority: authority(row),
        settledAttempts: [],
        accountedBytes: 0,
        storageCondition: "clean",
        errorCode: null,
      }),
    ).rejects.toThrow("VALIDATION_RECOVERY_REQUIRED");
    const acknowledged = await acknowledgeDomainStop(db, f, row, "not-started");
    const old = JSON.parse(acknowledged.attempts_text);
    old[0].fileStopProof = null;
    await rejectsSql(
      () =>
        db.app
          .sql`UPDATE qf.quizpack_validation SET attempts_text=${JSON.stringify(old)},state_revision=state_revision+1 WHERE id=${row.id}`,
    );
    const recovered = await recoverValidationClaim(
      db.app,
      f.auth.credentials,
      f.scope,
      {
        authority: authority(acknowledged),
        settledAttempts: [domainSettledAttempt(acknowledged)],
        accountedBytes: 0,
        storageCondition: "clean",
        errorCode: null,
      },
    );
    expect(
      parseValidationAttempts(recovered.attempts_text)[0]!.fileStopProof,
    ).toEqual(
      parseValidationAttempts(acknowledged.attempts_text)[0]!.fileStopProof,
    );
    expect(recovered.fence).toBe(acknowledged.fence + 1);
  });
  it("expired lease and archived Product refuse new ACK", async () => {
    const row = await claim();
    await safe(
      () =>
        db.admin
          .sql`UPDATE qf.quizpack_validation SET status='retryable-failed',lease_until=NULL,state_revision=state_revision+1 WHERE id=${row.id}`,
    );
    const [expired] = await safe(
      () =>
        db.admin.sql<
          ValidationRow[]
        >`SELECT * FROM qf.quizpack_validation WHERE id=${row.id}`,
    );
    await expect(
      acknowledgeDomainStop(db, f, expired!, "not-started"),
    ).rejects.toThrow("VALIDATION_LOCK_LOST");
    await safe(
      () =>
        db.admin
          .sql`UPDATE qf.product SET archived_at=clock_timestamp(),metadata_revision=metadata_revision+1,updated_at=clock_timestamp() WHERE id=${f.scope.productId}`,
    );
    await expect(
      acknowledgeDomainStop(db, f, expired!, "not-started"),
    ).rejects.toThrow("PRODUCT_ARCHIVED");
  });
});
