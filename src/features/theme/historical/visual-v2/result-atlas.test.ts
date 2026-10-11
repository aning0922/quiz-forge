import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { historicalAtlasFixture } from "@/features/report/historical-atlas-fixture";
import { getStudyInscription } from "@/features/report/historical-inscriptions";
import { ResultAtlas } from "./result-atlas";
import { TemperamentInscriptionView } from "./inscription";

describe("atlas and inscription presentation", () => {
  it.each(["journey", "collection"] as const)(
    "%s exposes exact meter values and synthetic provenance as text",
    (direction) => {
      const html = renderToStaticMarkup(
        createElement(ResultAtlas, {
          atlas: historicalAtlasFixture,
          direction,
        }),
      );
      expect(html.match(/role="meter"/g)).toHaveLength(5);
      expect(html).toContain('aria-valuenow="88"');
      expect(html).toContain('aria-valuemin="0"');
      expect(html).toContain('aria-valuemax="100"');
      expect(html).toContain("不来自当前12道题");
      expect(html).toContain("两端不分优劣");
    },
  );
  it("renders no invented scores on invalid data", () => {
    const html = renderToStaticMarkup(
      createElement(ResultAtlas, {
        atlas: { ...historicalAtlasFixture, dimensions: [] },
        direction: "journey",
      }),
    );
    expect(html).toContain("性情图谱暂不可用");
    expect(html).not.toContain('role="meter"');
  });
  it("omits an optional inscription and visibly separates original from attributed poetry", () => {
    expect(
      renderToStaticMarkup(
        createElement(TemperamentInscriptionView, {
          inscription: null,
          direction: "journey",
        }),
      ),
    ).toBe("");
    const quote = renderToStaticMarkup(
      createElement(TemperamentInscriptionView, {
        inscription: getStudyInscription("classical"),
        direction: "collection",
      }),
    );
    expect(quote).toContain("李白《行路难·其一》");
    expect(quote).toContain("https://sxss.ntu.edu.cn/");
    const original = renderToStaticMarkup(
      createElement(TemperamentInscriptionView, {
        inscription: getStudyInscription("original"),
        direction: "journey",
      }),
    );
    expect(original).toContain("原创拟古 · 非古诗引用");
    expect(original).not.toContain("李白");
  });
});
