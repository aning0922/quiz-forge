import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type postgres from "postgres";
import type { DatabaseTime } from "@/lib/auth/internal";
import { StudioError } from "@/lib/http-security/errors";
import {
  iso,
  nullableIso,
  type Tx,
} from "@/features/product/workspace/repository";
import { canonicalP1Json } from "../v1/canonical";
import { packIdSchema, packVersionSchema, sha256Schema } from "../v1/manifest";
import { importIdSchema } from "../import/contracts";
import type { StorageCondition } from "../import/contracts";
import { validationIdentitySchema } from "../server/validation/contracts";
import type {
  IdentityKind,
  ValidationDto,
  ValidationErrorCode,
  ValidationListQuery,
  ValidationStatus,
  Page,
} from "./contracts";
import {
  MAX_ATTEMPTS,
  MAX_ATTEMPT_CONTROL_BYTES,
  MAX_FILE_STOP_PROOF_BYTES,
  MAX_VALIDATIONS,
  VALIDATION_RESERVATION_BYTES,
} from "./limits";
export const validationFileStopProofSchema = z
  .strictObject({
    schemaVersion: z.literal("quizpack-validation-file-stop-proof.v1"),
    protocol: z.literal("candidate-receipt-db-ack.v1"),
    validationId: importIdSchema,
    attemptId: importIdSchema,
    fence: z.number().int().min(1).max(2147483647),
    ownerPid: z.number().int().min(1).max(2147483647),
    ownerNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
    receiptSha256: sha256Schema,
    scope: z.literal("files-and-media"),
    mediaStopped: z.enum(["confirmed", "not-started"]),
    relatedIo: z.literal("settled"),
  })
  .refine(
    (proof) =>
      Buffer.byteLength(canonicalP1Json(proof), "utf8") <=
      MAX_FILE_STOP_PROOF_BYTES,
  );
export type ValidationFileStopProof = Readonly<
  z.infer<typeof validationFileStopProofSchema>
