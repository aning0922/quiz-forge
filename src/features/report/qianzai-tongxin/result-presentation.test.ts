import { beforeAll, describe, expect, it } from "vitest";
import { qianzaiPresentationFixture } from "./result-presentation.test-support";
import { deriveQianzaiResultPresentation } from "./result-presentation";
let fixture: Awaited<ReturnType<typeof qianzaiPresentationFixture>>;
beforeAll(async () => {
  fixture = await qianzaiPresentationFixture();
});
function accepted(f: typeof fixture) {
  const ref = (id: string) => ({
    productId: "qianzai-tongxin",
    id,
    version: "1.0.0",
  });
  const evidence = {
    questionRef: ref("q02"),
    optionRef: ref("q02-b"),
    prompt: "合成闲暇情境",
    optionText: "合成选择",
    scope: "仅此合成情境",
  };
  f.body.answers.push({
    questionRef: evidence.questionRef,
    optionRef: evidence.optionRef,
    prompt: evidence.prompt,
    optionText: evidence.optionText,
    act: 1,
  });
  f.body.volumes[0]!.paragraphs[0] = {
    claimRef: ref("authored-7053c48e83fe3e6c223d"),
    kind: "fact",
    status: "accepted",
    text: "合成的、受限于本题的事实句。",
    evidence: [evidence],
    counterevidence: [],
  };
}
describe("Qianzai sealed-context presentation v1.1", () => {
  it("pins the full installed identity, keeps the source untouched and stably chooses within the role pool", () => {
    const f = structuredClone(fixture);
    const before = JSON.stringify(f.view);
    const a = deriveQianzaiResultPresentation(f.view, f.binding)!;
    expect(a).not.toBeNull();
    expect(a.kind).toBe("sealed-context-derived");
    expect(deriveQianzaiResultPresentation(f.view, f.binding)).toEqual(a);
    expect(JSON.stringify(f.view)).toBe(before);
    expect(Object.isFrozen(f.body)).toBe(false);
    expect(a.role.quotes.some((q) => q.id === a.quote.id)).toBe(true);
    expect(a.reveal.supportingClaimRefs).toEqual([]);
    const replay = structuredClone(f.view);
    replay.completedAt = "2026-10-31T23:00:00.000Z";
    expect(deriveQianzaiResultPresentation(replay, f.binding)!.quote).toEqual(
      a.quote,
    );
  });
  it("rejects missing registration, old versions, changed entry hashes and foreign role/source/context identities", () => {
    expect(deriveQianzaiResultPresentation(fixture.view)).toBeNull();
    const mutations = [
      (f: typeof fixture) => {
        f.view.renderer.entrySha256 = "f".repeat(64);
      },
      (f: typeof fixture) => {
        f.view.renderer.version = f.binding.renderer.version = "1.1.0";
      },
      (f: typeof fixture) => {
        f.body.matching.selected.ref.version = "2.0.0";
      },
      (f: typeof fixture) => {
        f.view.display.canonicalContentSha256 = "0".repeat(64);
      },
      (f: typeof fixture) => {
        f.body.provenance.answersHash = "0".repeat(64);
      },
      (f: typeof fixture) => {
        f.view.display.bodySha256 = "invalid";
      },
    ];
    for (const change of mutations) {
      const f = structuredClone(fixture);
      change(f);
      expect(deriveQianzaiResultPresentation(f.view, f.binding)).toBeNull();
    }
  });
  it("requires an accepted full claim ref and its exact selected evidence; facts-only/fallback never authorize the variant", () => {
    const f = structuredClone(fixture);
    accepted(f);
    expect(
      deriveQianzaiResultPresentation(f.view, f.binding)!.reveal.id,
    ).toContain("/leisure-new@");
    const mutations = [
      (f: typeof fixture) => {
        f.body.volumes[0]!.paragraphs[0]!.status = "facts-only";
      },
      (f: typeof fixture) => {
        f.body.volumes[0]!.paragraphs[0]!.status = "fallback";
      },
      (f: typeof fixture) => {
        f.body.volumes[0]!.paragraphs[0]!.claimRef!.version = "2.0.0";
      },
      (f: typeof fixture) => {
        f.body.volumes[0]!.paragraphs[0]!.evidence[0]!.optionRef.id = "q02-d";
      },
      (f: typeof fixture) => {
        f.body.volumes[0]!.paragraphs[0]!.counterevidence = [
          f.body.volumes[0]!.paragraphs[0]!.evidence[0]!,
        ];
      },
      (f: typeof fixture) => {
        f.body.answers = f.body.answers.filter(
          (a) => a.questionRef.id !== "q02",
        );
      },
    ];
    for (const change of mutations) {
      const next = structuredClone(f);
      change(next);
      expect(
        deriveQianzaiResultPresentation(next.view, next.binding)!.reveal
          .supportingClaimRefs,
      ).toEqual([]);
    }
  });
  it("shares three concise literary variant groups between reveal and poster without changing their support or invitation", () => {
    const variants = [
      {
        id: "leisure-new-longterm-familiar",
        claim: "authored-407a0f1c9a00adc8d3b5",
        kind: "context" as const,
        option: "q02-b",
        lines: ["为新意轻轻推开一扇窗，", "也让熟悉的技艺，在岁月里生长。"],
      },
      {
        id: "leisure-new",
        claim: "authored-7053c48e83fe3e6c223d",
        kind: "fact" as const,
        option: "q02-b",
        lines: ["为新的可能，轻轻推开一扇窗，", "让一段小小的尝试，走进日常。"],
      },
      {
        id: "leisure-familiar",
        claim: "authored-929aed7c242fa56709e4",
        kind: "fact" as const,
        option: "q02-d",
        lines: ["让熟悉的热爱，慢慢生长，", "把愿意投入的心意，留在日常。"],
      },
    ];
    for (const variant of variants) {
      const f = structuredClone(fixture);
      accepted(f);
      const p = f.body.volumes[0]!.paragraphs[0]!;
      p.claimRef!.id = variant.claim;
      p.kind = variant.kind;
      p.evidence[0]!.optionRef.id = variant.option;
      f.body.answers.at(-1)!.optionRef.id = variant.option;
      if (variant.id === "leisure-new-longterm-familiar") {
        const counter = {
          ...p.evidence[0]!,
          questionRef: { ...p.evidence[0]!.questionRef, id: "q18" },
          optionRef: { ...p.evidence[0]!.optionRef, id: "q18-c" },
        };
        p.counterevidence = [counter];
        f.body.answers.push({ ...counter, act: 1 });
      }
      const before = structuredClone(f.body);
      const result = deriveQianzaiResultPresentation(f.view, f.binding)!;
      expect(result.reveal.id).toContain(`/${variant.id}@`);
      expect(result.reveal.supportingClaimRefs).toEqual([p.claimRef]);
      expect(result.reveal.lines).toEqual([
        ...variant.lines,
        result.role.invitation,
      ]);
      expect(result.reveal.lines.every((line) => [...line].length <= 20)).toBe(
        true,
      );
      expect(result.reveal.lines.join("")).not.toMatch(
        /闲暇|下一阶段|这次|这一刻的选择/u,
      );
      expect(result.poster.lines).toBe(result.reveal.lines);
      expect(f.body).toEqual(before);
    }
  });
  it("keeps each supported role separate, with bounded complete short groups and no invented Mulan alias or author credit", () => {
    for (const id of [
      "li-bai",
      "su-shi",
      "tao-yuanming",
      "li-qingzhao",
      "mulan-ballad",
    ]) {
      const f = structuredClone(fixture);
      f.body.matching.selected.ref.id = id;
      f.view.display.selectedResultRef = { ...f.body.matching.selected.ref };
      accepted(f);
      const result = deriveQianzaiResultPresentation(f.view, f.binding)!;
      expect(result.role.ref.id).toBe(id);
      expect(result.reveal.lines).toHaveLength(3);
      expect(result.reveal.lines.every((line) => [...line].length <= 20)).toBe(
        true,
      );
      expect(result.poster.lines).toBe(result.reveal.lines);
      if (id === "li-qingzhao") {
        // Both stable choices must be complete excerpts long enough for the
        // single-column reveal; a short fallback must not reappear by seed.
        expect(result.role.quotes).toHaveLength(2);
        for (const quote of result.role.quotes) {
          const han = quote.text.match(/\p{Script=Han}/gu) ?? [];
          expect(han.length).toBeGreaterThanOrEqual(12);
          expect(han.length).toBeLessThanOrEqual(18);
          expect(quote.source).toMatch(/李清照《(?:如梦令|渔家傲)/u);
          expect(new URL(quote.sourceUrl).hostname).toBe("zh.wikisource.org");
        }
      }
      if (id === "mulan-ballad") {
        expect(result.role.displayName).toBe("木兰");
        expect(result.role.aliasSeal).toBeUndefined();
        expect(result.quote.source).toContain("佚名");
      }
    }
  });
});
