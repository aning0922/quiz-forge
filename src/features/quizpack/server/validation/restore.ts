import "server-only";
import { createHash } from "node:crypto";
import { types } from "node:util";
import { z } from "zod";
import type { MediaOperationContext } from "../media";
import { canonicalP1Json } from "../../v1/canonical";
import { P1_CANONICAL_LIMITS } from "../../v1/canonical";
import { PACK_LIMITS } from "../../v1/limits";
import {
  packIdSchema,
  packVersionSchema,
  sha256Schema,
} from "../../v1/manifest";
import { checkArchiveIntegrity } from "../../v1/validate-core";
import { readRestrictedZipCore, type RestrictedZip } from "../../v1/zip";
import {
  evidenceEnvelopeSchema,
  type CandidateResultEvidence,
} from "./contracts";
import {
  preparePrivateCandidate,
  issuePreparedCandidate,
} from "./private-candidate";
import {
  consumePreparedIdentity,
  validationCompletionSchema,
} from "./prepared";
import {
  createValidationOperationScope,
  ValidationInterrupted,
} from "./operation-scope";
import { serializeEvidenceSqlProjection } from "./sql-projection";
import { freezeJson, EVIDENCE_LIMITS } from "./report";
import { assertUnicodeString } from "./unicode";
import {
  RESTORE_INTERRUPTION_CODES,
  RESTORE_UNAVAILABLE_CODES,
  type RestoreCandidateInput,
  type RestoreResult,
} from "./adapter-types";
const hash = (value: Uint8Array | string) =>
  createHash("sha256").update(value).digest("hex");
class RestoreUnavailable extends Error {
  constructor(readonly code: (typeof RESTORE_UNAVAILABLE_CODES)[number]) {
    super("Trusted candidate unavailable.");
  }
}
const boundedText = (bytes: number) => z.string().max(bytes);
export const frozenValidationEvidenceSchema = z.strictObject({
  evidenceText: boundedText(EVIDENCE_LIMITS.envelopeBytes),
  evidenceSha256: sha256Schema,
  reportTexts: z.array(boundedText(EVIDENCE_LIMITS.reportBytes)).max(3),
  metadataText: boundedText(EVIDENCE_LIMITS.metadataBytes),
  attemptsControlText: boundedText(8192),
});
export const expectedCandidateFactsSchema = z.strictObject({
  archiveSha256: sha256Schema,
  archiveBytes: z.number().int().min(1).max(PACK_LIMITS.archiveBytes),
  productId: packIdSchema,
  packId: packIdSchema,
  packVersion: packVersionSchema,
  containerSchemaVersion: z.literal("quizpack.v1"),
  contentSchemaVersion: z.literal("quizpack-content.v1"),
  contentKind: z.literal("synthetic"),
  manifestSha256: sha256Schema,
  contentSha256: sha256Schema,
  canonicalManifestText: boundedText(P1_CANONICAL_LIMITS.manifest),
  canonicalManifestSha256: sha256Schema,
  canonicalContentText: boundedText(P1_CANONICAL_LIMITS.content),
  canonicalContentSha256: sha256Schema,
  assetSetText: boundedText(EVIDENCE_LIMITS.resourceDeclarationBytes),
  assetSetSha256: sha256Schema,
  candidateSha256: sha256Schema,
  resourceCount: z.number().int().min(1).max(64),
});
export const restoreResultEvidenceSchema = z
  .discriminatedUnion("outcome", [
    z.strictObject({
      outcome: z.literal("restored"),
      completion: z.strictObject({
        mediaStopped: z.literal("not-started"),
        relatedIo: z.literal("settled"),
        maintenanceRequired: z.literal(false),
      }),
    }),
    z.strictObject({
      outcome: z.literal("unavailable"),
      code: z.enum(RESTORE_UNAVAILABLE_CODES),
      completion: validationCompletionSchema,
    }),
    z.strictObject({
      outcome: z.literal("interrupted"),
      code: z.enum(RESTORE_INTERRUPTION_CODES),
      completion: validationCompletionSchema,
    }),
  ])
  .superRefine((v, c) => {
    if (
      v.outcome !== "restored" &&
      (v.completion.mediaStopped === "confirmed" ||
        (v.outcome === "unavailable" && v.completion.maintenanceRequired) ||
        (v.outcome === "interrupted" &&
          v.code === "RELATED_IO_UNCONFIRMED" &&
          v.completion.relatedIo !== "unconfirmed"))
    )
      c.addIssue({
        code: "custom",
        message: "Invalid restoration completion.",
      });
  });
/** Copy only ordinary bounded records/arrays without invoking getters or proxies.
 * Each large SQL text is bounded separately, not wrapped in another canonical budget. */
