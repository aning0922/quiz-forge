import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  openTestDatabase,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import {
  domainFixture,
  resetDomainDatabase,
  hash,
  syntheticFileStopProof,
} from "./p2b2b-domain-fixture";
import { createDatabase, verifyDatabaseIdentity } from "@/lib/db/client";
import { migrateDatabase, readMigrations } from "@/lib/db/migrate";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import {
  archivePolicyDescriptor,
  ARCHIVE_POLICY_VERSION,
} from "@/features/quizpack/validation/policy";
import {
  validationKey,
  heldValidations,
  parseValidationAttempts,
  type ValidationRow,
} from "@/features/quizpack/validation/repository";
import {
  claimValidation,
  acknowledgeValidationFileStop,
  completeValidation,
  retryValidationClaim,
} from "@/features/quizpack/validation/transactions";
let db: TestDatabase;
beforeAll(async () => {
  db = await safe(openTestDatabase);
});
afterAll(async () => {
  if (db) {
    await resetDomainDatabase(db);
    await db.close();
  }
});
it("real 0010 → enum-only 0011 → 0012 upgrade preserves historical nine-field controls without granting ACK or retry", async () => {
  // Dedicated no-file synthetic instance only. Never rewind a production or shared migration history.
  await resetDomainDatabase(db);
  const definitions = await readMigrations();
  expect(definitions.at(-1)!.version).toBe("0012_validation_file_stop_ack");
  await safe(() => db.admin.sql`DROP SCHEMA qf CASCADE`);
  await safe(() => db.admin.sql`DROP SCHEMA qf_meta CASCADE`);
  try {
    await safe(() =>
      migrateDatabase(db.admin.sql, db.config, definitions.slice(0, 10)),
    );
    await expect(createDatabase(db.config)).rejects.toThrow(
      "STUDIO_UNAVAILABLE",
    );
    const f = await domainFixture(db);
    const descriptor: {
      schemaVersion: string;
      receiptProof: string;
      finalizationProtocol: string;
      limits: Record<string, unknown>;
    } = JSON.parse(canonicalP1Json(archivePolicyDescriptor));
    descriptor.schemaVersion = "quizpack-private-archive.v1";
    descriptor.receiptProof = "files-and-media.v1";
    descriptor.finalizationProtocol = "receipt-before-complete-once.v1";
    delete descriptor.limits.metadataBytes;
    delete descriptor.limits.fileStopProofBytes;
    const oldPolicySha256 = hash(canonicalP1Json(descriptor));
    const oldKey = validationKey({
      ...f.scope,
      archiveSha256: hash("Synthetic DB archive"),
      archiveBytes: 100,
      identitySha256: f.binding.identitySha256,
      archivePolicyVersion: descriptor.schemaVersion,
      archivePolicySha256: oldPolicySha256,
    });
    const id = randomUUID(),
      attemptId = randomUUID();
    const controls = canonicalP1Json([
      {
        attemptId,
        ordinal: 1,
        fence: 1,
        ownerPid: process.pid,
        ownerNonce: f.owner.ownerNonce,
        kind: "validate",
        reservationBytes: 134283264,
        disposition: "held",
        mediaStop: "unconfirmed",
      },
    ]);
    await safe(
      () =>
        db.app
          .sql`INSERT INTO qf.quizpack_validation(id,product_id,import_id,created_by,created_at,validation_key,archive_sha256,archive_bytes,identity_text,identity_sha256,archive_policy_version,archive_policy_sha256,status,state_revision,updated_at,fence,lease_until,current_attempt_id,attempts_text,storage_condition,reserved_bytes,accounted_bytes,identity_kind) VALUES(${id},${f.scope.productId},${f.scope.importId},${f.auth.id},clock_timestamp(),${oldKey},${hash("Synthetic DB archive")},100,${f.binding.identityText},${f.binding.identitySha256},${descriptor.schemaVersion},${oldPolicySha256},'validating',1,clock_timestamp(),1,clock_timestamp()+interval '120 seconds',${attemptId},${controls},'unknown',134283264,0,'unclaimed')`,
    );
    await safe(() =>
      migrateDatabase(db.admin.sql, db.config, definitions.slice(0, 11)),
    );
    await expect(createDatabase(db.config)).rejects.toThrow(
      "STUDIO_UNAVAILABLE",
    );
    await safe(() =>
      verifyDatabaseIdentity(
        db.admin.sql,
        db.config,
        `qf_owner_${db.config.instanceId}`,
      ),
    );
    await safe(() => migrateDatabase(db.admin.sql, db.config, definitions));
    const app = await safe(() => createDatabase(db.config));
    await app.close();
    const replay = await claimValidation(db.app, f.auth.credentials, f.scope, {
      expectedImportStateRevision: 123,
      expectedValidationKey: oldKey,
      binding: {
        ...f.binding,
        archivePolicyVersion: descriptor.schemaVersion,
        archivePolicySha256: oldPolicySha256,
        validationKey: oldKey,
      },
      owner: f.owner,
    });
    expect(replay.created).toBe(false);
    expect(replay.row.attempts_text).toBe(controls);
    expect(Number(replay.row.reserved_bytes)).toBe(134283264);
    expect(
      parseValidationAttempts(replay.row.attempts_text)[0]!.fileStopProof,
    ).toBeUndefined();
    const held = await heldValidations(db.app.sql);
    expect(held.find((row) => row.id === id)?.reservedBytes).toBe(134283264);
    const authority = {
      validationId: id,
      expectedStateRevision: 1,
      fence: 1,
      attemptId,
    };
    await expect(
      acknowledgeValidationFileStop(db.app, f.auth.credentials, f.scope, {
        authority,
        proof: syntheticFileStopProof(replay.row, "not-started"),
      }),
    ).rejects.toThrow("VALIDATION_REVALIDATION_REQUIRED");
    await expect(
      completeValidation(db.app, f.auth.credentials, f.scope, {
        authority,
        blobs: f.blobs,
        accountedBytes: 0,
      }),
    ).rejects.toThrow("VALIDATION_REVALIDATION_REQUIRED");
    await expect(
      retryValidationClaim(db.app, f.auth.credentials, f.scope, id, {
        expectedStateRevision: 1,
        binding: {
          ...f.binding,
          archivePolicyVersion: descriptor.schemaVersion,
          archivePolicySha256: oldPolicySha256,
          validationKey: oldKey,
        },
        owner: f.owner,
      }),
    ).rejects.toThrow("VALIDATION_REVALIDATION_REQUIRED");
    const current = await claimValidation(db.app, f.auth.credentials, f.scope, {
      expectedImportStateRevision: 1,
      expectedValidationKey: f.binding.validationKey,
      binding: f.binding,
      owner: f.owner,
    });
    expect(current.row.archive_policy_version).toBe(ARCHIVE_POLICY_VERSION);
    expect(current.row.validation_key).not.toBe(oldKey);
    expect(current.row.id).not.toBe(id);
    const [old] = await safe(
      () =>
        db.app.sql<
          ValidationRow[]
        >`SELECT * FROM qf.quizpack_validation WHERE id=${id}`,
    );
    expect(old!.attempts_text).toBe(controls);
    expect(old!.state_revision).toBe(1);
  } finally {
    await safe(() => migrateDatabase(db.admin.sql, db.config, definitions));
  }
});
