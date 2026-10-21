import { createHash } from "node:crypto";
import { z } from "zod";

/** R1 is a finite local maintenance backup, not a third-party SQL import format. */
export const RECOVERY_LIMITS = Object.freeze({
  manifestBytes: 4_194_304,
  sealBytes: 1_024,
  dumpBytes: 536_870_912,
  storageBytes: 536_870_912,
  fileBytes: 33_554_432,
  storageEntries: 8_192,
  tableRows: 1_000_000,
  databaseRowBytes: 536_870_912,
  operationMs: 300_000,
});

export const RECOVERY_TABLES = [
  "qf.access_key",
  "qf.asset_blob",
  "qf.audit_event",
  "qf.category",
  "qf.consumer_exchange_budget",
  "qf.consumer_grant",
  "qf.consumer_session",
  "qf.draft_application",
  "qf.draft_review",
  "qf.draft_revision",
  "qf.internal_play_version",
  "qf.operator",
  "qf.operator_session",
  "qf.product",
  "qf.product_asset",
  "qf.product_draft",
  "qf.product_tag",
  "qf.product_version",
  "qf.quiz_report",
  "qf.quizpack_import",
  "qf.quizpack_validation",
  "qf.tag",
  "qf_meta.schema_migrations",
] as const;

const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const instanceId = z.string().regex(/^[a-f0-9]{32}$/);
const uuidText = "[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}";
const directoryPattern = new RegExp(
  `^uploads(?:/(?:blobs|imports|validation)(?:/${uuidText})?)?$`,
);
const filePattern = new RegExp(
  `^uploads/(?:blobs/[a-f0-9]{64}\\.blob|imports/${uuidText}/archive\\.quizpack|(?:imports|validation)/${uuidText}/stopped-${uuidText}\\.json)$`,
);
export const recoveryPortSchema = z
  .number()
  .int()
  .min(1024)
  .max(65535)
  .refine((port) => port !== 5432);
export const recoveryOriginSchema = z.string().refine((value) => {
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{3,4})$/.exec(value);
  return !!match && Number(match[1]) >= 1024 && Number(match[1]) <= 65535;
});
export const recoveryRootSchema = z
  .string()
  .min(2)
  .max(2048)
  .refine((value) => {
    return (
      value.startsWith("/") &&
      !/[\u0000-\u001f\u007f\\]/.test(value) &&
      value
        .split("/")
        .slice(1)
        .every((part) => part && part !== "." && part !== "..")
    );
  });
export const recoveryFileDigestSchema = z.strictObject({
  bytes: z.number().int().min(0).max(RECOVERY_LIMITS.dumpBytes),
  sha256,
});
export type RecoveryFileDigest = z.infer<typeof recoveryFileDigestSchema>;

