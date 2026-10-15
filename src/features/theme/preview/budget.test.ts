import { beforeAll, describe, expect, it } from "vitest";
import type { QuizPackContentV2 } from "@/features/quizpack/content/v2";
import { PREVIEW_LIMITS } from "@/features/product/preview/limits";
import { preparePreviewContent, scorePreview } from "./projection";
import {
  previewFixture,
  sourceBinding,
  answers,
  requestId,
  expandQuestions,
} from "./fixtures.test-support";

type Cell = { get: () => string; set: (value: string) => void };
let fixture: QuizPackContentV2;
beforeAll(async () => {
  fixture = await previewFixture();
});
const jsonBytes = (value: unknown) =>
  Buffer.byteLength(JSON.stringify(value), "utf8");
function fill(
  cells: Cell[],
  target: number,
  size: () => number,
  unit: "甲" | '"',
) {
  cells.forEach((cell) => cell.set("x"));
  const gain = unit === "甲" ? 3 : 2;
  for (const cell of cells) {
    const remaining = target - size();
    if (!remaining) break;
    expect(remaining).toBeGreaterThan(0);
    const add = Math.min(remaining, 3999 * gain),
      whole = Math.floor(add / gain),
      rest = add % gain;
    cell.set(
      "x" + unit.repeat(whole) + (rest === 2 ? "é" : rest === 1 ? "x" : ""),
    );
  }
  expect(size()).toBe(target);
  const spare = cells.find((cell) => cell.get().length < 4000);
  if (!spare) throw new Error("budget fixture capacity");
  return spare;
}
function entryCells(c: QuizPackContentV2): Cell[] {
  return c.questions.flatMap((q) => [
    {
      get: () => q.prompt,
      set: (v: string) => {
        q.prompt = v;
      },
    },
    ...q.options.map((o) => ({
      get: () => o.label,
      set: (v: string) => {
        o.label = v;
      },
    })),
  ]);
}
function entry(c: QuizPackContentV2) {
  const result = preparePreviewContent(c, sourceBinding(c));
  if (!result.ok) throw new Error(result.code);
  return result;
}
function score(c: QuizPackContentV2) {
  const prepared = entry(c),
    result = scorePreview(prepared.value.prepared, answers(c), requestId);
  if (!result.ok) throw new Error(result.code);
  return result;
}
describe("complete projection envelope byte budgets", () => {
  it.each(["甲", '"'] as const)(
    "accepts exact 512KiB and rejects +1 for %j without truncating",
    (unit) => {
      const content = structuredClone(fixture);
      expandQuestions(content, 32);
      const spare = fill(
        entryCells(content),
        PREVIEW_LIMITS.entryResponseBytes,
        () => jsonBytes({ ok: true, value: entry(content).value.entry }),
        unit,
      );
      const full = entry(content);
      expect(jsonBytes({ ok: true, value: full.value.entry })).toBe(524288);
      expect(full.value.entry.questions).toHaveLength(32);
      spare.set(spare.get() + "x");
      expect(preparePreviewContent(content, sourceBinding(content))).toEqual({
        ok: false,
        code: "PREVIEW_LIMIT_EXCEEDED",
      });
    },
    15000,
  );
  it("accepts exact 256KiB reveal and rejects +1 while source and scoring remain valid", () => {
    const content = structuredClone(fixture),
      baseline = content.reportTemplates[0]!.baseline;
    baseline.strengths = Array(8).fill("x");
    baseline.tensions = Array(8).fill("x");
    const cells: Cell[] = [];
    for (const name of [
      "title",
      "summary",
      "reflection",
      "disclaimer",
    ] as const)
      cells.push({
        get: () => baseline[name],
        set: (v) => {
          baseline[name] = v;
        },
      });
    for (const name of ["strengths", "tensions"] as const)
      for (let i = 0; i < 8; i++)
        cells.push({
          get: () => baseline[name][i]!,
          set: (v) => {
            baseline[name][i] = v;
          },
        });
    for (const state of ["result", "report"] as const)
      for (const name of ["heading", "body"] as const)
        cells.push({
          get: () => content.layouts[state].props[name],
          set: (v) => {
            content.layouts[state].props[name] = v;
          },
        });
    const spare = fill(
      cells,
      PREVIEW_LIMITS.revealResponseBytes,
      () => jsonBytes(score(content)),
      "甲",
    );
    const full = score(content);
    expect(jsonBytes(full)).toBe(262144);
    expect(full.value.report.baseline.strengths).toHaveLength(8);
    expect(full.value.report.baseline.tensions).toHaveLength(8);
    spare.set(spare.get() + "x");
    const prepared = entry(content);
    expect(
      scorePreview(prepared.value.prepared, answers(content), requestId),
    ).toEqual({ ok: false, code: "PREVIEW_LIMIT_EXCEEDED" });
  }, 15000);
  it("bounds hostile ordinary input without returning or echoing its content", () => {
    const content = structuredClone(fixture);
    content.product.title = "x".repeat(2 * 1024 * 1024 + 1);
    expect(preparePreviewContent(content, sourceBinding(fixture))).toEqual({
      ok: false,
      code: "PREVIEW_LIMIT_EXCEEDED",
    });
  });
});
