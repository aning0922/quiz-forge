import "server-only";
import { createHash } from "node:crypto";
import {
  displayPosterV1Schema,
  resultDisplaySnapshotV1Schema,
  type DisplayAssetV1,
  type DisplayPosterV1,
  type ResultDisplaySnapshotV1,
} from "@/lib/assessment-contract/display-v1";
import type { PreviewResult } from "@/features/product/preview/contracts";
import { PREVIEW_LIMITS } from "@/features/product/preview/limits";
import {
  contentScoreSchema,
  type ContentScore,
} from "@/features/quizpack/content/scoring-adapter";
import { parseSupportedContent } from "@/features/quizpack/content/supported";
import type { QuizPackContentV2 } from "@/features/quizpack/content/v2";
import type { ContentReference } from "@/features/quizpack/v1/content";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { assertPersistenceUnicode } from "@/features/quizpack/server/validation/unicode";
import { displayHalfUp } from "@/features/quiz/scoring/rational";
import { supportsPreviewContent, projectPreviewLayout } from "./registry";
import { boundedOutput, failure, isBoundaryLimit } from "./boundary";
const hash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const ref = ({
  id,
  productId,
  version,
}: ContentReference): ContentReference => ({ id, productId, version });
const key = (value: ContentReference) =>
  JSON.stringify([value.productId, value.id, value.version]);
export function projectDisplayAsset(
  content: QuizPackContentV2,
  resourceRef: ContentReference,
): DisplayAssetV1 {
  const resource = content.resources.find(
    (item) => key(item) === key(resourceRef),
  );
  const description = content.visualPresentation.resourceDescriptions.find(
    (item) => key(item.resourceRef) === key(resourceRef),
  );
  if (!resource || !description) throw new Error("PREVIEW_REFERENCE_MISMATCH");
  return {
    resourceRef: ref(resource),
    mediaType: resource.mediaType,
    bytes: resource.bytes,
    sha256: resource.sha256,
    width: resource.width,
    height: resource.height,
    purpose: resource.purpose,
    approval: resource.approval,
    alt: description.alt,
  };
}

/** Server-only display mapping of an already trusted complete score, never scoring or authorization.
 * Current callers obtain it from their private prepared handle's actual deterministic execution.
 * Future services must establish persisted-score provenance before calling; no client score route exists.
 */
export function projectContentScoreForDisplay(
  contentInput: QuizPackContentV2,
  scoredInput: ContentScore,
): PreviewResult<ResultDisplaySnapshotV1> {
  try {
    const parsed = parseSupportedContent(contentInput);
    if (
      !parsed.ok ||
      parsed.value.schemaVersion !== "quizpack-content.v2" ||
      !supportsPreviewContent(parsed.value)
    )
      return failure("PREVIEW_UNSUPPORTED");
    const content = parsed.value;
    assertPersistenceUnicode(content);
    const scored = contentScoreSchema.parse(scoredInput);
    if (
      scored.canonicalContentSha256 !== hash(canonicalP1Json(content)) ||
      scored.contentSchemaVersion !== content.schemaVersion ||
      scored.contentVersion !== content.contentVersion ||
      scored.reportVersion !== content.reportVersion ||
      scored.score.productId !== content.product.productId ||
      scored.score.contentVersion !== content.contentVersion ||
      scored.score.engine.id !== content.engine.id ||
      scored.score.engine.version !== content.engine.version
    )
      return failure("PREVIEW_BINDING_MISMATCH");
    const selectedResultRef = scored.score.decision.selectedResultRef;
    const result = content.results.find(
      (item) => key(item) === key(selectedResultRef),
    );
    const card = content.reportPresentation.resultCards.find(
      (item) => key(item.resultRef) === key(selectedResultRef),
    );
    const report = content.reportTemplates.find(
      (item) => key(item) === key(scored.reportTemplateRef),
    );
    if (
      !result ||
      !card ||
      !report ||
      key(result.reportTemplateRef) !== key(scored.reportTemplateRef) ||
      scored.score.dimensions.length !== content.dimensions.length
    )
      return failure("PREVIEW_BINDING_MISMATCH");
    const dimensions = content.dimensions.map((dimension) => {
      const score = scored.score.dimensions.find(
        (item) => key(item.dimensionRef) === key(dimension),
      );
      if (!score) throw new Error("PREVIEW_REFERENCE_MISMATCH");
      return {
        dimensionRef: ref(dimension),
        label: dimension.label,
        normalizedText: displayHalfUp(
          BigInt(score.normalized.numerator),
          BigInt(score.normalized.denominator),
        ),
      };
    });
    const portrait = projectDisplayAsset(content, result.portraitRef);
    const posterResult = displayPosterV1Schema.safeParse({
      kind: "ready",
      layout: projectPreviewLayout(content, "poster"),
      displayName: card.displayName,
      subtitle: card.subtitle,
      posterLine: card.posterLine,
      posterDisclosure: card.posterDisclosure,
      portrait,
      dimensions,
    });
    const poster: DisplayPosterV1 = posterResult.success
      ? posterResult.data
      : { kind: "unavailable", code: "POSTER_LIMIT_EXCEEDED" };
    return boundedOutput(
      {
        answersHash: scored.score.answersHash,
        logicHash: scored.score.logicHash,
        contentSchemaVersion: scored.contentSchemaVersion,
        contentVersion: scored.contentVersion,
        reportVersion: scored.reportVersion,
        selectedResultRef,
        reportTemplateRef: scored.reportTemplateRef,
        dimensions,
        result: {
          layout: projectPreviewLayout(content, "result"),
          displayName: card.displayName,
          subtitle: card.subtitle,
          portrait,
        },
        report: {
          layout: projectPreviewLayout(content, "report"),
          mode: report.mode,
          baseline: report.baseline,
        },
        poster,
      },
      PREVIEW_LIMITS.revealResponseBytes,
      (value) => resultDisplaySnapshotV1Schema.parse(value),
    );
  } catch (error) {
    return failure(
      isBoundaryLimit(error) ? "PREVIEW_LIMIT_EXCEEDED" : "PREVIEW_UNSUPPORTED",
    );
  }
}