>;
export const validationAttemptSchema = z.strictObject({
  attemptId: importIdSchema,
  ordinal: z.number().int().min(1).max(MAX_ATTEMPTS),
  fence: z.number().int().min(1).max(2147483647),
  ownerPid: z.number().int().min(1).max(2147483647),
  ownerNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  kind: z.enum(["validate", "archive"]),
  reservationBytes: z.literal(VALIDATION_RESERVATION_BYTES),
  disposition: z.enum(["held", "released"]),
  mediaStop: z.enum(["not-started", "unconfirmed", "confirmed"]),
  /** Omitted only on historical v1 controls. New v2 claims explicitly persist null. */
  fileStopProof: validationFileStopProofSchema.nullable().optional(),
});
export type ValidationAttempt = z.infer<typeof validationAttemptSchema>;
export type ValidationBinding = Readonly<{
  identityText: string;
  identitySha256: string;
  archivePolicyVersion: string;
  archivePolicySha256: string;
  validationKey: string;
}>;
export type ValidationKeyInput = Readonly<{
  productId: string;
  importId: string;
  archiveSha256: string;
  archiveBytes: number;
  identitySha256: string;
  archivePolicyVersion: string;
  archivePolicySha256: string;
}>;
/** The only B key implementation. Request timing and attempt identity are deliberately excluded. */
const validationKeyInputSchema = z.strictObject({
  productId: packIdSchema,
  importId: importIdSchema,
  archiveSha256: sha256Schema,
  archiveBytes: z.number().int().min(1).max(33554432),
  identitySha256: sha256Schema,
  archivePolicyVersion: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[\x21-\x7e]+$/),
  archivePolicySha256: sha256Schema,
});
export function validationKey(input: ValidationKeyInput): string {
  const parsed = validationKeyInputSchema.safeParse(input);
  if (!parsed.success) throw new StudioError("INVALID_REQUEST");
  const v = parsed.data;
  return createHash("sha256")
    .update(
      canonicalP1Json({
        schemaVersion: "quizpack-validation-key.v1",
        productId: v.productId,
        importId: v.importId,
        archiveSha256: v.archiveSha256,
        archiveBytes: v.archiveBytes,
        identitySha256: v.identitySha256,
        archivePolicyVersion: v.archivePolicyVersion,
        archivePolicySha256: v.archivePolicySha256,
      }),
      "utf8",
    )
    .digest("hex");
}
export function serializeValidationAttempts(
  input: readonly ValidationAttempt[],
): string {
  const parsed = z
    .array(validationAttemptSchema)
    .min(1)
    .max(MAX_ATTEMPTS)
    .safeParse(input);
  if (
    !parsed.success ||
    parsed.data.some(
      (a, index) =>
        a.ordinal !== index + 1 ||
        (index > 0 && a.fence <= parsed.data[index - 1]!.fence),
    ) ||
    new Set(parsed.data.map((a) => a.attemptId)).size !== parsed.data.length
  )
    throw new StudioError("VALIDATION_STORAGE_CONFLICT");
  const text = canonicalP1Json(parsed.data);
  if (Buffer.byteLength(text, "utf8") > MAX_ATTEMPT_CONTROL_BYTES)
    throw new StudioError("VALIDATION_STORAGE_CONFLICT");
  return text;
}
export function parseValidationAttempts(text: string): ValidationAttempt[] {
  if (Buffer.byteLength(text, "utf8") > MAX_ATTEMPT_CONTROL_BYTES)
    throw new StudioError("VALIDATION_STORAGE_CONFLICT");
  try {
    const parsed = z
      .array(validationAttemptSchema)
      .min(1)
      .max(MAX_ATTEMPTS)
      .parse(JSON.parse(text));
    if (serializeValidationAttempts(parsed) !== text)
      throw new Error("Invalid controls");
    return parsed;
  } catch {
    throw new StudioError("VALIDATION_STORAGE_CONFLICT");
  }
}
export type ValidationRow = {
  id: string;
  product_id: string;
  import_id: string;
  created_by: string;
  created_at: DatabaseTime;
  validation_key: string;
  archive_sha256: string;
  archive_bytes: number;
  identity_text: string;
  identity_sha256: string;
  archive_policy_version: string;
  archive_policy_sha256: string;
  status: ValidationStatus;
  state_revision: number;
  updated_at: DatabaseTime;
  fence: number;
  lease_until: DatabaseTime | null;
  current_attempt_id: string;
  attempts_text: string;
  storage_condition: StorageCondition;
  last_error_code: ValidationErrorCode | null;
  reserved_bytes: string;
  accounted_bytes: string;
  evidence_text: string | null;
  evidence_sha256: string | null;
  report_texts: string[];
  evidence_metadata_text: string | null;
  pack_id: string | null;
  pack_version: string | null;
  container_schema_version: string | null;
  content_schema_version: string | null;
  content_kind: string | null;
  manifest_sha256: string | null;
  content_sha256: string | null;
  canonical_manifest_text: string | null;
  canonical_manifest_sha256: string | null;
  canonical_content_text: string | null;
  canonical_content_sha256: string | null;
  asset_set_text: string | null;
  asset_set_sha256: string | null;
  candidate_sha256: string | null;
  resource_count: number | null;
  identity_kind: IdentityKind;
  canonical_validation_id: string | null;
  validated_at: DatabaseTime | null;
  ready_at: DatabaseTime | null;
};
export type HeldValidation = Readonly<{
  namespace: "validation";
  id: string;
  attempts: ValidationAttempt[];
  reservedBytes: number;
  assetBlobHashes: string[] | null;
}>;
export type ValidationSummaryRow = Pick<
  ValidationRow,
  | "id"
  | "product_id"
  | "import_id"
  | "validation_key"
  | "state_revision"
  | "status"
  | "storage_condition"
  | "last_error_code"
  | "attempts_text"
  | "archive_sha256"
  | "archive_bytes"
  | "identity_text"
  | "identity_sha256"
  | "pack_id"
  | "pack_version"
  | "container_schema_version"
  | "content_schema_version"
  | "identity_kind"
  | "canonical_validation_id"
  | "candidate_sha256"
  | "asset_set_sha256"
  | "asset_set_text"
  | "resource_count"
  | "created_at"
  | "updated_at"
  | "validated_at"
  | "ready_at"
