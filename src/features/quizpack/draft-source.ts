import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import type postgres from "postgres";
import { StudioError } from "@/lib/http-security/errors";
import { importIdSchema } from "./import/contracts";
import { canonicalP1Json } from "./v1/canonical";
import { packIdSchema, sha256Schema } from "./v1/manifest";
import { supportedManifestSchema } from "./package/manifest";
import { parseSupportedContent } from "./content/supported";
import { SUPPORTED_COMPATIBILITY_POLICY } from "./package/compatibility";
import { validationIdentitySchema } from "./server/validation/contracts";
import { assertPersistenceUnicode } from "./server/validation/unicode";
import { computeCandidateSha256 } from "./server/validation/candidate-hash";
import {
  ARCHIVE_POLICY_VERSION,
  archivePolicySha256,
  matchesSupportedArchiveIdentity,
} from "./validation/policy";
import {
  assetSetLedgerSchema,
  parseValidationAttempts,
  type ValidationRow,
} from "./validation/repository";

const scopeSchema = z.strictObject({
  productId: packIdSchema,
  sourceImportId: importIdSchema,
  sourceValidationId: importIdSchema,
});
const expectedSchema = z.strictObject({
  expectedValidationStateRevision: z.number().int().min(1).max(2_147_483_647),
  expectedCandidateSha256: sha256Schema,
});
export type DraftSourceScope = Readonly<z.infer<typeof scopeSchema>>;
export type DraftSourceExpected = Readonly<z.infer<typeof expectedSchema>>;
type SourceImportRow = {
  id: string;
  product_id: string;
  status: string;
  target_kind: string;
  actual_archive_sha256: string | null;
  actual_archive_bytes: number | null;
};
type SourceValidationRow = Pick<
  ValidationRow,
  | "id"
  | "product_id"
  | "import_id"
  | "state_revision"
  | "status"
  | "storage_condition"
  | "reserved_bytes"
  | "lease_until"
  | "attempts_text"
  | "archive_sha256"
  | "archive_bytes"
  | "identity_sha256"
  | "identity_text"
  | "archive_policy_version"
  | "archive_policy_sha256"
  | "canonical_manifest_text"
  | "canonical_manifest_sha256"
  | "canonical_content_text"
  | "canonical_content_sha256"
  | "asset_set_text"
  | "asset_set_sha256"
  | "candidate_sha256"
  | "container_schema_version"
  | "content_schema_version"
  | "content_kind"
  | "pack_id"
  | "pack_version"
  | "resource_count"
  | "identity_kind"
  | "ready_at"
