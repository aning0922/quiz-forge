import { describe, expect, it } from "vitest";
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SelectedHistoricalCover } from "./cover";
import { SelectedHistoricalResult } from "./result";
import { historicalReportFixture } from "@/features/report/historical-fixture";
import { findConceptPortrait } from "./tokens";

describe("historical reveal presentation boundary", () => {
  it("unrevealed markup does not expose a portrait or injected result fields", () => {
    // Simulate accidental extra data at runtime. The cover has no result input contract.
    const markup = renderToStaticMarkup(
      createElement(
        SelectedHistoricalCover as ComponentType<{
          report: typeof historicalReportFixture;
        }>,
        { report: historicalReportFixture },
      ),
    );
    expect(markup).not.toContain("李白");
    expect(markup).not.toContain("li-bai-concept");
    expect(markup).not.toContain("浪漫自由的行路者");
    expect(markup).toContain("中性情境视觉");
  });
  it("unknown portraits never silently substitute the representative character", () => {
    for (const id of [
      "",
      "unknown",
      "__proto__",
      "../../li-bai",
      "https://example.com/image.webp",
    ])
      expect(findConceptPortrait(id)).toBeNull();
    const report = {
      ...historicalReportFixture,
      identity: {
        ...historicalReportFixture.identity,
        name: "合成人物",
        portraitAssetId: "unknown",
      },
    };
    const markup = renderToStaticMarkup(
      createElement(SelectedHistoricalResult, { report }),
    );
    expect(markup).toContain("该人物立绘待补齐");
    expect(markup).not.toContain("li-bai-concept.webp");
    expect(markup).toContain("合成人物");
  });
  it("missing comparison data stays explicitly empty instead of invented", () => {
    const markup = renderToStaticMarkup(
      createElement(SelectedHistoricalResult, {
        report: { ...historicalReportFixture, similarPeople: [] },
      }),
    );
    expect(markup).toContain("暂无相似人物资料");
    expect(markup).not.toContain("苏轼");
    expect(markup).not.toContain("陶渊明");
  });
});
