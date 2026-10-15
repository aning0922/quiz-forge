import { createHash } from "node:crypto";
import {
  createContentV2Fixture,
  asRef,
} from "@/features/quizpack/content/fixtures.test-support";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import {
  PREVIEW_RENDERER,
  PREVIEW_FONT,
} from "@/features/product/preview/descriptor";
import type { PreviewBinding } from "@/features/product/preview/contracts";
import type { QuizPackContentV2 } from "@/features/quizpack/content/v2";
export const requestId = "22222222-2222-4222-8222-222222222222";
export const sha = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export function sourceBinding(content: QuizPackContentV2): PreviewBinding {
  const rows = content.resources.map((r) => ({
    resourceId: r.id,
    resourceVersion: r.version,
    productId: r.productId,
    blobSha256: r.sha256,
    declarationSha256: sha(canonicalP1Json(r)),
  }));
  rows.sort((a, b) =>
    a.resourceId < b.resourceId
      ? -1
      : a.resourceId > b.resourceId
        ? 1
        : a.resourceVersion < b.resourceVersion
          ? -1
          : a.resourceVersion > b.resourceVersion
            ? 1
            : 0,
  );
  return {
    productId: content.product.productId,
    draftId: "11111111-1111-4111-8111-111111111111",
    revision: 1,
    canonicalContentSha256: sha(canonicalP1Json(content)),
    assetSetSha256: sha(
      canonicalP1Json({
        schemaVersion: "quizpack-candidate-asset-set.v1",
        productId: content.product.productId,
        resources: rows,
      }),
    ),
    renderer: { ...PREVIEW_RENDERER },
    font: { ...PREVIEW_FONT },
  };
}
/** Metadata-only synthetic projection fixture. No real artwork or commercial approval. */
export async function previewFixture(
  engine: "dimensions" | "archetype" = "archetype",
) {
  const c = await createContentV2Fixture(engine);
  c.dimensions.forEach((d, i) => {
    d.label = `维度${i + 1}`;
  });
  c.reportPresentation.resultCards.forEach((card, i) => {
    card.displayName = `样本${i + 1}`;
    card.subtitle = "结构测试";
  });
  return c;
}
export const answers = (content: QuizPackContentV2, option = 0) =>
  content.questions.map((q) => ({
    questionId: q.id,
    optionId: q.options[option]!.id,
  }));
export function expandQuestions(c: QuizPackContentV2, count: number): void {
  const templates = structuredClone(c.questions);
  c.questions = Array.from({ length: count }, (_, i) => ({
    ...templates[i % templates.length]!,
    id: `question-${i + 1}`,
    options: templates[i % templates.length]!.options.map((option, j) => ({
      ...option,
      id: `option-${i + 1}-${j + 1}`,
    })),
  }));
  c.rules.normalization.bounds.forEach((bound) => {
    bound.max = count * 2;
  });
  c.results.forEach((result, i) => {
    result.witness.answers = c.questions.map((q) => ({
      questionRef: asRef(q),
      optionRef: asRef(q.options[i]!),
    }));
  });
  c.visualPresentation.questionFrames = c.questions.map((q) => ({
    questionRef: asRef(q),
    sectionId: c.visualPresentation.sections[0]!.id,
    caption: "题签",
  }));
}
export function expandDimensions(c: QuizPackContentV2, count: number): void {
  const original = c.dimensions[0]!;
  c.dimensions = Array.from({ length: count }, (_, i) => ({
    ...original,
    id: `dimension-${i + 1}`,
    label: `维度${i + 1}`,
  }));
  c.questions.forEach((q) =>
    q.options.forEach((option) => {
      const value = option.contributions[0]!.value;
      option.contributions = c.dimensions.map((d) => ({
        dimensionRef: asRef(d),
        value,
      }));
    }),
  );
  c.rules.normalization.bounds = c.dimensions.map((d) => ({
    dimensionRef: asRef(d),
    min: 0,
    max: 4,
  }));
  if (c.rules.kind === "archetype")
    c.rules.profiles.forEach((profile, i) => {
      profile.targets = c.dimensions.map((d) => ({
        dimensionRef: asRef(d),
        value: i * 50,
      }));
    });
  else
    c.rules.profiles.forEach((profile, i) => {
      profile.ranges = c.dimensions.map((d) => ({
        dimensionRef: asRef(d),
        min: [0, 25, 75][i]!,
        max: [24, 74, 100][i]!,
      }));
    });
}
