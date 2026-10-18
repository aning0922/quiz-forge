import "server-only";
import { createHash } from "node:crypto";
import {
  bindingUsesCurrentRenderer,
  previewBindingSchema,
  previewEntrySchema,
  previewRequestIdSchema,
  previewRevealSchema,
  type PreviewBinding,
  type PreviewErrorCode,
} from "@/features/product/preview/contracts";
import type {
  PreparePreviewContent,
  ScorePreview,
  PreparedPreview,
} from "@/features/product/preview/projection-contract";
import { PREVIEW_LIMITS } from "@/features/product/preview/limits";
import {
  prepareContentForScoring,
  scorePreparedContent,
  type PreparedContent,
} from "@/features/quizpack/content/scoring-adapter";
import {
  parseSupportedContent,
  freezeContent,
} from "@/features/quizpack/content/supported";
import type { QuizPackContentV2 } from "@/features/quizpack/content/v2";
import type { ContentReference } from "@/features/quizpack/v1/content";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { assertPersistenceUnicode } from "@/features/quizpack/server/validation/unicode";
import { supportsPreviewContent, projectPreviewLayout } from "./registry";
import {
  projectContentScoreForDisplay,
  projectDisplayAsset as asset,
} from "./result-projection";
import {
  boundedOutput,
  failure,
  isBoundaryLimit,
  ordinarySnapshot,
} from "./boundary";

type Fixed = Readonly<{
  content: QuizPackContentV2;
  binding: PreviewBinding;
  scoring: PreparedContent;
}>;
const preparations = new WeakMap<PreparedPreview, Fixed>();
const hash = (value: string) =>
  createHash("sha256").update(value, "utf8").digest("hex");
const ref = ({
  id,
  productId,
  version,
}: ContentReference): ContentReference => ({ id, productId, version });
const key = (value: ContentReference) =>
  JSON.stringify([value.productId, value.id, value.version]);