>;
export function validationDto(
  row: ValidationSummaryRow,
  archivedResourceCount: number,
): ValidationDto {
  const attempts = parseValidationAttempts(row.attempts_text);
  let identity: z.infer<typeof validationIdentitySchema>;
  try {
    identity = validationIdentitySchema.parse(JSON.parse(row.identity_text));
  } catch {
    throw new StudioError("EVIDENCE_INVALID");
  }
  return {
    id: row.id,
    productId: row.product_id,
    importId: row.import_id,
    validationKey: row.validation_key,
    stateRevision: row.state_revision,
    status: row.status,
    storageCondition: row.storage_condition,
    lastErrorCode: row.last_error_code,
    attemptCount: attempts.length,
    remainingAttempts: MAX_ATTEMPTS - attempts.length,
    maintenanceRequired:
      row.storage_condition !== "clean" ||
      attempts.some(
        (a) => a.disposition === "held" || a.mediaStop === "unconfirmed",
      ),
    archiveSha256: row.archive_sha256,
    archiveBytes: row.archive_bytes,
    identitySha256: row.identity_sha256,
    validatorBundleSha256: identity.validatorBundleSha256,
    packId: row.pack_id,
    packVersion: row.pack_version,
    containerSchemaVersion: row.container_schema_version,
    contentSchemaVersion: row.content_schema_version,
    identityKind: row.identity_kind,
    canonicalValidationId: row.canonical_validation_id,
    candidateSha256: row.candidate_sha256,
    assetSetSha256: row.asset_set_sha256,
    resourceCount: row.resource_count,
    archivedResourceCount,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
    validatedAt: nullableIso(row.validated_at),
    readyAt: nullableIso(row.ready_at),
    platformApproval: "unverified",
    publishable: false,
  };
}
export async function validationRow(
  tx: Tx,
  productId: string,
  importId: string,
  id: string,
  lock = false,
): Promise<ValidationRow> {
  const [row] = await tx<
    ValidationRow[]
  >`SELECT * FROM qf.quizpack_validation WHERE product_id=${productId} AND import_id=${importId} AND id=${id} ${lock ? tx`FOR UPDATE` : tx``}`;
  if (!row) throw new StudioError("VALIDATION_NOT_FOUND");
  parseValidationAttempts(row.attempts_text);
  return row;
}
export async function exactValidation(
  tx: Tx,
  productId: string,
  importId: string,
  key: string,
  lock = false,
): Promise<ValidationRow | null> {
  const [row] = await tx<
    ValidationRow[]
  >`SELECT * FROM qf.quizpack_validation WHERE product_id=${productId} AND import_id=${importId} AND validation_key=${key} ${lock ? tx`FOR UPDATE` : tx``}`;
  if (row) parseValidationAttempts(row.attempts_text);
  return row ?? null;
}
export async function archivedResourceCount(
  tx: Tx,
  row: Pick<ValidationRow, "product_id" | "asset_set_text">,
): Promise<number> {
  if (row.asset_set_text === null) return 0;
  const [count] = await tx<
    { total: number }[]
  >`SELECT count(*)::int total FROM jsonb_to_recordset((${row.asset_set_text}::jsonb)->'resources') AS r("resourceId" text,"resourceVersion" text,"productId" text,"blobSha256" text,"declarationSha256" text) JOIN qf.product_asset p ON p.product_id=${row.product_id} AND p.product_id=r."productId" AND p.resource_id=r."resourceId" AND p.resource_version=r."resourceVersion" AND p.blob_sha256=r."blobSha256" AND p.declaration_sha256=r."declarationSha256"`;
  if (!count) throw new StudioError("STUDIO_UNAVAILABLE");
  return count.total;
}
export async function validationRowDto(
  tx: Tx,
  row: ValidationSummaryRow,
): Promise<ValidationDto> {
  return validationDto(row, await archivedResourceCount(tx, row));
}
export const assetSetLedgerSchema = z
  .strictObject({
    schemaVersion: z.literal("quizpack-candidate-asset-set.v1"),
    productId: packIdSchema,
    resources: z
      .array(
        z.strictObject({
          resourceId: packIdSchema,
          resourceVersion: packVersionSchema,
          productId: packIdSchema,
          blobSha256: sha256Schema,
          declarationSha256: sha256Schema,
        }),
      )
      .min(1)
      .max(64),
  })
  .superRefine((set, ctx) => {
    const keys = set.resources.map(
      (r) => `${r.productId}/${r.resourceId}/${r.resourceVersion}`,
    );
    if (
      set.resources.some((r) => r.productId !== set.productId) ||
      new Set(keys).size !== keys.length ||
      set.resources.some(
        (r, i) =>
          i > 0 &&
          (r.resourceId < set.resources[i - 1]!.resourceId ||
            (r.resourceId === set.resources[i - 1]!.resourceId &&
              r.resourceVersion <= set.resources[i - 1]!.resourceVersion)),
      )
    )
      ctx.addIssue({ code: "custom", message: "Invalid asset set." });
  });
