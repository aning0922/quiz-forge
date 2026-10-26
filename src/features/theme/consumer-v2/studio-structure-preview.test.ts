import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { StudioStructurePreviewV2 } from "./studio-structure-preview";
import { structuredReaderFixtureV2 } from "./fixtures.test-support";

it("shows a temporary result without supplying a consumer session, key or persisted receipt", () => {
  const { model, completed } = structuredReaderFixtureV2();
  const result = completed.report!.view.display;
  const markup = renderToStaticMarkup(
    createElement(StudioStructurePreviewV2, {
      revision: 3,
      entry: model.entry,
      result,
      answers: [],
      matchingContext: null,
      busy: true,
      disabled: false,
      message: "正在校验修订",
      onAnswer() {},
      onPreference() {},
      onScore() {},
    }),
  );
  expect(markup).toContain("修订 3");
  expect(markup).toContain("临时预览");
  expect(markup).toContain("第 24 题");
  expect(markup).toMatch(/<fieldset[^>]*disabled/);
  for (const volume of result.body.volumes)
    expect(markup).toContain(volume.title);
  expect(markup).not.toContain("确认完成并封存报告");
});