/** Exact archived asset-set vocabulary and ordering; no physical blob authority is inferred here. */
function contentAssetSetHash(content: QuizPackContentV2): string {
  return hash(
    canonicalP1Json({
      schemaVersion: "quizpack-candidate-asset-set.v1",
      productId: content.product.productId,
      resources: [...content.resources]
        .sort((a, b) =>
          a.id < b.id
            ? -1
            : a.id > b.id
              ? 1
              : a.version < b.version
                ? -1
                : a.version > b.version
                  ? 1
                  : 0,
        )
        .map((resource) => ({
          resourceId: resource.id,
          resourceVersion: resource.version,
          productId: resource.productId,
          blobSha256: resource.sha256,
          declarationSha256: hash(canonicalP1Json(resource)),
        })),
    }),
  );
}
function preparationFailure(code: string): PreviewErrorCode {
  return code === "INPUT_LIMIT_EXCEEDED"
    ? "PREVIEW_LIMIT_EXCEEDED"
    : code === "REFERENCE_MISMATCH"
      ? "PREVIEW_BINDING_MISMATCH"
      : "PREVIEW_UNSUPPORTED";
}
/** A strict complete-content snapshot plus real scoring preparation; never an authorization grant. */
export const preparePreviewContent: PreparePreviewContent = (
  input,
  bindingInput,
) => {
  let binding: PreviewBinding;
  try {
    binding = previewBindingSchema.parse(
      ordinarySnapshot(bindingInput, PREVIEW_LIMITS.resourceQueryBytes),
    );
  } catch (error) {
    return failure(
      isBoundaryLimit(error)
        ? "PREVIEW_LIMIT_EXCEEDED"
        : "PREVIEW_BINDING_MISMATCH",
    );
  }
  if (!bindingUsesCurrentRenderer(binding))
    return failure("PREVIEW_BINDING_MISMATCH");
  try {
    const parsed = parseSupportedContent(input);
    if (!parsed.ok)
      return failure(
        parsed.issues[0]?.code === "CONTENT_INPUT_LIMIT_EXCEEDED"
          ? "PREVIEW_LIMIT_EXCEEDED"
          : "PREVIEW_UNSUPPORTED",
      );
    const content = parsed.value;
    if (
      content.schemaVersion !== "quizpack-content.v2" ||
      !supportsPreviewContent(content)
    )
      return failure("PREVIEW_UNSUPPORTED");
    assertPersistenceUnicode(content);
    if (
      content.product.productId !== binding.productId ||
      hash(canonicalP1Json(content)) !== binding.canonicalContentSha256 ||
      contentAssetSetHash(content) !== binding.assetSetSha256
    )
      return failure("PREVIEW_BINDING_MISMATCH");
    const scoring = prepareContentForScoring(content);
    if (!scoring.ok)
      return failure(preparationFailure(scoring.issues[0]!.code));
    const presentation = content.visualPresentation;
    const neutral = new Set([
      key(presentation.coverSceneRef),
      ...presentation.sections.map((section) => key(section.sceneRef)),
      ...presentation.questionFrames.flatMap((frame) =>
        frame.sceneOverrideRef ? [key(frame.sceneOverrideRef)] : [],
      ),
    ]);
    const entry = boundedOutput(
      {
        binding,
        contentSchemaVersion: content.schemaVersion,
        kind: content.kind,
        engine: content.engine,
        product: {
          productId: content.product.productId,
          title: content.product.title,
        },
        layouts: {
          cover: projectPreviewLayout(content, "cover"),
          question: projectPreviewLayout(content, "question"),
          resume: projectPreviewLayout(content, "resume"),
        },
        questions: content.questions.map((question) => ({
          ...ref(question),
          prompt: question.prompt,
          options: question.options.map((option) => ({
            ...ref(option),
            label: option.label,
          })),
        })),
        visualPresentation: {
          coverSceneRef: presentation.coverSceneRef,
          sections: presentation.sections,
          questionFrames: presentation.questionFrames,
        },
        assets: content.resources
          .filter((resource) => neutral.has(key(resource)))
          .map((resource) => asset(content, resource)),
      },
      PREVIEW_LIMITS.entryResponseBytes,
      (value) => previewEntrySchema.parse(value),
    );
    if (!entry.ok) return entry;
    const prepared = {} as PreparedPreview;
    Object.defineProperty(prepared, "toJSON", {
      value: () => {
        throw new Error("PREVIEW_PRIVATE_HANDLE");
      },
    });
    Object.freeze(prepared);
    preparations.set(
      prepared,
      freezeContent({ content, binding, scoring: scoring.value }),
    );
    return Object.freeze({
      ok: true,
      value: Object.freeze({ entry: entry.value, prepared }),
    });
  } catch (error) {
    return failure(
      isBoundaryLimit(error) ? "PREVIEW_LIMIT_EXCEEDED" : "PREVIEW_UNSUPPORTED",
    );
  }
};

/** The only selected result/report source is this handle's actual deterministic execution. */
export const scorePreview: ScorePreview = (
  prepared,
  answers,
  requestIdInput,
) => {
  const fixed =
    prepared !== null && typeof prepared === "object"
      ? preparations.get(prepared)
      : undefined;
  if (!fixed) return failure("PREVIEW_BINDING_MISMATCH");
  try {
    const requestId = previewRequestIdSchema.safeParse(requestIdInput);
    if (!requestId.success) return failure("PREVIEW_INVALID_ANSWERS");
    const actual = scorePreparedContent(fixed.scoring, answers);
    if (!actual.ok)
      return failure(
        actual.issues[0]?.code === "INPUT_LIMIT_EXCEEDED"
          ? "PREVIEW_LIMIT_EXCEEDED"
          : "PREVIEW_INVALID_ANSWERS",
      );
    if (
      actual.value.canonicalContentSha256 !==
      fixed.binding.canonicalContentSha256
    )
      return failure("PREVIEW_BINDING_MISMATCH");
    const display = projectContentScoreForDisplay(fixed.content, actual.value);
    if (!display.ok) return display;
    return boundedOutput(
      { binding: fixed.binding, requestId: requestId.data, ...display.value },
      PREVIEW_LIMITS.revealResponseBytes,
      (value) => previewRevealSchema.parse(value),
    );
  } catch (error) {
    return failure(
      isBoundaryLimit(error) ? "PREVIEW_LIMIT_EXCEEDED" : "PREVIEW_UNSUPPORTED",
    );
  }
};
