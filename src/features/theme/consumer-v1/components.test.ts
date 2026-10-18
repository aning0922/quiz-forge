import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { consumerDisplayFixture } from "./fixtures.test-support";
import {
  ConsumerQuestionView,
  ConsumerReportView,
  ConsumerPosterView,
} from "./components";

describe("actual pure consumer components (SSR, not browser acceptance)", () => {
  it.each([
    "saving",
    "unknown",
    "conflict",
    "authority-lost",
    "unavailable",
  ] as const)(
    "blocks editing and makes no saved claim for %s",
    async (reason) => {
      const f = await consumerDisplayFixture();
      const html = renderToStaticMarkup(
        createElement(ConsumerQuestionView, {
          entry: f.entry,
          questionId: f.entry.questions[0]!.id,
          answers: {},
          media: { kind: "unavailable" },
          controls: { kind: "blocked", reason },
        }),
      );
      expect(html).toContain("<fieldset");
      expect(html).toMatch(/<fieldset[^>]+disabled/);
      expect(html).not.toContain("当前进度已保存");
      expect(html).toContain("素材暂不可用");
      expect(html).not.toContain("刷新后重置");
    },
  );
  it("completed views expose read-only navigation and suppress export for unavailable poster", async () => {
    const f = await consumerDisplayFixture();
    const html = renderToStaticMarkup(
      createElement(ConsumerReportView, {
        display: f.display,
        media: { kind: "unavailable" },
        onResult() {},
        onPoster() {},
      }),
    );
    expect(html).toContain("报告已保存");
    expect(html).not.toMatch(/返回检查答案|重新答题|待审|非正式报告|<input/);
    const display = {
      ...f.display,
      poster: {
        kind: "unavailable" as const,
        code: "POSTER_LIMIT_EXCEEDED" as const,
      },
    };
    const poster = renderToStaticMarkup(
      createElement(ConsumerPosterView, {
        display,
        media: { kind: "unavailable" },
        onReport() {},
        exportState: {
          kind: "idle",
          onExport() {
            throw Error("MUST_NOT_RUN");
          },
        },
      }),
    );
    expect(poster).not.toContain("生成报告海报");
    expect(poster).toContain("报告仍可阅读");
  });
});
