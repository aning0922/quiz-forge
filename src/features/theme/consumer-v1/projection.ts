import "server-only";
import { createHash } from "node:crypto";
import {
  displayEntryBodyV1Schema,
  type DisplayEntryBodyV1,
  type ResultDisplaySnapshotV1,
} from "@/lib/assessment-contract/display-v1";
import { sha256Schema } from "@/lib/assessment-contract/primitives";
import {
  canonicalOrdinaryJson,
  CanonicalJsonError,
} from "@/lib/json/canonical";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  parseSupportedContent,
  freezeContent,
} from "@/features/quizpack/content/supported";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import type { QuizPackContentV2 } from "@/features/quizpack/content/v2";
import type { ContentScore } from "@/features/quizpack/content/scoring-adapter";
import { assertPersistenceUnicode } from "@/features/quizpack/server/validation/unicode";
import { supportsPreviewContent } from "@/features/theme/preview/registry";
import {
  projectContentScoreForDisplay,
  projectDisplayAsset,
} from "@/features/theme/preview/result-projection";

/** Internal display failures, not HTTP statuses or business-operation outcomes. */
export type ConsumerDisplayResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false;
      code: "SOURCE_UNSUPPORTED" | "SOURCE_MISMATCH" | "DISPLAY_LIMIT_EXCEEDED";
    }>;
const fail = (
  code: Extract<ConsumerDisplayResult<never>, { ok: false }>["code"],
): ConsumerDisplayResult<never> => Object.freeze({ ok: false, code });
const key = (ref: { productId: string; id: string; version: string }) =>
  JSON.stringify([ref.productId, ref.id, ref.version]);
function source(
  input: unknown,
  expectedSha256: string,
): ConsumerDisplayResult<QuizPackContentV2> {
  const expected = sha256Schema.safeParse(expectedSha256);
  if (!expected.success) return fail("SOURCE_MISMATCH");
  const parsed = parseSupportedContent(input);
  if (!parsed.ok)
    return fail(
      parsed.issues[0]?.code === "CONTENT_INPUT_LIMIT_EXCEEDED"
        ? "DISPLAY_LIMIT_EXCEEDED"
        : "SOURCE_UNSUPPORTED",
    );
  if (
    parsed.value.schemaVersion !== "quizpack-content.v2" ||
    !supportsPreviewContent(parsed.value)
  )
    return fail("SOURCE_UNSUPPORTED");
  assertPersistenceUnicode(parsed.value);
  if (
    createHash("sha256").update(canonicalP1Json(parsed.value)).digest("hex") !==
    expected.data
  )
    return fail("SOURCE_MISMATCH");
  return { ok: true, value: parsed.value };
}
function bounded<T>(value: T, maximum: number): ConsumerDisplayResult<T> {
  canonicalOrdinaryJson(
    { ok: true, value },
    { maxBytes: maximum, maxDepth: L.depth },
  );
  return freezeContent({ ok: true, value });
}
/** Trusted fixed-source display only. Caller owns play binding, IO, authorization and source provenance. */
export function projectConsumerEntryV1(
  input: unknown,
  expectedSha256: string,
): ConsumerDisplayResult<DisplayEntryBodyV1> {
  try {
    const parsed = source(input, expectedSha256);
    if (!parsed.ok) return parsed;
    const c = parsed.value,
      v = c.visualPresentation;
    const neutral = new Set([
      key(v.coverSceneRef),
      ...v.sections.map((s) => key(s.sceneRef)),
      ...v.questionFrames.flatMap((f) =>
        f.sceneOverrideRef ? [key(f.sceneOverrideRef)] : [],
      ),
    ]);
    const ref = ({
      productId,
      id,
      version,
    }: {
      productId: string;
      id: string;
      version: string;
    }) => ({ productId, id, version });
    const value = displayEntryBodyV1Schema.parse({
      contentSchemaVersion: c.schemaVersion,
      kind: c.kind,
      engine: c.engine,
      product: { productId: c.product.productId, title: c.product.title },
      layouts: {
        cover: {
          component: c.layouts.cover.component,
          props: c.layouts.cover.props,
        },
        question: {
          component: c.layouts.question.component,
          props: c.layouts.question.props,
        },
        resume: {
          component: c.layouts.resume.component,
          props: c.layouts.resume.props,
        },
      },
      questions: c.questions.map((q) => ({
        ...ref(q),
        prompt: q.prompt,
        options: q.options.map((o) => ({ ...ref(o), label: o.label })),
      })),
      visualPresentation: {
        coverSceneRef: v.coverSceneRef,
        sections: v.sections,
        questionFrames: v.questionFrames,
      },
      assets: c.resources
        .filter((r) => neutral.has(key(r)))
        .map((r) => projectDisplayAsset(c, r)),
    });
    return bounded(value, L.entryResponseBytes);
  } catch (error) {
    return fail(
      error instanceof CanonicalJsonError &&
        ["JSON_SIZE_LIMIT", "JSON_DEPTH_LIMIT"].includes(error.code)
        ? "DISPLAY_LIMIT_EXCEEDED"
        : "SOURCE_UNSUPPORTED",
    );
  }
}
/** Caller must supply actual trusted engine output before report INSERT; never used to rebuild report reads. */
export function projectConsumerResultV1(
  input: unknown,
  scored: ContentScore,
  expectedSha256: string,
): ConsumerDisplayResult<ResultDisplaySnapshotV1> {
  try {
    const parsed = source(input, expectedSha256);
    if (!parsed.ok) return parsed;
    const result = projectContentScoreForDisplay(parsed.value, scored);
    if (!result.ok)
      return fail(
        result.code === "PREVIEW_LIMIT_EXCEEDED"
          ? "DISPLAY_LIMIT_EXCEEDED"
          : result.code === "PREVIEW_BINDING_MISMATCH"
            ? "SOURCE_MISMATCH"
            : "SOURCE_UNSUPPORTED",
      );
    return bounded(result.value, L.reportResponseBytes);
  } catch {
    return fail("SOURCE_UNSUPPORTED");
  }
}
