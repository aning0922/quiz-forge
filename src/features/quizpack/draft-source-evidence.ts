import "server-only";
import { createHash } from "node:crypto";
import type postgres from "postgres";
import { StudioError } from "@/lib/http-security/errors";
import {
  readReadyDraftSourceReadonly,
  type DraftSourceScope,
  type DraftSourceExpected,
  type ReadyDraftSource,
} from "./draft-source";
import { canonicalP1Json } from "./v1/canonical";
import {
  validationIdentitySchema,
  evidenceEnvelopeSchema,
} from "./server/validation/contracts";
import { serializeEvidenceSqlProjection } from "./server/validation/sql-projection";
import { EVIDENCE_LIMITS, freezeJson } from "./server/validation/report";
import type { ValidationRow } from "./validation/repository";
import type { ContentReference } from "./v1/content";

export type DraftSourceResource = Readonly<{
  resourceRef: ContentReference;
  sha256: string;
  bytes: number;
  mediaType: "image/png" | "image/jpeg" | "image/webp";
  width: number;
  height: number;
  frames: 1;
  storageKey: string;
  declarationSha256: string;
}>;

type EvidenceRow = Pick<
  ValidationRow,
  | "identity_text"
  | "identity_sha256"
  | "archive_sha256"
  | "archive_bytes"
  | "archive_policy_version"
  | "archive_policy_sha256"
  | "evidence_text"
  | "evidence_sha256"
  | "report_texts"
  | "evidence_metadata_text"
  | "attempts_text"
  | "manifest_sha256"
  | "content_sha256"
  | "identity_kind"
  | "canonical_validation_id"
>;
export type ReadyDraftSourceEvidence = ReadyDraftSource &
  Readonly<{
    validation: Readonly<{
      sourceImportId: string;
      sourceValidationId: string;
      sourceValidationStateRevision: number;
      archiveSha256: string;
      candidateSha256: string;
      identitySha256: string;
      validatorBundleSha256: string;
      archivePolicyVersion: string;
      archivePolicySha256: string;
      evidenceSha256: string;
    }>;
    resources: readonly DraftSourceResource[];
  }>;
const invalid = (): never => {
  throw new StudioError("DRAFT_SOURCE_INVALID");
};
const hash = (text: string) =>
  createHash("sha256").update(text, "utf8").digest("hex");
/** Same RR transaction as the exact immutable revision observation. Raw evidence never enters DTO/snapshot. */
export async function readReadyDraftSourceEvidenceReadonly(
  tx: postgres.TransactionSql,
  scope: DraftSourceScope,
  expected: DraftSourceExpected,
): Promise<ReadyDraftSourceEvidence> {
  const source = await readReadyDraftSourceReadonly(tx, scope, expected);
  const [row] = await tx<
    EvidenceRow[]
  >`SELECT identity_text,identity_sha256,archive_sha256,archive_bytes,archive_policy_version,archive_policy_sha256,evidence_text,evidence_sha256,report_texts,evidence_metadata_text,attempts_text,manifest_sha256,content_sha256,identity_kind,canonical_validation_id FROM qf.quizpack_validation WHERE product_id=${source.productId} AND import_id=${source.sourceImportId} AND id=${source.sourceValidationId}`;
  if (!row) return invalid();
  try {
    if (
      !row.evidence_text ||
      !row.evidence_sha256 ||
      !row.evidence_metadata_text ||
      Buffer.byteLength(row.evidence_text) > EVIDENCE_LIMITS.envelopeBytes ||
      Buffer.byteLength(row.evidence_metadata_text) >
        EVIDENCE_LIMITS.metadataBytes ||
      row.report_texts.some(
        (t) => Buffer.byteLength(t) > EVIDENCE_LIMITS.reportBytes,
      ) ||
      Buffer.byteLength(row.identity_text) > 16384 ||
      hash(row.evidence_text) !== row.evidence_sha256
    )
      return invalid();
    const identity = validationIdentitySchema.parse(
      JSON.parse(row.identity_text),
    );
    if (
      identity.identitySha256 !== row.identity_sha256 ||
      canonicalP1Json(identity) !== row.identity_text
    )
      return invalid();
    const parsed: unknown = JSON.parse(row.evidence_text);
    const projection = serializeEvidenceSqlProjection(
      parsed,
      row.attempts_text,
    );
    if (
      !projection.ok ||
      projection.value.evidenceText !== row.evidence_text ||
      projection.value.evidenceSha256 !== row.evidence_sha256 ||
      projection.value.metadataText !== row.evidence_metadata_text ||
      projection.value.reportTexts.length !== row.report_texts.length ||
      projection.value.reportTexts.some((t, i) => t !== row.report_texts[i])
    )
      return invalid();
    const envelope = evidenceEnvelopeSchema.parse(parsed);
    const accepted = envelope.attempts.flatMap(({ result }) =>
      result.outcome === "accepted" ? [result] : [],
    );
    if (accepted.length !== 1) return invalid();
    const a = accepted[0]!.evidence;
    if (
      a.input.status !== "snapshotted" ||
      a.input.targetProductId !== source.productId ||
      a.input.archiveSha256 !== row.archive_sha256 ||
      a.input.archiveBytes !== row.archive_bytes ||
      a.identity.status !== "bound" ||
      canonicalP1Json(a.identity.value) !== row.identity_text ||
      a.report.status !== "sealed" ||
      a.report.value.manifestSha256 !== row.manifest_sha256 ||
      a.report.value.contentSha256 !== row.content_sha256
    )
      return invalid();
    const content = JSON.parse(source.canonicalContentText) as {
      resources: {
        productId: string;
        id: string;
        version: string;
        sha256: string;
        bytes: number;
        mediaType: "image/png" | "image/jpeg" | "image/webp";
        width: number;
        height: number;
      }[];
    };
    return freezeJson({
      ...source,
      validation: {
        sourceImportId: source.sourceImportId,
        sourceValidationId: source.sourceValidationId,
        sourceValidationStateRevision: source.sourceValidationStateRevision,
        archiveSha256: row.archive_sha256,
        candidateSha256: source.candidateSha256,
        identitySha256: row.identity_sha256,
        validatorBundleSha256: identity.validatorBundleSha256,
        archivePolicyVersion: row.archive_policy_version,
        archivePolicySha256: row.archive_policy_sha256,
        evidenceSha256: row.evidence_sha256,
      },
      resources: content.resources.map((r) => ({
        resourceRef: { productId: r.productId, id: r.id, version: r.version },
        sha256: r.sha256,
        bytes: r.bytes,
        mediaType: r.mediaType,
        width: r.width,
        height: r.height,
        frames: 1 as const,
        storageKey: `blobs/${r.sha256}.blob`,
        declarationSha256: hash(canonicalP1Json(r)),
      })),
    });
  } catch {
    return invalid();
  }
}
