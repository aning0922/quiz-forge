import { describe, expect, it } from "vitest";
import { qianzaiConsumerCopyFixture as fixture } from "./consumer-copy.test-support";
import { qianzaiConsumerCopy } from "./consumer-copy";
import { deriveQianzaiResultPresentation } from "./result-presentation";
import {
  qianzaiSupportedThemeReading,
  qianzaiSupportedThemeReadingText,
} from "./supported-theme-reading";

describe("opt-in supported theme reading", () => {
  it("connects qualified choices, bounded meaning, conditions and a next step without changing the report", async () => {
    const f = await fixture(),
      before = structuredClone(f.body),
      readings = qianzaiSupportedThemeReading(f.body);
    expect(readings.map((r) => r.topic)).toEqual([
      "exploration",
      "care",
      "action",
    ]);
    expect(readings[0]!.choice).toContain("小作品");
    expect(readings[0]!.condition).toContain("退出成本");
    expect(readings[1]!.condition).toContain("明确期限");
    expect(readings[2]!.condition).toContain("难以撤回");
    expect(readings[2]!.nextStep).toContain("停下来检查");
    for (const [i, r] of readings.entries()) {
      expect(r.snapshot).toBe(f.body.volumes[2]!.paragraphs[i]);
      expect(
        [r.choice, r.meaning, r.condition, r.nextStep].join(""),
      ).not.toMatch(/RAW_|q\d{2}|Q\d{2}|authored-|accepted|facts-only/u);
    }
    expect(f.body).toEqual(before);
  });

  it("leaves one supported topic as one and sparse or facts-only reports empty", async () => {
    const f = await fixture();
    f.body.volumes[2]!.paragraphs.splice(1);
    expect(qianzaiSupportedThemeReading(f.body)).toHaveLength(1);
    f.body.volumes[2]!.paragraphs[0]!.status = "facts-only";
    expect(qianzaiSupportedThemeReading(f.body)).toEqual([]);
    f.body.volumes[2]!.paragraphs = [];
    f.body.dimensions.forEach((d) => {
      d.score = 100;
    });
    expect(qianzaiSupportedThemeReading(f.body)).toEqual([]);
  });

  it("does not promote copied prose, a claim ID or incomplete support into a reading", async () => {
    const f = await fixture();
    f.body.volumes[2]!.paragraphs.splice(1);
    const p = f.body.volumes[2]!.paragraphs[0]!;
    p.text = "你特别勇敢而且总能成功。";
    p.evidence.pop();
    expect(qianzaiSupportedThemeReading(f.body)).toEqual([]);
    p.evidence = [];
    p.status = "fallback";
    expect(qianzaiSupportedThemeReading(f.body)).toEqual([]);
  });

  it("preserves supported mixed context while leaving counterevidence and near-tie facts intact", async () => {
    const f = await fixture();
    // The fixture already has both answers used by this existing mixed-context selector.
    const p = f.body.volumes[2]!.paragraphs[2]!;
    p.claimRef!.id = "authored-10297a0921ca8d92695f";
    p.kind = "context";
    p.evidence = p.evidence.filter((e) => e.optionRef.id === "q07-b");
    const questionRef = {
      productId: "qianzai-tongxin",
      id: "q20",
      version: "1.0.0",
    };
    const optionRef = { ...questionRef, id: "q20-a" };
    const answer = {
      questionRef,
      optionRef,
      prompt: "RAW_LONG_TASK",
      optionText: "RAW_PLAN",
      act: 1,
    };
    f.body.answers.push(answer);
    p.counterevidence = [{ ...answer, scope: "RAW_CONTEXT" }];
    f.body.matching.status = "near-tie";
    f.body.matching.runnerUp = {
      ...f.body.matching.selected,
      ref: { ...f.body.matching.selected.ref, id: "su-shi" },
    };
    const before = structuredClone(f.body);
    const r = qianzaiSupportedThemeReading(f.body).find(
      (r) => r.topic === "action",
    )!;
    expect(r.choice).toContain("整套规划");
    expect(r.condition).toContain("能否撤回");
    expect(r.snapshot.counterevidence).toBe(p.counterevidence);
    expect(f.body).toEqual(before);
    p.counterevidence = [];
    expect(
      qianzaiSupportedThemeReading(f.body).some((r) => r.topic === "action"),
    ).toBe(false);
  });

  it("is independent of role labels and leaves retained v2 copy unchanged", async () => {
    const f = await fixture(),
      result = deriveQianzaiResultPresentation(f.view, f.binding)!,
      oldCopy = qianzaiConsumerCopy(f.body, result),
      readings = qianzaiSupportedThemeReading(f.body);
    expect(oldCopy!.consumerCopyVersion).toBe("qianzai-consumer-copy.v2");
    expect(qianzaiConsumerCopy(f.body, result)).toEqual(oldCopy);
    f.body.matching.selected.ref.id = "li-bai";
    f.body.matching.selected.label = "不同角色标签";
    expect(qianzaiSupportedThemeReading(f.body)).toEqual(readings);
  });

  it("provides every emitted sentence in a fixed answer-free font corpus", async () => {
    const corpus = qianzaiSupportedThemeReadingText();
    for (const r of qianzaiSupportedThemeReading((await fixture()).body))
      for (const text of [r.choice, r.meaning, r.condition, r.nextStep])
        expect(corpus).toContain(text);
    expect(corpus.join("")).not.toMatch(/RAW_|q\d{2}|Q\d{2}|https?:/u);
  });
});