export const recoveryStorageFileSchema = z.strictObject({
  path: z.string().max(200).regex(filePattern),
  bytes: z.number().int().min(1).max(RECOVERY_LIMITS.fileBytes),
  sha256,
});
export const recoveryStorageSchema = z
  .strictObject({
    directories: z
      .array(z.string().max(100).regex(directoryPattern))
      .max(RECOVERY_LIMITS.storageEntries),
    files: z
      .array(recoveryStorageFileSchema)
      .max(RECOVERY_LIMITS.storageEntries),
  })
  .superRefine((value, context) => {
    const paths = [
      ...value.directories,
      ...value.files.map((file) => file.path),
    ];
    const directories = new Set(value.directories);
    const invalid = (message: string) =>
      context.addIssue({ code: "custom", message });
    if (
      paths.length > RECOVERY_LIMITS.storageEntries ||
      new Set(paths).size !== paths.length ||
      !strictlySorted(value.directories) ||
      !strictlySorted(value.files.map((file) => file.path))
    )
      invalid("Invalid storage inventory");
    for (const required of [
      "uploads",
      "uploads/blobs",
      "uploads/imports",
      "uploads/validation",
    ])
      if (!directories.has(required)) invalid("Missing storage namespace");
    for (const entry of paths) {
      if (entry === "uploads") continue;
      if (!directories.has(entry.slice(0, entry.lastIndexOf("/"))))
        invalid("Missing storage parent");
      if (/^uploads\/blobs\//.test(entry) && directories.has(entry))
        invalid("Blob namespace cannot contain directories");
    }
    if (
      value.files.reduce((total, file) => total + file.bytes, 0) >
      RECOVERY_LIMITS.storageBytes
    )
      invalid("Storage budget exceeded");
    for (const file of value.files) {
      if (file.path.endsWith(".json") && file.bytes > 2048)
        invalid("Stop receipt budget exceeded");
      const blob = /^uploads\/blobs\/([a-f0-9]{64})\.blob$/.exec(file.path);
      if (blob && blob[1] !== file.sha256) invalid("Blob identity mismatch");
    }
  });
export type RecoveryStorageInventory = z.infer<typeof recoveryStorageSchema>;

export const recoveryMigrationSchema = z.strictObject({
  version: z.string().regex(/^\d{4}_[a-z0-9_]{1,100}$/),
  checksum: sha256,
});
export const recoveryTableSchema = z.strictObject({
  name: z.enum(RECOVERY_TABLES),
  rows: z.number().int().min(0).max(RECOVERY_LIMITS.tableRows),
  bytes: z.number().int().min(0).max(RECOVERY_LIMITS.databaseRowBytes),
  sha256,
});
export const recoveryDatabaseEvidenceSchema = z
  .strictObject({
    migrations: z.array(recoveryMigrationSchema).length(18),
    tables: z.array(recoveryTableSchema).length(RECOVERY_TABLES.length),
    graphSha256: sha256,
  })
  .superRefine((value, context) => {
    if (
      value.tables.some(
        (table, index) => table.name !== RECOVERY_TABLES[index],
      ) ||
      value.migrations.some(
        (migration, index) =>
          !migration.version.startsWith(
            String(index + 1).padStart(4, "0") + "_",
          ),
      ) ||
      value.tables.reduce((total, table) => total + table.bytes, 0) >
        RECOVERY_LIMITS.databaseRowBytes ||
      value.graphSha256 !==
        recoveryHash(
          canonicalRecoveryJson({
            migrations: value.migrations,
            tables: value.tables,
          }),
        )
    )
      context.addIssue({
        code: "custom",
        message: "Invalid database evidence",
      });
  });
export type RecoveryDatabaseEvidence = z.infer<
  typeof recoveryDatabaseEvidenceSchema
>;

export const recoverySourceSchema = z.strictObject({
  instanceId,
  purpose: z.enum(["test", "demo"]),
  root: recoveryRootSchema,
  origin: recoveryOriginSchema,
  pgPort: recoveryPortSchema,
  postgresVersion: z.literal(180004),
  importsEnabled: z.literal(false),
  codeSha256: sha256,
});
export type RecoverySourceIdentity = z.infer<typeof recoverySourceSchema>;

export const recoveryManifestSchema = z.strictObject({
  schemaVersion: z.literal("quizforge.runtime-backup.v1"),
  backupId: z.uuid().regex(new RegExp(`^${uuidText}$`)),
  createdAt: z.iso.datetime({ precision: 3 }),
  mode: z.literal("quiescent-logical"),
  source: recoverySourceSchema,
  database: recoveryDatabaseEvidenceSchema,
  dump: recoveryFileDigestSchema.extend({ path: z.literal("database.dump") }),
  storage: recoveryStorageSchema,
});
export type RecoveryManifest = z.infer<typeof recoveryManifestSchema>;
export const recoverySealSchema = z.strictObject({
  schemaVersion: z.literal("quizforge.runtime-backup-seal.v1"),
  backupId: z.uuid().regex(new RegExp(`^${uuidText}$`)),
  manifestBytes: z.number().int().min(1).max(RECOVERY_LIMITS.manifestBytes),
  manifestSha256: sha256,
  status: z.literal("sealed"),
});

function strictlySorted(values: readonly string[]) {
  return values.every(
    (value, index) => index === 0 || values[index - 1]! < value,
  );
}
/** Call only on finite schema-validated DTOs; no private DB rows are serialized to public output. */
export function canonicalRecoveryJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(canonicalRecoveryJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonicalRecoveryJson((value as Record<string, unknown>)[key])}`,
      )
      .join(",")}}`;
  }
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error("RECOVERY_FORMAT_INVALID");
  return encoded;
}
export function recoveryHash(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}
export function recoveryManifestText(value: unknown): string {
  const text = canonicalRecoveryJson(recoveryManifestSchema.parse(value));
  if (Buffer.byteLength(text) > RECOVERY_LIMITS.manifestBytes)
    throw new Error("RECOVERY_LIMIT_EXCEEDED");
  return text;
}
