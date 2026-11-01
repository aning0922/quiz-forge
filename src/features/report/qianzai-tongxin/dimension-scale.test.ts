import { describe, expect, it } from "vitest";
import { qianzaiDimensionScale } from "./dimension-scale";
import type { ComposedReportBodyV1 } from "@/lib/assessment-contract/composed-report-v1";
import { QIANZAI_V11_CONTENT_SHA256 as source } from "./role-profiles-v11";
const dimension = (
  score: number,
): ComposedReportBodyV1["dimensions"][number] => ({
  dimensionRef: {
    productId: "qianzai-tongxin",
    id: "axis-1",
    version: "1.0.0",
  },
  label: "守心",
  score,
});
describe("Qianzai display-only dimension scale", () => {
  it.each([
    [0, "left"],
    [44, "left"],
    [45, "middle"],
    [46, "middle"],
    [50, "middle"],
    [55, "middle"],
    [56, "right"],
    [100, "right"],
  ] as const)(
    "keeps sealed %i and classifies its display position as %s",
    (score, position) => {
      const input = dimension(score),
        before = structuredClone(input),
        result = qianzaiDimensionScale(input, source)!;
      expect(result.score).toBe(score);
      expect(result.position).toBe(position);
      expect(result.geometry.positionPercent).toBe(score);
      expect(result.geometry.midpointPercent).toBe(50);
      expect(
        result.geometry.bandStartPercent + result.geometry.bandWidthPercent,
      ).toBe(Math.max(50, score));
      expect(result.geometry.bandStartPercent).toBe(Math.min(50, score));
      expect(input).toEqual(before);
      expect(Object.isFrozen(input)).toBe(false);
      if (position === "middle") {
        expect(result.caption).toContain("接近中点");
        expect(result.caption).not.toContain("均衡");
      } else
        expect(result.caption).toContain(
          position === "left" ? result.left : result.right,
        );
    },
  );
  it("uses the approved orientation for all five complete axis references", () => {
    const expected = [
      ["守心", "协调共同选择", "表达自身选择"],
      ["寻远", "深入熟悉领域", "尝试陌生事物"],
      ["知情", "先处理问题", "先回应感受"],
      ["决断", "先了解条件", "先行动体验"],
      ["应变", "保留结构局部调整", "整体重新安排"],
    ];
    expected.forEach(([label, left, right], i) => {
      const value = {
        ...dimension(100),
        dimensionRef: { ...dimension(100).dimensionRef, id: `axis-${i + 1}` },
        label: label!,
      };
      const result = qianzaiDimensionScale(value, source)!;
      expect(result.left).toBe(left);
      expect(result.right).toBe(right);
      expect(result.caption).toContain(right);
      if (i === 4) {
        expect(result.explanation).toContain("活动重组情境");
        expect(result.explanation).toContain("不足以概括广义应变能力");
      }
    });
  });
  it("does not clamp invalid scores or infer semantics from a foreign/mislabelled dimension", () => {
    for (const value of [-1, 101, NaN, Infinity, 49.5])
      expect(qianzaiDimensionScale(dimension(value), source)).toBeNull();
    for (const unsupported of [undefined, "0".repeat(64)])
      expect(qianzaiDimensionScale(dimension(50), unsupported)).toBeNull();
    const original = dimension(50);
    for (const value of [
      { ...original, label: "创造力" },
      {
        ...original,
        dimensionRef: { ...original.dimensionRef, productId: "other" },
      },
      {
        ...original,
        dimensionRef: { ...original.dimensionRef, version: "2.0.0" },
      },
      { ...original, dimensionRef: { ...original.dimensionRef, id: "axis-6" } },
    ])
      expect(qianzaiDimensionScale(value, source)).toBeNull();
  });
});
