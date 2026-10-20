import { describe, expect, it } from "vitest";
import {
  prepareContentForScoring,
  scorePreparedContent,
} from "@/features/quizpack/content/scoring-adapter";
import { resultDisplaySnapshotV1Schema } from "@/lib/assessment-contract/display-v1";
import {
  previewFixture,
  sourceBinding,
  answers,
  requestId,
  expandDimensions,
} from "./fixtures.test-support";
import { projectContentScoreForDisplay } from "./result-projection";
import { preparePreviewContent, scorePreview } from "./projection";

async function source(
  engine: "dimensions" | "archetype" = "archetype",
  count = 2,
) {
  const content = await previewFixture(engine);
  if (count !== 2) expandDimensions(content, count);
  const prepared = prepareContentForScoring(content);
  if (!prepared.ok) throw Error("fixture");
  const scored = scorePreparedContent(prepared.value, answers(content));
  if (!scored.ok) throw Error("fixture");
  return { content, scored: scored.value };
}
describe("server-only complete-score display projection", () => {
  it.each(["dimensions", "archetype"] as const)(
    "maps trusted %s output without draft/request scope or raw scoring details",
    async (engine) => {
      const { content, scored } = await source(engine);
      const result = projectContentScoreForDisplay(content, scored);
      const prepared = preparePreviewContent(content, sourceBinding(content));
      if (!result.ok || !prepared.ok) throw Error("fixture");
      const wrapped = scorePreview(
        prepared.value.prepared,
        answers(content),
        requestId,
      );
      if (!wrapped.ok) throw Error("fixture");
      expect(resultDisplaySnapshotV1Schema.parse(result.value)).toEqual(
        result.value,
      );
      const { binding, requestId: observed, ...body } = wrapped.value;
      expect(binding).toEqual(sourceBinding(content));
      expect(observed).toBe(requestId);
      expect(JSON.stringify(body)).toBe(JSON.stringify(result.value));
      expect(JSON.stringify(result.value)).not.toMatch(
        /draftId|requestId|normalizedAnswers|rawSum|contributions|distances|targets/,
      );
      expect(Object.isFrozen(result.value.report.baseline)).toBe(true);
    },
  );
  it("rejects score/content hash, version, engine, report and dimension mismatches", async () => {
    const { content, scored } = await source();
    const mutations = [
      (v: typeof scored) => {
        (v as { canonicalContentSha256: string }).canonicalContentSha256 =
          "f".repeat(64);
      },
      (v: typeof scored) => {
        (v as { reportVersion: string }).reportVersion = "9.0.0";
      },
      (v: typeof scored) => {
        (v.score.engine as { version: string }).version = "9.0.0";
      },
      (v: typeof scored) => {
        (v.reportTemplateRef as { id: string }).id = "unknown-report";
      },
      (v: typeof scored) => {
        (v.score.dimensions[0]!.dimensionRef as { id: string }).id =
          "unknown-dimension";
      },
    ];
    for (const mutate of mutations) {
      const other = structuredClone(scored);
      mutate(other);
      expect(projectContentScoreForDisplay(content, other).ok).toBe(false);
    }
    const changed = structuredClone(content);
    changed.product.title += "变更";
    expect(projectContentScoreForDisplay(changed, scored)).toEqual({
      ok: false,
      code: "PREVIEW_BINDING_MISMATCH",
    });
  });
  it("does not make a five-dimension poster available or drop the complete report", async () => {
    const { content, scored } = await source("archetype", 5);
    const result = projectContentScoreForDisplay(content, scored);
    if (!result.ok) throw Error("fixture");
    expect(result.value.dimensions).toHaveLength(5);
    expect(result.value.report.baseline).toEqual(
      content.reportTemplates[0]!.baseline,
    );
    expect(result.value.poster).toEqual({
      kind: "unavailable",
      code: "POSTER_LIMIT_EXCEEDED",
    });
  });
});
