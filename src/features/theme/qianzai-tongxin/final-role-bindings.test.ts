import { expect, it } from "vitest";
import baseline from "@/features/product/internal-versions/baselines/qztx-final-private-20261103-demo.json";
import registration from "@/features/quizpack/content/private-test-registration-final-demo.json";
import { qianzaiExportFixture } from "@/features/report/qianzai-tongxin/export.test-support";
import { QIANZAI_RUNTIME_INPUTS } from "./runtime-inputs";
import { admittedQianzaiBindings } from "./resource-owner";

it.each(baseline.slots.characters)(
  "admits all four final ordinary images for $resultRef.id into the runtime image layer",
  async (character) => {
    const { model } = await qianzaiExportFixture();
    model.phase = "completed";
    model.pendingOperation = null;
    const display = model.report!.view.display;
    display.slots = { neutral: baseline.slots.neutral, character };
    display.selectedResultRef = character.resultRef;
    display.body.matching.selected.ref = character.resultRef;
    display.assets = registration.resources.map(
      ({ id, productId, version, ...facts }) => ({
        ...facts,
        approval: "private-test-only" as const,
        purpose: facts.purpose as "portrait" | "cover" | "decoration",
        mediaType: facts.mediaType as "image/png" | "image/webp" | "image/jpeg",
        resourceRef: { id, productId, version },
        alt: id,
      }),
    );
    const images = admittedQianzaiBindings(
      model,
      QIANZAI_RUNTIME_INPUTS.resources,
    ).filter((b) => b.slot.startsWith("character."));
    expect(images.map((i) => i.slot).sort()).toEqual([
      "character.nameArt",
      "character.poster",
      "character.report",
      "character.reveal",
    ]);
    expect(
      images.every((i) => i.layer === "clean" && i.resultRef === undefined),
    ).toBe(true);
  },
);
