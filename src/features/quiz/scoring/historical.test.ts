import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { authoringReviewSchema } from "@/lib/assessment-contract/authoring-review-v1";
import { canonicalOrdinaryJson } from "@/lib/json/canonical";
import {
  SCORING_HASH_DOMAINS,
  type ScoringResult,
} from "@/lib/assessment-contract/scoring-api-v1";
import fixture from "./fixtures/historical-review.json";
import {
  prepareScoringDefinition,
  readScoringIdentity,
  scoreCompleteAnswers,
  verifyDeclaredWitnesses,
} from "./index";
function good<T>(r: ScoringResult<T>): T {
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("TEST_EXPECTED_SUCCESS");
  return r.value;
}
describe("historical four-card authored-pending logic review only", () => {
  it("binds the source declaration and exact transcription without fabricating a complete content package", () => {
    const parsed = authoringReviewSchema.parse(fixture);
    const { transcriptionSha256, ...payload } = parsed;
    expect(
      createHash("sha256")
        .update(SCORING_HASH_DOMAINS.transcription)
        .update(
          canonicalOrdinaryJson(payload, { maxBytes: 2097152, maxDepth: 32 }),
        )
        .digest("hex"),
    ).toBe(transcriptionSha256);
    expect(parsed.source).toEqual({
      commit: "03fdc240c924e2fe7379534176e11d1e6ab3bc58",
      path: "docs/FIRST_PRODUCT_CONTENT_DRAFT.md",
      sha256:
        "8c049714ae07c5ed2f10fff334cc041364789781de28bfbbd5442a26d6dc0653",
    });
    expect(parsed.status).toBe("authored-pending");
    expect(parsed.definition.productId).toBe("historical-cabinet");
    expect(parsed.definition.questions).toHaveLength(12);
    expect(
      parsed.definition.questions.reduce((n, q) => n + q.options.length, 0),
    ).toBe(48);
    expect(Object.hasOwn(parsed, "resources")).toBe(false);
    expect(Buffer.byteLength(JSON.stringify(parsed))).toBeLessThanOrEqual(
      2097152,
    );
  });
  it("actually executes four full witnesses with paper raw sums, exact fractions, all distances and corresponding winners", () => {
    const h = good(prepareScoringDefinition(fixture.definition));
    const evidence = good(verifyDeclaredWitnesses(h, fixture.witnesses));
    expect(evidence.status).toBe("passed");
    expect(evidence.logicHash).toBe(good(readScoringIdentity(h)).logicHash);
    const raw = [
      [33, 29, 8, 8],
      [14, 32, 27, 7],
      [24, 8, 7, 30],
      [1, 11, 32, 28],
    ];
    const normalized = [
      ["275/4", "725/12", "100/11", "300/23"],
      ["175/6", "200/3", "575/11", "250/23"],
      ["50/1", "50/3", "75/11", "1400/23"],
      ["25/12", "275/12", "700/11", "1300/23"],
    ];
    for (const [i, witness] of fixture.witnesses.entries.entries()) {
      const score = good(scoreCompleteAnswers(h, witness.answers));
      expect(score.dimensions.map((d) => d.rawSum)).toEqual(raw[i]);
      expect(
        score.dimensions.map(
          (d) => `${d.normalized.numerator}/${d.normalized.denominator}`,
        ),
      ).toEqual(normalized[i]);
      expect(score.decision.selectedResultRef).toEqual(
        witness.expectedResultRef,
      );
      if (score.decision.kind !== "archetype")
        throw new Error("TEST_EXPECTED_ARCHETYPE");
      expect(score.decision.distances).toHaveLength(4);
      expect(score.decision.tiedMinimumResultRefs).toHaveLength(1);
      if (i === 3)
        expect(score.decision.distances[3]!.value).toEqual({
          numerator: "78450325",
          denominator: "4608648",
        });
    }
  });
  it("executes each dimension's actual minimum and maximum answers, without asserting joint reachability", () => {
    const h = good(prepareScoringDefinition(fixture.definition));
    for (let di = 0; di < 4; di++)
      for (const maximum of [false, true]) {
        const answers = fixture.definition.questions.map((q) => {
          const option = q.options.reduce((best, o) =>
            maximum
              ? o.contributions[di]!.value > best.contributions[di]!.value
                ? o
                : best
              : o.contributions[di]!.value < best.contributions[di]!.value
                ? o
                : best,
          );
          return { questionId: q.ref.id, optionId: option.ref.id };
        });
        const score = good(scoreCompleteAnswers(h, answers));
        expect(score.dimensions[di]!.normalized).toEqual({
          numerator: maximum ? "100" : "0",
          denominator: "1",
        });
      }
  });
  it("mechanically verifies the published no-exact-tie modular premises for this fixed logic only", () => {
    const rules = fixture.definition.rules;
    const spans = rules.normalization.bounds.map((b) => b.max - b.min);
    expect(spans).toEqual([48, 48, 44, 46]);
    const common = 3036;
    expect(spans.map((span) => (common * 100) / span)).toEqual([
      6325, 6325, 6900, 6600,
    ]);
    expect(spans.every((span) => ((common * 100) / span) % 25 === 0)).toBe(
      true,
    );
    const norms = rules.profiles.map((p) =>
      p.targets.reduce((n, t) => n + t.value * t.value, 0),
    );
    expect(norms).toEqual([8825, 8250, 6425, 7900]);
    expect(norms.map((n) => n % 125)).toEqual([75, 0, 50, 25]);
    expect(new Set(norms.map((n) => n % 125)).size).toBe(4);
    // 2*A·(ti-tj) is a multiple of 250; gcd(3036,250)=2.
    // Equality therefore requires a squared-norm difference divisible by 125.
    let a = common,
      b = 250;
    while (b) [a, b] = [b, a % b];
    expect(a).toBe(2);
  });
});
