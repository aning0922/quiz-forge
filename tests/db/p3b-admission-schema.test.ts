import { randomUUID, createHash } from "node:crypto";
import type postgres from "postgres";
import { afterAll, beforeAll, expect, it } from "vitest";
import { createDatabase } from "@/lib/db/client";
import { readMigrations } from "@/lib/db/migrate";
import { openManagedDatabase } from "@/lib/db/management";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import {
  supportedRuntimeIdentity,
  runtimeIdentity,
} from "@/features/quizpack/server/validation/identity";
import {
  supportedArchivePolicySha256,
  SUPPORTED_ARCHIVE_POLICY_VERSION,
} from "@/features/quizpack/validation/policy";
import { validationKey } from "@/features/quizpack/validation/repository";
import { openTestDatabase, type TestDatabase } from "./p2a-fixture";

let db: TestDatabase, migration: string, oldFunctions: string;
const rollback = new Error("SYNTHETIC_ROLLBACK");
beforeAll(async () => {
  db = await openTestDatabase();
  await db.app.close();
  const definitions = await readMigrations();
  migration = definitions.find(
    (d) => d.version === "0015_supported_pack_admission",
  )!.source;
  const old = definitions
    .filter((d) => d.version < "0015")
    .map((d) => d.source)
    .join("\n");
  oldFunctions = [
    "validation_file_stop_controls_valid",
    "protect_validation_file_stop_ack",
    "validation_shape_valid",
    "protect_draft_revision_source",
  ]
    .map((name) => {
      const matches = [
        ...old.matchAll(
          new RegExp(
            "CREATE(?: OR REPLACE)? FUNCTION qf\\." + name + "\\(.*?\\$\\$;",
            "gs",
          ),
        ),
      ];
      const source = matches.at(-1)?.[0];
      if (!source) throw Error("FIXTURE_OLD_FUNCTION_REQUIRED");
      return source.replace(/^CREATE FUNCTION/, "CREATE OR REPLACE FUNCTION");
    })
    .join("\n");
});
afterAll(async () => {
  await db?.close();
});
async function transaction(
  work: (tx: postgres.TransactionSql) => Promise<void>,
  restoreOld = false,
) {
  try {
    await db.admin.sql.begin(async (tx) => {
      if (restoreOld) await tx.unsafe(oldFunctions);
      await work(tx);
      throw rollback;
    });
  } catch (e) {
    if (e !== rollback) throw e;
  }
}
async function expectFailure(work: () => Promise<unknown>, message: string) {
  try {
    await work();
    throw Error("EXPECTED_DATABASE_REJECTION");
  } catch (e) {
    const err = e as { message?: string; code?: string };
    if (err.message !== message) throw Error("UNEXPECTED_DATABASE_REJECTION");
    expect(err.code).toBe("55000");
  }
}
async function syntheticImport(
  tx: postgres.TransactionSql,
  kind: "clean" | "retryable" | "receiving" | "unknown",
) {
  const op = randomUUID(),
    id = randomUUID(),
    attemptId = randomUUID(),
    pid = "migration-" + randomUUID().replaceAll("-", "");
  const hash = createHash("sha256").update(op).digest("hex");
  await tx`INSERT INTO qf.operator(id,login_name,display_name,role,status) VALUES(${op},${pid},${hash},'operator','active')`;
  await tx`INSERT INTO qf.product(id,slug,title,metadata_revision,created_at,updated_at) VALUES(${pid},${pid},'Synthetic admission migration',1,now(),now())`;
  const active = kind === "receiving";
  const attempts = active
    ? [
        {
          attemptId,
          fence: 1,
          ownerPid: 1,
          ownerNonce: "A".repeat(43),
          reservationBytes: 65736,
          disposition: "held",
        },
      ]
    : [];
  await tx`INSERT INTO qf.quizpack_import(id,product_id,created_by,idempotency_key,request_fingerprint,expected_archive_sha256,expected_archive_bytes,target_kind,created_at,status,updated_at,storage_condition,fence,lease_until,current_attempt_id,attempts,reserved_bytes)
 VALUES(${id},${pid},${op},${randomUUID()},${hash},${hash},100,'new-draft',now(),${active ? "receiving" : kind === "retryable" ? "retryable-failed" : "awaiting-upload"},now(),${kind === "unknown" ? "unknown" : "clean"},${active ? 1 : 0},${active ? new Date(Date.now() - 1000) : null},${active ? attemptId : null},${tx.json(attempts)},${active ? 65736 : 0})`;
}
it.each(["clean", "retryable"] as const)(
  "allows a quiescent synthetic %s import and retains all bytes",
  async (kind) => {
    await transaction(async (tx) => {
      await syntheticImport(tx, kind);
      const before =
        await tx`SELECT row_to_json(i)::text AS snapshot FROM qf.quizpack_import i ORDER BY id`;
      await tx.unsafe(migration);
      expect(
        await tx`SELECT row_to_json(i)::text AS snapshot FROM qf.quizpack_import i ORDER BY id`,
      ).toEqual(before);
    }, true);
  },
);
it.each(["receiving", "unknown"] as const)(
  "refuses %s even with no future lease",
  async (kind) => {
    await expectFailure(
      () =>
        transaction(async (tx) => {
          await syntheticImport(tx, kind);
          await tx.unsafe(migration);
        }, true),
      "ADMISSION_UNSETTLED_IO",
    );
  },
);
it("refuses a residual application connection without killing it", async () => {
  const app = await createDatabase(db.config);
  try {
    await expectFailure(
      () =>
        transaction(async (tx) => {
          await tx.unsafe(migration);
        }, true),
      "ADMISSION_WRITERS_PRESENT",
    );
    expect(await app.sql`SELECT 1 AS alive`).toHaveLength(1);
  } finally {
    await app.close();
  }
});
it("refuses a weakened old helper before trusting its quiescence answer", async () => {
  await expectFailure(
    () =>
      transaction(async (tx) => {
        await tx.unsafe(
          "CREATE OR REPLACE FUNCTION qf.validation_shape_valid(v qf.quizpack_validation) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$ BEGIN RETURN true; END $$;",
        );
        await tx.unsafe(migration);
      }, true),
    "ADMISSION_PREVIOUS_HELPER_CHANGED",
  );
});
it("pins new admission helper semantics and attributes at app open", async () => {
  for (const command of [
    "ALTER FUNCTION qf.validation_shape_valid(qf.quizpack_validation) VOLATILE",
    "CREATE OR REPLACE FUNCTION qf.validation_shape_valid(v qf.quizpack_validation) RETURNS boolean LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$ BEGIN RETURN true; END $$;",
  ]) {
    const original = await db.admin
      .sql`SELECT pg_get_functiondef('qf.validation_shape_valid(qf.quizpack_validation)'::regprocedure) AS definition`;
    try {
      await db.admin.sql.unsafe(command);
      await expect(createDatabase(db.config)).rejects.toThrow(
        "STUDIO_UNAVAILABLE",
      );
    } finally {
      await db.admin.sql.unsafe(original[0]!.definition);
    }
  }
  const app = await createDatabase(db.config);
  await app.close();
});
it("refuses another owner transaction holding an incompatible table lock with NOWAIT", async () => {
  const other = await openManagedDatabase(db.config.instanceId);
  let release!: () => void, locked!: () => void;
  const gate = new Promise<void>((r) => (release = r)),
    ready = new Promise<void>((r) => (locked = r));
  const holder = other.sql.begin(async (tx) => {
    await tx`LOCK TABLE qf.quizpack_import IN ROW EXCLUSIVE MODE`;
    locked();
    await gate;
  });
  try {
    await ready;
    try {
      await db.admin.sql.begin(async (tx) => {
        await tx.unsafe(migration);
      });
      throw Error("EXPECTED_LOCK_REJECTION");
    } catch (e) {
      if ((e as { code?: string }).code !== "55P03")
        throw Error("UNEXPECTED_LOCK_REJECTION");
    }
  } finally {
    release();
    await holder;
    await other.close();
  }
});
it("checks current SQL identity hashing and rejects legacy or self-hashed false tuples", async () => {
  const h = "a".repeat(64),
    binding = {
      schema: "quizpack-media-runtime-binding.v1" as const,
      platform: "darwin-arm64" as const,
      componentId: h,
      deploymentId: h,
      runtimeBundleHash: h,
      limitsHash: h,
    };
  const identity = supportedRuntimeIdentity(binding);
  const falseIdentity = { ...identity, reportSchemaHash: h };
  const { identitySha256: _, ...payload } = falseIdentity;
  void _;
  falseIdentity.identitySha256 = createHash("sha256")
    .update(canonicalP1Json(payload))
    .digest("hex");
  for (const [value, expected] of [
    [identity, true],
    [runtimeIdentity(binding), false],
    [falseIdentity, false],
  ] as const) {
    const importId = randomUUID(),
      productId = "synthetic-sql-admission";
    const input = {
      productId,
      importId,
      archiveSha256: h,
      archiveBytes: 100,
      identitySha256: value.identitySha256,
      archivePolicyVersion: SUPPORTED_ARCHIVE_POLICY_VERSION,
      archivePolicySha256: supportedArchivePolicySha256,
    };
    const row = {
      id: randomUUID(),
      product_id: productId,
      import_id: importId,
      archive_sha256: h,
      archive_bytes: 100,
      identity_text: canonicalP1Json(value),
      identity_sha256: value.identitySha256,
      archive_policy_version: SUPPORTED_ARCHIVE_POLICY_VERSION,
      archive_policy_sha256: supportedArchivePolicySha256,
      validation_key: validationKey(input),
      status: "validating",
      identity_kind: "unclaimed",
    };
    const [result] = await db.admin
      .sql`SELECT qf.validation_shape_valid(jsonb_populate_record(NULL::qf.quizpack_validation,${db.admin.sql.json(row)})) AS valid`;
    expect(result!.valid).toBe(expected);
  }
});

