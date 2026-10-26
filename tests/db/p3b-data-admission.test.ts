import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import { currentRuntimeIdentity } from "@/features/quizpack/server/validation/identity";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import {
  claimValidation,
  acknowledgeValidationFileStop,
  interruptValidation,
} from "@/features/quizpack/validation/transactions";
import {
  validationKey,
  validationRowDto,
  type ValidationRow,
} from "@/features/quizpack/validation/repository";
import { createProductDraftService } from "@/features/product/drafts/service";
import {
  domainFixture,
  syntheticFileStopProof,
  resetDomainDatabase,
} from "./p2b2b-domain-fixture";
import {
  openTestDatabase,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";

// Real PostgreSQL transactions with explicitly synthetic, no-file DB evidence.
// This suite does not certify media execution, opaque candidate issuance or authorization.
let db: TestDatabase;
let f: Awaited<ReturnType<typeof domainFixture>>;
beforeAll(async () => {
  db = await openTestDatabase();
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
// Every distinct identity still describes the same received archive; no opaque handles are forged.
function binding(n: number) {
  const identity = currentRuntimeIdentity({
    schema: "quizpack-media-runtime-binding.v1",
    platform: "darwin-arm64",
    componentId: "a".repeat(64),
    deploymentId: n.toString(16).padStart(64, "0"),
    runtimeBundleHash: "a".repeat(64),
    limitsHash: "a".repeat(64),
  });
  if (f.result.evidence.input.status !== "snapshotted")
    throw Error("SYNTHETIC_SNAPSHOT_REQUIRED");
  const archive = f.result.evidence.input;
  return {
    ...f.binding,
    identityText: canonicalP1Json(identity),
    identitySha256: identity.identitySha256,
    validationKey: validationKey({
      ...f.scope,
      archiveSha256: archive.archiveSha256,
      archiveBytes: 100,
      identitySha256: identity.identitySha256,
      archivePolicyVersion: f.binding.archivePolicyVersion,
      archivePolicySha256: f.binding.archivePolicySha256,
    }),
  };
}
const authority = (r: ValidationRow) => ({
  validationId: r.id,
  expectedStateRevision: r.state_revision,
  fence: r.fence,
  attemptId: r.current_attempt_id,
});
async function claim(n: number) {
  const b = binding(n);
  return claimValidation(db.app, f.auth.credentials, f.scope, {
    expectedImportStateRevision: 1,
    expectedValidationKey: b.validationKey,
    binding: b,
    owner: f.owner,
  });
}
async function release(row: ValidationRow) {
  const ack = await acknowledgeValidationFileStop(
    db.app,
    f.auth.credentials,
    f.scope,
    {
      authority: authority(row),
      proof: syntheticFileStopProof(row, "not-started"),
    },
  );
  const a = JSON.parse(ack.attempts_text)[0];
  return interruptValidation(db.app, f.auth.credentials, f.scope, {
    authority: authority(ack),
    settledAttempts: [
      {
        attemptId: a.attemptId,
        mediaStop: "not-started",
        fileStopProof: a.fileStopProof,
      },
    ],
    accountedBytes: 0,
    storageCondition: "clean",
    errorCode: "VALIDATION_CANCELLED",
  });
}
it("current clean retryable failures still consume exactly 20 pending slots; exact key replay precedes capacity", async () => {
  let first: ValidationRow | undefined;
  for (let n = 1; n <= 20; n++) {
    const r = await release((await claim(n)).row);
    first ??= r;
  }
  await expect(claim(21)).rejects.toThrow("VALIDATION_PENDING_LIMIT");
  const replay = await claim(1);
  expect(replay.created).toBe(false);
  expect(replay.row).toEqual(first);
  const summary = await db.app.sql.begin((tx) => validationRowDto(tx, first!));
  expect(summary.readOnly).toBe(false);
  expect(summary.status).toBe("retryable-failed");
});
it("current policy cannot be paired with a legacy identity, even if its validation key is recomputed", async () => {
  const { runtimeIdentity } =
    await import("@/features/quizpack/server/validation/identity");
  const current = JSON.parse(f.binding.identityText);
  const legacy = runtimeIdentity(current.runtime);
  const input = binding(1);
  if (f.result.evidence.input.status !== "snapshotted")
    throw Error("SYNTHETIC_SNAPSHOT_REQUIRED");
  const wrong = {
    ...input,
    identityText: canonicalP1Json(legacy),
    identitySha256: legacy.identitySha256,
    validationKey: validationKey({
      ...f.scope,
      archiveSha256: f.result.evidence.input.archiveSha256,
      archiveBytes: 100,
      identitySha256: legacy.identitySha256,
      archivePolicyVersion: input.archivePolicyVersion,
      archivePolicySha256: input.archivePolicySha256,
    }),
  };
  await expect(
    claimValidation(db.app, f.auth.credentials, f.scope, {
      expectedImportStateRevision: 1,
      expectedValidationKey: wrong.validationKey,
      binding: wrong,
      owner: f.owner,
    }),
  ).rejects.toThrow("VALIDATION_IDENTITY_CHANGED");
  expect(
    await safe(() => db.admin.sql`SELECT id FROM qf.quizpack_validation`),
  ).toHaveLength(0);
});
it("a wrong current policy hash never creates a row or a draft", async () => {
  if (f.result.evidence.input.status !== "snapshotted")
    throw Error("SYNTHETIC_SNAPSHOT_REQUIRED");
  const b = binding(1),
    wrong = { ...b, archivePolicySha256: "f".repeat(64) };
  wrong.validationKey = validationKey({
    ...f.scope,
    archiveSha256: f.result.evidence.input.archiveSha256,
    archiveBytes: 100,
    identitySha256: b.identitySha256,
    archivePolicyVersion: b.archivePolicyVersion,
    archivePolicySha256: wrong.archivePolicySha256,
  });
  await expect(
    claimValidation(db.app, f.auth.credentials, f.scope, {
      expectedImportStateRevision: 1,
      expectedValidationKey: wrong.validationKey,
      binding: wrong,
      owner: f.owner,
    }),
  ).rejects.toThrow("VALIDATION_IDENTITY_CHANGED");
  const drafts = createProductDraftService();
  expect(
    await drafts.readDraft(db.app, f.auth.session.raw, f.scope.productId),
  ).toEqual({ kind: "empty", productId: f.scope.productId });
});
