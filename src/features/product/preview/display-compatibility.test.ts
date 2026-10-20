import { beforeAll, expect, it } from "vitest";
import {
  displayEntryBodyV1Schema,
  resultDisplaySnapshotV1Schema,
  displayPosterExportBodyV1Schema,
} from "@/lib/assessment-contract/display-v1";
import {
  preparePreviewContent,
  scorePreview,
} from "@/features/theme/preview/projection";
import {
  previewFixture,
  sourceBinding,
  answers,
  requestId,
} from "@/features/theme/preview/fixtures.test-support";
import {
  previewEntrySchema,
  previewRevealSchema,
  previewPosterExportSchema,
  type PreviewEntry,
  type PreviewReveal,
  type PreviewPosterExport,
} from "./contracts";
let entry: PreviewEntry, reveal: PreviewReveal, poster: PreviewPosterExport;
beforeAll(async () => {
  const content = await previewFixture();
  const prepared = preparePreviewContent(content, sourceBinding(content));
  if (!prepared.ok) throw Error(prepared.code);
  const scored = scorePreview(
    prepared.value.prepared,
    answers(content, 0),
    requestId,
  );
  if (!scored.ok || scored.value.poster.kind !== "ready")
    throw Error("FIXTURE_NOT_READY");
  entry = prepared.value.entry;
  reveal = scored.value;
  poster = previewPosterExportSchema.parse({
    binding: reveal.binding,
    requestId: reveal.requestId,
    answersHash: reveal.answersHash,
    logicHash: reveal.logicHash,
    selectedResultRef: reveal.selectedResultRef,
    reportTemplateRef: reveal.reportTemplateRef,
    poster: reveal.poster,
  });
});
function body(value: object) {
  return Object.fromEntries(
    Object.entries(value).filter(([k]) => k !== "binding" && k !== "requestId"),
  );
}
it("shared display bodies preserve full deterministic output while refusing Studio identity as data", () => {
  for (const [schema, value] of [
    [displayEntryBodyV1Schema, entry],
    [resultDisplaySnapshotV1Schema, reveal],
    [displayPosterExportBodyV1Schema, poster],
  ] as const) {
    expect(schema.parse(body(value))).toEqual(body(value));
    expect(schema.safeParse(value).success).toBe(false);
    expect(
      schema.safeParse({ ...body(value), versionId: requestId }).success,
    ).toBe(false);
  }
  expect(
    resultDisplaySnapshotV1Schema.parse(body(reveal)).report.baseline,
  ).toEqual(reveal.report.baseline);
});
it("old Studio envelopes still enforce their own fixed Product beyond valid display relationships", () => {
  for (const [schema, value] of [
    [previewEntrySchema, entry],
    [previewRevealSchema, reveal],
    [previewPosterExportSchema, poster],
  ] as const) {
    expect(JSON.stringify(schema.parse(value))).toBe(JSON.stringify(value));
    expect(
      schema.safeParse({
        ...value,
        binding: { ...value.binding, productId: "another-product" },
      }).success,
    ).toBe(false);
  }
});
it("scope-free entry rejects foreign questions, duplicate frames and portrait leakage before reveal", () => {
  const base = displayEntryBodyV1Schema.parse(body(entry));
  const foreign = structuredClone(base);
  foreign.questions[0]!.productId = "another-product";
  const duplicated = structuredClone(base);
  duplicated.visualPresentation.questionFrames[1] =
    duplicated.visualPresentation.questionFrames[0]!;
  const leak = { ...base, assets: [...base.assets, reveal.result.portrait] };
  for (const invalid of [foreign, duplicated, leak])
    expect(displayEntryBodyV1Schema.safeParse(invalid).success).toBe(false);
});
it("scope-free result retains selected-report and poster consistency checks", () => {
  const base = resultDisplaySnapshotV1Schema.parse(body(reveal));
  const foreign = structuredClone(base);
  foreign.reportTemplateRef.productId = "another-product";
  const mismatch = structuredClone(base);
  if (mismatch.poster.kind !== "ready") throw Error("FIXTURE_NOT_READY");
  mismatch.poster.displayName = "另一个结果";
  for (const invalid of [foreign, mismatch])
    expect(resultDisplaySnapshotV1Schema.safeParse(invalid).success).toBe(
      false,
    );
  const exported = displayPosterExportBodyV1Schema.parse(body(poster));
  exported.poster.portrait.resourceRef.productId = "another-product";
  expect(displayPosterExportBodyV1Schema.safeParse(exported).success).toBe(
    false,
  );
});
