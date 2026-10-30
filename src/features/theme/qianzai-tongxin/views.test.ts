import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { structuredReaderFixtureV2 } from "../consumer-v2/fixtures.test-support";
import { QianzaiTongxinExperience, qianzaiResumeQuestion } from "./experience";
import { QianzaiReport } from "./report";
import { QianzaiPreference, QianzaiQuestion } from "./views";
import { qianzaiImage, qianzaiCharacter, qianzaiPrototypeImage } from "./art";
import type { QianzaiResolvedImage, QianzaiPrototypeImage } from "./art";

describe("Qianzai D3 view ports (synthetic props only)", () => {
  it("requires exact approved scoped resource metadata and a clean local object URL", () => {
    const { model } = structuredReaderFixtureV2();
    const asset = model.entry!.assets.find(
      (a) => a.resourceRef.id === model.entry!.slots.cover.id,
    )!;
    const image: QianzaiResolvedImage = {
      asset,
      objectUrl: "blob:synthetic",
      layer: "clean",
    };
    expect(qianzaiImage(model, asset.resourceRef, [image])).toBe(image);
    for (const changed of [
      { ...image, asset: { ...asset, sha256: "0".repeat(64) } },
      { ...image, asset: { ...asset, width: asset.width + 1 } },
      { ...image, objectUrl: "https://example.invalid/art.png" },
      { ...image, layer: "old-full-page" },
    ])
      expect(
        qianzaiImage(model, asset.resourceRef, [
          changed as QianzaiResolvedImage,
        ]),
      ).toBeUndefined();
    model.phase = "denied";
    expect(qianzaiImage(model, asset.resourceRef, [image])).toBeUndefined();
    const { completed } = structuredReaderFixtureV2();
    completed.report!.view.display.slots.character.resultRef.id =
      "other-character";
    expect(qianzaiCharacter(completed)).toBeUndefined();
  });
  it("withholds baked-UI bases until the full question composition is ready and never treats them as clean character art", () => {
    const { model, completed } = structuredReaderFixtureV2();
    const scene = model.entry!.slots.acts[0]!;
    const original = model.entry!.assets.find(
      (a) => a.resourceRef.id === scene.background.id,
    )!;
    for (const key of [
      "background",
      "questionPaper",
      "optionIdle",
      "optionSelected",
    ] as const) {
      scene[key] = { ...scene[key], id: "safety-" + key };
      model.entry!.assets.push({ ...original, resourceRef: scene[key] });
    }
    model.draft!.progress.questionId = model.entry!.questions[0]!.ref.id;
    const asset = (ref: typeof scene.background) =>
      model.entry!.assets.find((a) => a.resourceRef.id === ref.id)!;
    const base: QianzaiPrototypeImage = {
      asset: asset(scene.background),
      objectUrl: "blob:baked-base",
      layer: "prototype-scene-base",
    };
    const skins: QianzaiPrototypeImage[] = [
      scene.optionIdle,
      scene.optionSelected,
    ].map((ref) => ({
      asset: asset(ref),
      objectUrl: ("blob:" + ref.id) as `blob:${string}`,
      layer: "prototype-option-skin",
    }));
    const paper: QianzaiResolvedImage = {
      asset: asset(scene.questionPaper),
      objectUrl: "blob:clean-paper",
      layer: "clean",
    };
    const props = {
      model,
      onRead() {},
      onEvent() {},
      onChoose() {},
      prototypeImages: [base, ...skins],
    };
    expect(
      renderToStaticMarkup(createElement(QianzaiQuestion, props)),
    ).not.toContain('src="blob:baked-base"');
    expect(
      renderToStaticMarkup(
        createElement(QianzaiQuestion, { ...props, images: [paper] }),
      ),
    ).toContain('src="blob:baked-base"');
    expect(
      qianzaiPrototypeImage(model, scene.optionIdle, [
        { ...skins[0]!, layer: "prototype-scene-base" },
      ]),
    ).toBeUndefined();
    expect(
      qianzaiPrototypeImage(
        model,
        scene.background,
        [{ ...base, layer: "prototype-option-skin" }],
        "prototype-option-skin",
      ),
    ).toBeUndefined();
    expect(
      qianzaiImage(model, scene.background, [
        base as unknown as QianzaiResolvedImage,
      ]),
    ).toBeUndefined();
    expect(
      qianzaiPrototypeImage(
        completed,
        completed.report!.view.display.slots.character.reveal,
        [base],
      ),
    ).toBeUndefined();
    model.phase = "denied";
    expect(
      qianzaiPrototypeImage(model, scene.background, [base]),
    ).toBeUndefined();
  });
  it("keeps null preference distinct and disables preserved answers while unknown", () => {
    const { model } = structuredReaderFixtureV2();
    const props = {
      model,
      onRead() {},
      onEvent() {},
      onChoose() {},
      onEnter() {},
    };
    expect(
      renderToStaticMarkup(createElement(QianzaiPreference, props)),
    ).not.toContain('checked=""');
    model.draft!.matchingContext = {
      schemaVersion: "quiz-matching-context.v1",
      preference: "any",
      policyRef: model.entry!.matchingPolicyRef,
    };
    model.draft!.progress.questionId = "q-0";
    model.draft!.answers = [{ questionId: "q-0", optionId: "q-0-o-0" }];
    model.phase = "unknown";
    model.pendingOperation = "save";
    expect(qianzaiResumeQuestion(model)).toBeUndefined();
    for (const html of [
      renderToStaticMarkup(createElement(QianzaiPreference, props)),
      renderToStaticMarkup(createElement(QianzaiQuestion, props)),
    ]) {
      expect(html).toContain('checked=""');
      expect(html).toMatch(/<fieldset[^>]*disabled/);
    }
  });
  it("renders sealed prose, counterevidence, variable index and five values without a demo report or export", () => {
    const { completed } = structuredReaderFixtureV2();
    const body = completed.report!.view.display.body;
    body.matching.selected.narrativeIndex = 37;
    body.dimensions = Array.from({ length: 5 }, (_, i) => ({
      dimensionRef: { ...body.dimensions[0]!.dimensionRef, id: `axis-${i}` },
      label: `合成维${i}`,
      score: 10 + i * 17,
    }));
    body.volumes[0]!.paragraphs[0]!.counterevidence = [
      body.volumes[0]!.paragraphs[0]!.evidence[0]!,
    ];
    const html = renderToStaticMarkup(
      createElement(QianzaiReport, {
        model: completed,
        onRead() {},
        onEvent() {},
      }),
    );
    for (const v of body.volumes) expect(html).toContain(v.paragraphs[0]!.text);
    for (const d of body.dimensions) expect(html).toContain(`${d.score} / 100`);
    expect(html).toContain("同时阅读的反向证据");
    expect(html).toContain("37");
    expect(html).toContain("本轮偏好下仅有一位候选人物。");
    expect(html).not.toContain("89%");
    expect(html).not.toContain("下载");
  });
  it("never displays a report or artwork after access denial", () => {
    const { completed } = structuredReaderFixtureV2();
    completed.phase = "denied";
    const html = renderToStaticMarkup(
      createElement(QianzaiTongxinExperience, {
        model: completed,
        onEvent() {},
      }),
    );
    expect(html).toContain("本次访问已结束");
    expect(html).not.toContain(completed.report!.view.display.body.title);
    expect(html).not.toContain("<img");
  });
});