export async function heldValidations(
  sql: postgres.Sql | postgres.ReservedSql,
): Promise<HeldValidation[]> {
  type LedgerRow = Pick<
    ValidationRow,
    "id" | "attempts_text" | "reserved_bytes" | "asset_set_text"
  >;
  const rows = await sql<
    LedgerRow[]
  >`SELECT id,attempts_text,reserved_bytes,asset_set_text FROM qf.quizpack_validation WHERE reserved_bytes>0 ORDER BY id LIMIT ${MAX_VALIDATIONS + 1}`;
  if (rows.length > MAX_VALIDATIONS)
    throw new StudioError("VALIDATION_SCAN_LIMIT");
  return rows.map((row) => {
    let hashes: string[] | null = null;
    if (row.asset_set_text !== null) {
      try {
        if (Buffer.byteLength(row.asset_set_text, "utf8") > 65536)
          throw new Error("Invalid asset set.");
        const value = assetSetLedgerSchema.parse(
          JSON.parse(row.asset_set_text),
        );
        hashes = [...new Set(value.resources.map((r) => r.blobSha256))].sort();
      } catch {
        throw new StudioError("VALIDATION_STORAGE_CONFLICT");
      }
    }
    const reservedBytes = Number(row.reserved_bytes);
    if (
      !Number.isSafeInteger(reservedBytes) ||
      reservedBytes < 1 ||
      reservedBytes > 536870912
    )
      throw new StudioError("VALIDATION_STORAGE_CONFLICT");
    return {
      namespace: "validation",
      id: row.id,
      attempts: parseValidationAttempts(row.attempts_text),
      reservedBytes,
      assetBlobHashes: hashes,
    };
  });
}
export async function validationsPage(
  tx: Tx,
  productId: string,
  importId: string,
  query: ValidationListQuery,
): Promise<Page<ValidationDto>> {
  const filter = tx`product_id=${productId} AND import_id=${importId} AND ${query.status ? tx`status=${query.status}` : tx`true`} AND ${query.validationKey ? tx`validation_key=${query.validationKey}` : tx`true`}`;
  const [count] = await tx<
    { total: number }[]
  >`SELECT count(*)::int total FROM qf.quizpack_validation WHERE ${filter}`;
  if (!count) throw new StudioError("STUDIO_UNAVAILABLE");
  const rows = await tx<
    ValidationSummaryRow[]
  >`SELECT id,product_id,import_id,validation_key,state_revision,status,storage_condition,last_error_code,attempts_text,archive_sha256,archive_bytes,identity_text,identity_sha256,pack_id,pack_version,container_schema_version,content_schema_version,identity_kind,canonical_validation_id,candidate_sha256,asset_set_sha256,asset_set_text,resource_count,created_at,updated_at,validated_at,ready_at FROM qf.quizpack_validation WHERE ${filter} ORDER BY created_at DESC,id DESC LIMIT ${query.pageSize} OFFSET ${(query.page - 1) * query.pageSize}`;
  const items: ValidationDto[] = [];
  for (const row of rows) items.push(await validationRowDto(tx, row));
  return {
    items,
    page: query.page,
    pageSize: query.pageSize,
    total: count.total,
    hasNext: query.page * query.pageSize < count.total,
  };
}