it("rejects JSON numbers that stringify like a current identity hash", async () => {
  const numericHash = "1".repeat(64);
  const identity = supportedRuntimeIdentity({
    schema: "quizpack-media-runtime-binding.v1",
    platform: "darwin-arm64",
    componentId: numericHash,
    deploymentId: numericHash,
    runtimeBundleHash: numericHash,
    limitsHash: numericHash,
  });
  for (const key of [
    "componentId",
    "deploymentId",
    "limitsHash",
    "runtimeBundleHash",
    "validatorBundleSha256",
  ]) {
    const importId = randomUUID(),
      productId = "synthetic-json-types";
    const identityText = canonicalP1Json(identity).replace(
      '"' + key + '":"' + numericHash + '"',
      '"' + key + '":' + numericHash,
    );
    const input = {
      productId,
      importId,
      archiveSha256: numericHash,
      archiveBytes: 100,
      identitySha256: identity.identitySha256,
      archivePolicyVersion: SUPPORTED_ARCHIVE_POLICY_VERSION,
      archivePolicySha256: supportedArchivePolicySha256,
    };
    const row = {
      id: randomUUID(),
      product_id: productId,
      import_id: importId,
      archive_sha256: numericHash,
      archive_bytes: 100,
      identity_text: identityText,
      identity_sha256: identity.identitySha256,
      archive_policy_version: SUPPORTED_ARCHIVE_POLICY_VERSION,
      archive_policy_sha256: supportedArchivePolicySha256,
      validation_key: validationKey(input),
      status: "validating",
      identity_kind: "unclaimed",
    };
    const [result] = await db.admin
      .sql`SELECT qf.validation_shape_valid(jsonb_populate_record(NULL::qf.quizpack_validation,${db.admin.sql.json(row)})) AS valid`;
    expect(result!.valid).toBe(false);
  }
});
