import { persistedReportFixtureV2 } from "@/features/report/persisted/contracts-v2.test-support";
import type { ConsumerV2ReaderModel } from "@/lib/consumer-contract/v2/client-contract";
import type { QianzaiAssetBinding } from "@/features/theme/qianzai-tongxin/resource-owner";
import { QIANZAI_RUNTIME_INPUTS } from "@/features/theme/qianzai-tongxin/runtime-inputs";
import {
  QIANZAI_COMPONENT_MAPPING,
  QIANZAI_CONSUMER_RENDERER,
} from "@/features/theme/qianzai-tongxin/component-map";
/** Invented read-only completed model. Test authority/bytes only; never native/author approval. */
export async function qianzaiExportFixture() {
  const fixture = await persistedReportFixtureV2();
  const view = structuredClone(fixture.view),
    body = view.display.body;
  body.title = "千载同心";
  body.matching.selected.label = "合成人物";
  body.matching.runnerUp = null;
  const labels = ["守心", "寻远", "知情", "决断", "应变"];
  body.dimensions.forEach((d, i) => {
    d.label = labels[i]!;
  });
  const titles = ["相逢", "五维", "选择", "反证", "人物", "寄语"];
  body.volumes.forEach((v, i) => {
    v.title = titles[i]!;
    v.paragraphs = [
      {
        claimRef: null,
        kind: "fact",
        status: "facts-only",
        text: "本轮选择的记录。".repeat([1, 3, 6, 4, 3, 2][i]!),
        evidence: [],
        counterevidence: [],
      },
    ];
  });
  body.volumes[2]!.paragraphs[0]!.evidence = [
    {
      questionRef: body.answers[0]!.questionRef,
      optionRef: body.answers[0]!.optionRef,
      scope: "本轮记录",
      prompt: "本轮选择",
      optionText: "选择的记录。",
    },
  ];
  view.display.presentationMode = "authored-product";
  view.display.exports = { posterPng: true, fullReportPng: true };
  view.renderer = {
    kind: "consumer-renderer",
    ...QIANZAI_CONSUMER_RENDERER,
    entrySha256: "e".repeat(64),
  };
  view.mapping = structuredClone(QIANZAI_COMPONENT_MAPPING);
  const font = QIANZAI_RUNTIME_INPUTS.font!;
  view.font = {
    id: font.id,
    version: font.version,
    weight: font.weight,
    fileSha256: font.fileSha256,
    coverageSha256: font.coverageSha256,
    licenseSha256: font.licenseSha256,
  };
  view.display.assets.forEach((a) => {
    a.approval = "approved";
  });
  const c = view.display.slots.character;
  const model: ConsumerV2ReaderModel = {
    phase: "completed",
    entry: null,
    state: null,
    draft: null,
    report: { view, receipt: structuredClone(fixture.receipt) },
    pendingOperation: null,
    savedAt: null,
    message: null,
  };
  const bindings: QianzaiAssetBinding[] = [
    ["poster", c.poster],
    ["report", c.report],
    ["nameArt", c.nameArt],
  ].map(([slot, ref]) => {
    const asset = view.display.assets.find(
      (a) => JSON.stringify(a.resourceRef) === JSON.stringify(ref),
    )!;
    const { alt, ...facts } = asset;
    void alt;
    return {
      slot: `character.${slot}` as
        "character.poster" | "character.report" | "character.nameArt",
      layer: "clean",
      asset: facts,
    };
  });
  return { model, body, bindings, font };
}
