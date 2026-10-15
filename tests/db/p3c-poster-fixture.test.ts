import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import {
  PREVIEW_RENDERER,
  PREVIEW_FONT,
  PREVIEW_FONT_ASSET,
} from "@/features/product/preview/descriptor";
import { previewPosterSchema } from "@/features/product/preview/contracts";
import {
  preparePreviewContent,
  scorePreview,
} from "@/features/theme/preview/projection";
import {
  prepareContentForScoring,
  scorePreparedContent,
} from "@/features/quizpack/content/scoring-adapter";
import { createContentV2Fixture } from "@/features/quizpack/content/fixtures.test-support";
import { prepareP3cSource } from "./p3c-source-fixture";

const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
it.each(["archetype", "dimensions"] as const)(
  "actual %s P3-C source yields all three ready posters with covered display text and unchanged scoring",
  async (engine) => {
    const productId = `poster-positive-${engine}`;
    // The same unique-pixel path used by the real CLI/E2E fixture, not a projection-only substitute.
    const p = await prepareP3cSource(productId, engine, randomUUID()),
      facts = p.candidate.facts,
      c = facts.content;
    if (c.schemaVersion !== "quizpack-content.v2")
      throw Error("P3C_V2_REQUIRED");
    const binding = {
      productId,
      draftId: randomUUID(),
      revision: 1,
      canonicalContentSha256: facts.canonicalContentSha256,
      assetSetSha256: facts.assetSetSha256,
      renderer: PREVIEW_RENDERER,
      font: PREVIEW_FONT,
    };
    const prepared = preparePreviewContent(c, binding);
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw Error("P3C_PREVIEW_REQUIRED");
    const original = await createContentV2Fixture(engine);
    const baseline = JSON.parse(
      JSON.stringify(original).replaceAll(
        JSON.stringify(original.product.productId),
        JSON.stringify(productId),
      ),
    ) as typeof original;
    expect(c.questions).toEqual(baseline.questions);
    expect(c.rules).toEqual(baseline.rules);
    expect(
      c.results.map(({ label, ...rest }) => {
        void label;
        return rest;
      }),
    ).toEqual(
      baseline.results.map(({ label, ...rest }) => {
        void label;
        return rest;
      }),
    );
    expect(
      c.dimensions.map(({ label, ...rest }) => {
        void label;
        return rest;
      }),
    ).toEqual(
      baseline.dimensions.map(({ label, ...rest }) => {
        void label;
        return rest;
      }),
    );
    expect(c.reportTemplates).toEqual(baseline.reportTemplates);
    const oldCore = prepareContentForScoring(baseline),
      newCore = prepareContentForScoring(c);
    if (!oldCore.ok || !newCore.ok) throw Error("P3C_ACTUAL_SCORING_REQUIRED");
    const fontBytes = await readFile(`public${PREVIEW_FONT_ASSET.file}`),
      coverageBytes = await readFile(`public${PREVIEW_FONT_ASSET.coverage}`);
    expect(sha(fontBytes)).toBe(PREVIEW_FONT_ASSET.fileSha256);
    expect(sha(coverageBytes)).toBe(PREVIEW_FONT_ASSET.coverageSha256);
    const coverage = new Set(
      new TextDecoder("utf-8", { fatal: true }).decode(coverageBytes),
    );
    const selected = new Set<string>();
    for (const result of c.results) {
      const answers = result.witness.answers.map((a) => ({
        questionId: a.questionRef.id,
        optionId: a.optionRef.id,
      }));
      const before = scorePreparedContent(oldCore.value, answers),
        after = scorePreparedContent(newCore.value, answers);
      if (!before.ok || !after.ok) throw Error("P3C_ACTUAL_SCORE_REQUIRED");
      expect(after.value.score).toEqual(before.value.score);
      const reveal = scorePreview(
        prepared.value.prepared,
        answers,
        randomUUID(),
      );
      expect(reveal.ok).toBe(true);
      if (!reveal.ok) throw Error("P3C_REVEAL_REQUIRED");
      expect(reveal.value.selectedResultRef.id).toBe(result.id);
      selected.add(result.id);
      const poster = reveal.value.poster;
      expect(poster.kind).toBe("ready");
      if (poster.kind !== "ready") throw Error("P3C_READY_POSTER_REQUIRED");
      expect(previewPosterSchema.safeParse(poster).success).toBe(true);
      expect(poster.displayName).toMatch(/^合成[低中高]$/);
      expect(poster.dimensions.map((d) => d.label)).toEqual(["节奏", "专注"]);
      const text = [
        poster.displayName,
        poster.subtitle,
        poster.posterLine.text,
        poster.posterDisclosure,
        ...poster.dimensions.flatMap((d) => [d.label, d.normalizedText]),
      ].join("");
      const missing = [...new Set(text)].filter(
        (char) => !coverage.has(char) && !/[\r\n\t]/.test(char),
      );
      expect(missing).toEqual([]);
    }
    expect(selected).toEqual(new Set(["low", "middle", "high"]));
  },
);