function ordinary(input: unknown, depth = 0): unknown {
  if (typeof input === "string") {
    if (input.length > P1_CANONICAL_LIMITS.content) throw 0;
    assertUnicodeString(input);
    return input;
  }
  if (input === null || typeof input === "boolean" || typeof input === "number")
    return input;
  if (
    typeof input !== "object" ||
    types.isProxy(input) ||
    depth > 2 ||
    Object.getOwnPropertySymbols(input).length
  )
    throw 0;
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (Array.isArray(input)) {
    if (
      Object.getPrototypeOf(input) !== Array.prototype ||
      input.length > 3 ||
      Object.keys(descriptors).length !== input.length + 1
    )
      throw 0;
    return Array.from({ length: input.length }, (_, i) => {
      const d = descriptors[String(i)];
      if (!d || !("value" in d) || !d.enumerable) throw 0;
      return ordinary(d.value, depth + 1);
    });
  }
  if (
    ![Object.prototype, null].includes(Object.getPrototypeOf(input)) ||
    Object.keys(descriptors).length > 32
  )
    throw 0;
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, d] of Object.entries(descriptors)) {
    if (!("value" in d) || !d.enumerable) throw 0;
    result[key] = ordinary(d.value, depth + 1);
  }
  return result;
}
function parts(input: RestoreCandidateInput): RestoreCandidateInput {
  if (
    !input ||
    typeof input !== "object" ||
    types.isProxy(input) ||
    Object.getOwnPropertySymbols(input).length ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))
  )
    throw new ValidationInterrupted("INVALID_CONTEXT");
  const descriptors = Object.getOwnPropertyDescriptors(input);
  if (
    Object.keys(descriptors).sort().join() !==
      "expectedFacts,frozenEvidence,prepared" ||
    Object.values(descriptors).some((d) => !("value" in d) || !d.enumerable)
  )
    throw new ValidationInterrupted("INVALID_CONTEXT");
  return {
    prepared: descriptors.prepared!.value!,
    frozenEvidence: descriptors.frozenEvidence!.value!,
    expectedFacts: descriptors.expectedFacts!.value!,
  };
}
function assertTextBytes(value: string, maximum: number): void {
  if (Buffer.byteLength(value, "utf8") > maximum) throw 0;
}
/** Claim-after archive restoration. No binding, policy CLI, inspector, or report execution exists here. */
export async function restoreValidatedCandidate(
  archive: Uint8Array,
  input: RestoreCandidateInput,
  context: MediaOperationContext,
): Promise<RestoreResult> {
  const scope = createValidationOperationScope(context);
  try {
    const data = parts(input),
      identity = consumePreparedIdentity(data.prepared, scope);
    let frozen: z.infer<typeof frozenValidationEvidenceSchema>;
    let accepted: Extract<CandidateResultEvidence, { outcome: "accepted" }>;
    try {
      frozen = freezeJson(
        frozenValidationEvidenceSchema.parse(ordinary(data.frozenEvidence)),
      );
      assertTextBytes(frozen.evidenceText, EVIDENCE_LIMITS.envelopeBytes);
      assertTextBytes(frozen.metadataText, EVIDENCE_LIMITS.metadataBytes);
      for (const text of frozen.reportTexts)
        assertTextBytes(text, EVIDENCE_LIMITS.reportBytes);
      if (hash(frozen.evidenceText) !== frozen.evidenceSha256) throw 0;
      const parsed: unknown = JSON.parse(frozen.evidenceText);
      const projection = serializeEvidenceSqlProjection(
        parsed,
        frozen.attemptsControlText,
      );
      if (
        !projection.ok ||
        projection.value.evidenceText !== frozen.evidenceText ||
        projection.value.evidenceSha256 !== frozen.evidenceSha256 ||
        projection.value.metadataText !== frozen.metadataText ||
        projection.value.reportTexts.length !== frozen.reportTexts.length ||
        projection.value.reportTexts.some(
          (text, i) => text !== frozen.reportTexts[i],
        )
      )
        throw 0;
      const envelope = evidenceEnvelopeSchema.parse(parsed);
      const results = envelope.attempts.flatMap(({ result }) =>
        result.outcome === "accepted" ? [result] : [],
      );
      if (results.length !== 1) throw 0;
      accepted = freezeJson(results[0]!);
    } catch {
      throw new RestoreUnavailable("FROZEN_EVIDENCE_INVALID");
    }
    if (
      accepted.evidence.identity.status !== "bound" ||
      canonicalP1Json(identity) !==
        canonicalP1Json(accepted.evidence.identity.value)
    )
      throw new RestoreUnavailable("REVALIDATION_REQUIRED");
    let expected: z.infer<typeof expectedCandidateFactsSchema>;
    try {
      expected = freezeJson(
        expectedCandidateFactsSchema.parse(ordinary(data.expectedFacts)),
      );
      assertTextBytes(
        expected.canonicalManifestText,
        P1_CANONICAL_LIMITS.manifest,
      );
      assertTextBytes(
        expected.canonicalContentText,
        P1_CANONICAL_LIMITS.content,
      );
      assertTextBytes(
        expected.assetSetText,
        EVIDENCE_LIMITS.resourceDeclarationBytes,
      );
    } catch {
      throw new RestoreUnavailable("FROZEN_FACTS_MISMATCH");
    }
    if (
      !(archive instanceof Uint8Array) ||
      types.isProxy(archive) ||
      archive.buffer instanceof SharedArrayBuffer ||
      archive.byteLength > PACK_LIMITS.archiveBytes
    )
      throw new RestoreUnavailable("ARCHIVE_BINDING_MISMATCH");
    // Original raw bytes are owned before the first await and never replaced by rebuilt ZIP bytes.
    const snapshot = Buffer.from(archive),
      archiveSha256 = hash(snapshot);
    if (
      accepted.evidence.input.status !== "snapshotted" ||
      accepted.evidence.report.status !== "sealed" ||
      snapshot.length !== expected.archiveBytes ||
      snapshot.length !== accepted.evidence.input.archiveBytes ||
      archiveSha256 !== expected.archiveSha256 ||
      archiveSha256 !== accepted.evidence.input.archiveSha256 ||
      archiveSha256 !== accepted.evidence.report.value.archiveSha256 ||
      expected.productId !== accepted.evidence.input.targetProductId
    )
      throw new RestoreUnavailable("ARCHIVE_BINDING_MISMATCH");
    scope.checkpoint();
    let zip: RestrictedZip;
    try {
      zip = await scope.awaitOperationTask(
        readRestrictedZipCore(
          (async function* () {
            yield snapshot;
          })(),
          {
            signal: context.signal,
            limits: PACK_LIMITS,
            checkpoint: scope.checkpoint,
            trackIo: scope.trackIo,
          },
        ),
      );
    } catch (error) {
      if (error instanceof ValidationInterrupted) throw error;
      throw new RestoreUnavailable("ARCHIVE_BINDING_MISMATCH");
    }
    scope.checkpoint();
    if (zip.archiveSha256 !== archiveSha256)
      throw new RestoreUnavailable("ARCHIVE_BINDING_MISMATCH");
    let facts: ReturnType<typeof preparePrivateCandidate>;
    try {
      facts = preparePrivateCandidate(accepted, zip.files);
      if (checkArchiveIntegrity(facts.manifest, zip.files).length) throw 0;
      const report = accepted.evidence.report.value;
      if (
        facts.archiveSha256 !== expected.archiveSha256 ||
        facts.productId !== expected.productId ||
        facts.packId !== expected.packId ||
        facts.packVersion !== expected.packVersion ||
        facts.manifest.schemaVersion !== expected.containerSchemaVersion ||
        facts.content.schemaVersion !== expected.contentSchemaVersion ||
        facts.content.kind !== expected.contentKind ||
        report.manifestSha256 !== expected.manifestSha256 ||
        report.contentSha256 !== expected.contentSha256 ||
        facts.canonicalManifestText !== expected.canonicalManifestText ||
        facts.canonicalManifestSha256 !== expected.canonicalManifestSha256 ||
        facts.canonicalContentText !== expected.canonicalContentText ||
        facts.canonicalContentSha256 !== expected.canonicalContentSha256 ||
        facts.assetSetText !== expected.assetSetText ||
        facts.assetSetSha256 !== expected.assetSetSha256 ||
        facts.candidateSha256 !== expected.candidateSha256 ||
        facts.resources.length !== expected.resourceCount
      )
        throw 0;
    } catch {
      throw new RestoreUnavailable("FROZEN_FACTS_MISMATCH");
    }
    await scope.settleIo();
    scope.checkpoint();
    if (scope.completion().relatedIo !== "settled")
      throw new ValidationInterrupted("RELATED_IO_UNCONFIRMED");
    const sealed = restoreResultEvidenceSchema.parse({
      outcome: "restored",
      completion: scope.completion(),
    });
    if (sealed.outcome !== "restored")
      throw new ValidationInterrupted("BRIDGE_INTERNAL_FAILED");
    scope.checkpoint();
    return Object.freeze({
      ...freezeJson(sealed),
      candidate: issuePreparedCandidate(facts),
    });
  } catch (error) {
    scope.requestStop(scope.runtimeFailure === "STOP_UNCONFIRMED");
    await scope.settleIo();
    const completion = scope.completion();
    const result =
      error instanceof RestoreUnavailable && !completion.maintenanceRequired
        ? { outcome: "unavailable", code: error.code, completion }
        : {
            outcome: "interrupted",
            code:
              completion.relatedIo === "unconfirmed"
                ? "RELATED_IO_UNCONFIRMED"
                : error instanceof ValidationInterrupted &&
                    RESTORE_INTERRUPTION_CODES.includes(
                      error.code as (typeof RESTORE_INTERRUPTION_CODES)[number],
                    )
                  ? error.code
                  : "BRIDGE_INTERNAL_FAILED",
            completion,
          };
    const sealed = restoreResultEvidenceSchema.parse(result);
    if (sealed.outcome === "restored")
      throw new ValidationInterrupted("BRIDGE_INTERNAL_FAILED");
    return freezeJson(sealed);
  }
}
