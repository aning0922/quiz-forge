import { describe, expect, it } from "vitest";
import {
  RECOVERY_LIMITS,
  RECOVERY_ROW_FORMAT,
  RECOVERY_TABLES,
  canonicalRecoveryJson,
  recoveryDatabaseEvidenceSchema,
  recoveryHash,
  recoveryManifestSchema,
  recoveryManifestText,
  recoveryRootSchema,
  recoverySealSchema,
  recoveryStorageSchema,
} from "./contracts";
import { RecoveryError, safeRecoveryError } from "./errors";

const id = "1".repeat(32);
const uuid = "00000000-0000-4000-8000-000000000001";
const hash = "a".repeat(64);
const directories = [
  "uploads",
  "uploads/blobs",
  "uploads/imports",
  "uploads/validation",
];
const database = () => {
  const facts = {
    rowFormat: RECOVERY_ROW_FORMAT,
    migrations: Array.from({ length: 18 }, (_, i) => ({
      version: `${String(i + 1).padStart(4, "0")}_synthetic`,
      checksum: hash,
    })),
    tables: RECOVERY_TABLES.map((name) => ({
      name,
      rows: 0,
      bytes: 0,
      sha256: hash,
    })),
  };
  return { ...facts, graphSha256: recoveryHash(canonicalRecoveryJson(facts)) };
};
const manifest = () => ({
  schemaVersion: "quizforge.runtime-backup.v1",
  backupId: uuid,
  createdAt: "2026-10-21T00:00:00.000Z",
  mode: "quiescent-logical",
  source: {
    instanceId: id,
    purpose: "test",
    root: "/synthetic/source",
    origin: "http://127.0.0.1:3201",
    pgPort: 55431,
    postgresVersion: 180004,
    importsEnabled: false,
    codeSha256: hash,
  },
  database: database(),
  dump: {
    path: "database.dump",
    format: "pg18.4-custom",
    bytes: 1,
    sha256: hash,
  },
  storage: { directories, files: [] },
});

describe("finite recovery artifact contract", () => {
  it("round trips finite evidence without credentials or private row contents", () => {
    expect(
      recoveryManifestSchema.parse(
        JSON.parse(recoveryManifestText(manifest())),
      ),
    ).toEqual(manifest());
  });
  it.each([
    "../outside",
    "/outside",
    "uploads/../outside",
    "uploads/blobs/a\\b.blob",
    "uploads/blobs/%2e%2e",
    "uploads/blobs/secret.key",
  ])("rejects unlisted storage path %s", (path) => {
    expect(
      recoveryStorageSchema.safeParse({
        directories,
        files: [{ path, bytes: 1, sha256: hash }],
      }).success,
    ).toBe(false);
  });
  it("rejects duplicate or absent parents and temporary stop proofs", () => {
    const file = {
      path: `uploads/imports/${uuid}/archive.quizpack`,
      bytes: 1,
      sha256: hash,
    };
    expect(
      recoveryStorageSchema.safeParse({ directories, files: [file] }).success,
    ).toBe(false);
    const complete = [...directories, `uploads/imports/${uuid}`].sort();
    expect(
      recoveryStorageSchema.safeParse({
        directories: complete,
        files: [file, file],
      }).success,
    ).toBe(false);
    expect(
      recoveryStorageSchema.safeParse({
        directories: complete,
        files: [
          {
            ...file,
            path: `uploads/imports/${uuid}/stopped-${uuid}.json.tmp-${uuid}`,
          },
        ],
      }).success,
    ).toBe(false);
  });
  it("rejects blob identity mismatch, oversized proofs and cumulative storage overflow", () => {
    expect(
      recoveryStorageSchema.safeParse({
        directories,
        files: [
          {
            path: `uploads/blobs/${hash}.blob`,
            bytes: 1,
            sha256: "b".repeat(64),
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      recoveryStorageSchema.safeParse({
        directories: [...directories, `uploads/imports/${uuid}`].sort(),
        files: [
          {
            path: `uploads/imports/${uuid}/stopped-${uuid}.json`,
            bytes: 2049,
            sha256: hash,
          },
        ],
      }).success,
    ).toBe(false);
    const files = Array.from({ length: 17 }, (_, i) => {
      const sha256 = i.toString(16).padStart(64, "0");
      return {
        path: `uploads/blobs/${sha256}.blob`,
        bytes: RECOVERY_LIMITS.fileBytes,
        sha256,
      };
    });
    expect(
      recoveryStorageSchema.safeParse({ directories, files }).success,
    ).toBe(false);
  });
  it("rejects missing or substituted tables, stale aggregate hash and migration order", () => {
    const evidence = database();
    expect(
      recoveryDatabaseEvidenceSchema.safeParse({
        ...evidence,
        tables: evidence.tables.slice(1),
      }).success,
    ).toBe(false);
    expect(
      recoveryDatabaseEvidenceSchema.safeParse({
        ...evidence,
        tables: [
          { ...evidence.tables[0], rows: 1 },
          ...evidence.tables.slice(1),
        ],
      }).success,
    ).toBe(false);
    const migrations = [...evidence.migrations].reverse();
    expect(
      recoveryDatabaseEvidenceSchema.safeParse({
        ...evidence,
        migrations,
        graphSha256: recoveryHash(
          canonicalRecoveryJson({
            rowFormat: RECOVERY_ROW_FORMAT,
            migrations,
            tables: evidence.tables,
          }),
        ),
      }).success,
    ).toBe(false);
  });
  it("rejects secret-bearing and unsupported source metadata", () => {
    const value = manifest();
    for (const change of [
      { password: "synthetic-not-a-secret" },
      { purpose: "ci" },
      { importsEnabled: true },
      { postgresVersion: 180003 },
      { origin: "https://example.test" },
    ]) {
      expect(
        recoveryManifestSchema.safeParse({
          ...value,
          source: { ...value.source, ...change },
        }).success,
      ).toBe(false);
    }
  });
  it.each([
    "relative",
    "/root/../source",
    "/root//source",
    "/root/source/",
    "/root/./source",
    "/root/secret\n",
  ])("rejects noncanonical root %s", (root) => {
    expect(recoveryRootSchema.safeParse(root).success).toBe(false);
  });
  it("cannot turn a pending seal into completed verification", () => {
    const seal = {
      schemaVersion: "quizforge.runtime-backup-seal.v1",
      backupId: uuid,
      manifestBytes: 1,
      manifestSha256: hash,
      status: "pending",
    };
    expect(recoverySealSchema.safeParse(seal).success).toBe(false);
  });
  it("rejects an empty dump and an unspecified or unsupported dump format", () => {
    const value = manifest();
    for (const change of [
      { bytes: 0 },
      { format: "plain-sql" },
      { format: undefined },
    ]) {
      expect(
        recoveryManifestSchema.safeParse({
          ...value,
          dump: { ...value.dump, ...change },
        }).success,
      ).toBe(false);
    }
  });
  it("does not disclose arbitrary error messages or trust a forged error code", () => {
    expect(
      safeRecoveryError(new Error("synthetic password and query")),
    ).toEqual({ code: "RECOVERY_OPERATION_FAILED" });
    expect(safeRecoveryError({ code: "RECOVERY_INTEGRITY_FAILED" })).toEqual({
      code: "RECOVERY_OPERATION_FAILED",
    });
    expect(
      safeRecoveryError(new RecoveryError("RECOVERY_INTEGRITY_FAILED")),
    ).toEqual({ code: "RECOVERY_INTEGRITY_FAILED" });
  });
});
