import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ConsumerV2ReaderModel } from "@/lib/consumer-contract/v2/client-contract";
import {
  ConsumerPreferenceViewV2,
  ConsumerQuestionViewV2,
  ConsumerReportViewV2,
  ConsumerResultViewV2,
  ConsumerPosterViewV2,
  consumerDraftStatusV2,
} from "./components";
import { ConsumerExperienceV2, supportsStructuredReaderV2 } from "./host";
import { structuredReaderFixtureV2 } from "./fixtures.test-support";
import {
  CONSUMER_COMPONENT_MAPPING_V2,
  matchesConsumerMappingV2,
} from "./component-map";

const html = (
  Component: typeof ConsumerPreferenceViewV2,
  model: ConsumerV2ReaderModel,
) =>
  renderToStaticMarkup(
    createElement(Component, { model, onEvent() {}, onRead() {} }),
  );
describe("v2 structured reader (synthetic props, no service persistence proof)", () => {
  it.each([
    "saving",
    "completing",
    "unknown",
    "conflict",
    "denied",
    "unavailable",
  ] as const)(
    "preserves selected input and disables editing for %s",
    (phase) => {
      const { model } = structuredReaderFixtureV2();
      model.phase = phase;
      model.draft!.matchingContext = {
        schemaVersion: "quiz-matching-context.v1",
        preference: "female",
        policyRef: model.entry!.matchingPolicyRef,
      };
      model.draft!.progress.questionId = "q-0";
      model.draft!.answers = [{ questionId: "q-0", optionId: "q-0-o-2" }];
      for (const Component of [
        ConsumerPreferenceViewV2,
        ConsumerQuestionViewV2,
      ]) {
        const rendered = html(Component, model);
        expect(rendered).toMatch(/<fieldset[^>]*disabled/);
        expect(rendered).toContain('checked=""');
      }
      expect(consumerDraftStatusV2(model)).toEqual({
        preferenceSaved: false,
        answersSaved: false,
        progressSaved: false,
      });
    },
  );
  it("keeps null preference distinct from explicit any; pending operation blocks even ready", () => {
    const { model } = structuredReaderFixtureV2();
    expect(html(ConsumerPreferenceViewV2, model)).not.toContain('checked=""');
    model.draft!.matchingContext = {
      schemaVersion: "quiz-matching-context.v1",
      preference: "any",
      policyRef: model.entry!.matchingPolicyRef,
    };
    model.pendingOperation = "save";
    expect(html(ConsumerPreferenceViewV2, model)).toMatch(
      /<input(?=[^>]*value="any")(?=[^>]*checked="")[^>]*>/,
    );
    expect(html(ConsumerPreferenceViewV2, model)).toMatch(
      /<fieldset[^>]*disabled/,
    );
  });
  it("shows all sealed volumes, supporting choices, counterevidence and actual dimensions", () => {
    const { completed } = structuredReaderFixtureV2(),
      body = completed.report!.view.display.body;
    body.volumes[0]!.paragraphs[0]!.counterevidence = [
      body.volumes[0]!.paragraphs[0]!.evidence[0]!,
    ];
    const rendered = html(ConsumerReportViewV2, completed);
    for (const v of body.volumes)
      expect(rendered).toContain(v.paragraphs[0]!.text);
    expect(rendered).toContain("支持本段的实际选择");
    expect(rendered).toContain("应同时阅读的反向证据");
    expect(rendered).toContain(body.answers[0]!.optionText);
    expect(rendered).toContain(`${body.dimensions[0]!.score} / 100`);
    expect(rendered).not.toContain("重新答题");
    const result = html(ConsumerResultViewV2, completed);
    expect(result).toContain("本轮候选池仅一人，没有第二候选");
    expect(result).not.toContain("第二候选：");
    expect(html(ConsumerPosterViewV2, completed)).toContain("分享暂不可用");
  });
  it("rejects different rendering/export/font/mapping capabilities without download or editing", () => {
    const { completed, model } = structuredReaderFixtureV2();
    expect(supportsStructuredReaderV2(completed)).toBe(true);
    // Runtime mismatch injected after parsing: a future valid display must still be rejected here.
    Object.assign(completed.report!.view.display, {
      presentationMode: "authored-product",
    });
    expect(supportsStructuredReaderV2(completed)).toBe(false);
    Object.assign(completed.report!.view.display, {
      presentationMode: "structured-only",
      exports: { posterPng: true, fullReportPng: false },
    });
    expect(supportsStructuredReaderV2(completed)).toBe(false);
    expect(
      renderToStaticMarkup(
        createElement(ConsumerExperienceV2, { model: completed, onEvent() {} }),
      ),
    ).toContain("此呈现版本暂不兼容");
    expect(matchesConsumerMappingV2(CONSUMER_COMPONENT_MAPPING_V2)).toBe(true);
    const wrong = structuredClone(CONSUMER_COMPONENT_MAPPING_V2);
    Object.assign(wrong.states.report.runtime, {
      id: "consumer-foreign-report",
    });
    expect(matchesConsumerMappingV2(wrong)).toBe(false);
    expect(supportsStructuredReaderV2(model)).toBe(true);
    const fontMismatch = structuredReaderFixtureV2().completed;
    Object.assign(fontMismatch.report!.view, {
      font: { id: "legacy-fixed-font" },
    });
    expect(supportsStructuredReaderV2(fontMismatch)).toBe(false);
  });
});