>;
type AssetRow = {
  product_id: string;
  resource_id: string;
  resource_version: string;
  blob_sha256: string;
  declaration_text: string;
  declaration_sha256: string;
  purpose: string;
  platform_approval: string;
  blob_hash: string;
  blob_bytes: number;
  media_type: string;
  width: number;
  height: number;
  frames: number;
  storage_key: string;
};
export type ReadyDraftSource = Readonly<{
  productId: string;
  sourceImportId: string;
  sourceValidationId: string;
  sourceValidationStateRevision: number;
  canonicalContentText: string;
  canonicalContentSha256: string;
  assetSetText: string;
  assetSetSha256: string;
  canonicalManifestSha256: string;
  candidateSha256: string;
  containerSchemaVersion: "quizpack.v1";
  contentSchemaVersion: "quizpack-content.v1" | "quizpack-content.v2";
  contentKind: "synthetic" | "authored";
  packId: string;
  packVersion: string;
  resourceCount: number;
  versions: Readonly<{
    contentVersion: string;
    visualVersion: string;
    reportVersion: string;
    resourceVersion: string;
    componentVersion: string;
    engine: Readonly<{ id: "dimensions" | "archetype"; version: "1.0.0" }>;
  }>;
}>;
const invalid = (): never => {
  throw new StudioError("DRAFT_SOURCE_INVALID");
};
const hash = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
function canonical<T>(
  text: string | null,
  digest: string | null,
  limit: number,
  schema: z.ZodType<T>,
  budget: "content" | "manifest" = "content",
): T {
  if (
    text === null ||
    digest === null ||
    Buffer.byteLength(text, "utf8") > limit ||
    hash(text) !== digest
  )
    return invalid();
  const parsed = schema.parse(JSON.parse(text));
  assertPersistenceUnicode(parsed);
  if (canonicalP1Json(parsed, budget) !== text) return invalid();
  return parsed;
}
function inspectSource(
  row: SourceValidationRow,
  original: SourceImportRow,
  scope: DraftSourceScope,
  expected: DraftSourceExpected,
) {
  if (
    row.id !== scope.sourceValidationId ||
    row.product_id !== scope.productId ||
    row.import_id !== scope.sourceImportId ||
    original.id !== scope.sourceImportId ||
    original.product_id !== scope.productId
  )
    return invalid();
  if (row.state_revision !== expected.expectedValidationStateRevision)
    throw new StudioError(
      "DRAFT_SOURCE_CHANGED",
      Number.isInteger(row.state_revision) &&
        row.state_revision > 0 &&
        row.state_revision <= 2_147_483_647
        ? row.state_revision
        : undefined,
    );
  if (
    original.status !== "received" ||
    original.target_kind !== "new-draft" ||
    row.status !== "ready" ||
    row.storage_condition !== "clean" ||
    row.reserved_bytes !== "0" ||
    row.lease_until !== null ||
    row.ready_at === null ||
    !["canonical", "alias"].includes(row.identity_kind) ||
    row.archive_policy_version !== ARCHIVE_POLICY_VERSION ||
    row.archive_policy_sha256 !== archivePolicySha256 ||
    row.container_schema_version !== "quizpack.v1" ||
    original.actual_archive_sha256 !== row.archive_sha256 ||
    original.actual_archive_bytes !== row.archive_bytes
  )
    return invalid();
  const identity = validationIdentitySchema.parse(
    JSON.parse(row.identity_text),
  );
  if (
    !matchesSupportedArchiveIdentity(
      row.archive_policy_version,
      row.archive_policy_sha256,
      identity,
    ) ||
    identity.identitySha256 !== row.identity_sha256 ||
    canonicalP1Json(identity) !== row.identity_text
  )
    return invalid();
  if (row.candidate_sha256 === null) return invalid();
  if (row.candidate_sha256 !== expected.expectedCandidateSha256)
    throw new StudioError("DRAFT_SOURCE_CHANGED", row.state_revision);
  const attempts = parseValidationAttempts(row.attempts_text);
  if (
    attempts.some((a) => {
      const proof = a.fileStopProof;
      return (
        a.disposition !== "released" ||
        a.mediaStop === "unconfirmed" ||
        !proof ||
        proof.validationId !== row.id ||
        proof.attemptId !== a.attemptId ||
        proof.fence !== a.fence ||
        proof.ownerPid !== a.ownerPid ||
        proof.ownerNonce !== a.ownerNonce ||
        proof.mediaStopped !== a.mediaStop
      );
    })
  )
    return invalid();
  const manifest = canonical(
    row.canonical_manifest_text,
    row.canonical_manifest_sha256,
    524_288,
    supportedManifestSchema,
    "manifest",
  );
  const content = canonical(
    row.canonical_content_text,
    row.canonical_content_sha256,
    2_097_152,
    z.unknown().transform((input) => {
      const parsed = parseSupportedContent(input);
      return parsed.ok ? parsed.value : invalid();
    }),
  );
  const assets = canonical(
    row.asset_set_text,
    row.asset_set_sha256,
    65_536,
    assetSetLedgerSchema,
  );
  if (
    manifest.productId !== scope.productId ||
    content.product.productId !== scope.productId ||
    assets.productId !== scope.productId ||
    content.kind !== row.content_kind ||
    manifest.packId !== row.pack_id ||
    manifest.packVersion !== row.pack_version ||
    content.schemaVersion !== row.content_schema_version ||
    manifest.contentSchemaVersion !== content.schemaVersion ||
    canonicalP1Json(manifest.engine) !== canonicalP1Json(content.engine) ||
    content.resources.length !== row.resource_count ||
    assets.resources.length !== row.resource_count
  )
    return invalid();
  const profile = SUPPORTED_COMPATIBILITY_POLICY.profiles.find(
    (p) => p.contentSchemaVersion === content.schemaVersion,
  );
  if (
    !profile ||
    content.componentVersion !== profile.componentVersion ||
    manifest.components.length !== 6 ||
    Object.entries(profile.states).some(([state, id]) => {
      const component =
        content.layouts[state as keyof typeof content.layouts].component;
      return (
        component.id !== id ||
        component.version !== profile.componentVersion ||
        component.propsSchemaVersion !== profile.propsSchemaVersion ||
        manifest.components.filter(
          (c) =>
            c.id === id &&
            c.version === profile.componentVersion &&
            c.propsSchemaVersion === profile.propsSchemaVersion,
        ).length !== 1
      );
    })
  )
    return invalid();
  const resources = [...content.resources].sort((a, b) =>
    a.id < b.id
      ? -1
      : a.id > b.id
        ? 1
        : a.version < b.version
          ? -1
          : a.version > b.version
            ? 1
            : 0,
  );
  const expectedAssets = {
    schemaVersion: "quizpack-candidate-asset-set.v1",
    productId: scope.productId,
    resources: resources.map((resource) => ({
      productId: resource.productId,
      resourceId: resource.id,
      resourceVersion: resource.version,
      blobSha256: resource.sha256,
      declarationSha256: hash(canonicalP1Json(resource)),
    })),
  };
  if (
    canonicalP1Json(expectedAssets) !== row.asset_set_text ||
    resources.some((r) => r.productId !== scope.productId)
  )
    return invalid();
  if (
    computeCandidateSha256({
      archiveSha256: row.archive_sha256,
      canonicalManifestSha256: row.canonical_manifest_sha256!,
      canonicalContentSha256: row.canonical_content_sha256!,
      assetSetSha256: row.asset_set_sha256!,
      identitySha256: row.identity_sha256,
    }) !== row.candidate_sha256
  )
    return invalid();
  return { content, resources };
}
/** Called only after current write authorization and Product row lock; owns all cross-domain source queries. No FS/media IO. */
export async function readReadyDraftSource(
  tx: postgres.TransactionSql,
  scopeInput: DraftSourceScope,
  expectedInput: DraftSourceExpected,
): Promise<ReadyDraftSource> {
  const scoped = scopeSchema.safeParse(scopeInput),
    expectedResult = expectedSchema.safeParse(expectedInput);
  if (!scoped.success || !expectedResult.success)
    throw new StudioError("INVALID_REQUEST");
  const scope = scoped.data,
    expected = expectedResult.data;
  const [original] = await tx<
    SourceImportRow[]
  >`SELECT id,product_id,status,target_kind,actual_archive_sha256,actual_archive_bytes FROM qf.quizpack_import WHERE product_id=${scope.productId} AND id=${scope.sourceImportId} FOR UPDATE`;
  if (!original) return invalid();
  const [row] = await tx<
    SourceValidationRow[]
  >`SELECT id,product_id,import_id,state_revision,status,storage_condition,reserved_bytes,lease_until,attempts_text,archive_sha256,archive_bytes,identity_sha256,identity_text,archive_policy_version,archive_policy_sha256,canonical_manifest_text,canonical_manifest_sha256,canonical_content_text,canonical_content_sha256,asset_set_text,asset_set_sha256,candidate_sha256,container_schema_version,content_schema_version,content_kind,pack_id,pack_version,resource_count,identity_kind,ready_at FROM qf.quizpack_validation WHERE product_id=${scope.productId} AND import_id=${scope.sourceImportId} AND id=${scope.sourceValidationId} FOR UPDATE`;
  if (!row) return invalid();
  let inspected: ReturnType<typeof inspectSource>;
  try {
    inspected = inspectSource(row, original, scope, expected);
  } catch (error) {
    if (error instanceof StudioError && error.code === "DRAFT_SOURCE_CHANGED")
      throw error;
    return invalid();
  }
  const stored = await tx<
    AssetRow[]
  >`SELECT p.product_id,p.resource_id,p.resource_version,p.blob_sha256,p.declaration_text,p.declaration_sha256,p.purpose,p.platform_approval,b.sha256 AS blob_hash,b.bytes AS blob_bytes,b.media_type,b.width,b.height,b.frames,b.storage_key FROM jsonb_to_recordset((${row.asset_set_text}::jsonb)->'resources') AS r("resourceId" text,"resourceVersion" text) JOIN qf.product_asset p ON p.product_id=${scope.productId} AND p.resource_id=r."resourceId" AND p.resource_version=r."resourceVersion" JOIN qf.asset_blob b ON b.sha256=p.blob_sha256 LIMIT 65`;
  const { content, resources } = inspected;
  if (
    stored.length !== resources.length ||
    resources.some((resource) => {
      const matches = stored.filter(
        (s) =>
          s.product_id === scope.productId &&
          s.resource_id === resource.id &&
          s.resource_version === resource.version,
      );
      if (matches.length !== 1) return true;
      const s = matches[0]!,
        declaration = canonicalP1Json(resource);
      return (
        s.blob_sha256 !== resource.sha256 ||
        s.declaration_text !== declaration ||
        s.declaration_sha256 !== hash(declaration) ||
        s.purpose !== resource.purpose ||
        s.platform_approval !== "unverified" ||
        s.blob_hash !== resource.sha256 ||
        s.blob_bytes !== resource.bytes ||
        s.media_type !== resource.mediaType ||
        s.width !== resource.width ||
        s.height !== resource.height ||
        s.frames !== 1 ||
        s.storage_key !== `blobs/${resource.sha256}.blob`
      );
    })
  )
    return invalid();
  return Object.freeze({
    productId: scope.productId,
    sourceImportId: scope.sourceImportId,
    sourceValidationId: scope.sourceValidationId,
    sourceValidationStateRevision: row.state_revision,
    canonicalContentText: row.canonical_content_text!,
    canonicalContentSha256: row.canonical_content_sha256!,
    assetSetText: row.asset_set_text!,
    assetSetSha256: row.asset_set_sha256!,
    canonicalManifestSha256: row.canonical_manifest_sha256!,
    candidateSha256: row.candidate_sha256!,
    containerSchemaVersion: "quizpack.v1",
    contentSchemaVersion: content.schemaVersion,
    contentKind: content.kind,
    packId: row.pack_id!,
    packVersion: row.pack_version!,
    resourceCount: resources.length,
    versions: Object.freeze({
      contentVersion: content.contentVersion,
      visualVersion: content.visualVersion,
      reportVersion: content.reportVersion,
      resourceVersion: content.resourceVersion,
      componentVersion: content.componentVersion,
      engine: Object.freeze({ ...content.engine }),
    }),
  });
}
