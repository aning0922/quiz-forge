import { describe, expect, it } from "vitest";
import {
  consumerCompleteBindingSchema,
  consumerCompleteBindingSha256,
  persistedReportViewSchema,
  verifyPersistedReportView,
} from "./view-contracts";
import { persistedReportFixture } from "./contracts.test-support";

describe("pure browser persisted report view contract draft", () => {
  it("verifies selected display/binding SHA without pretending to verify hidden full snapshot bytes", async () => {
    const { view, receipt } = await persistedReportFixture();
    const dto = { view, receipt };
    expect(await verifyPersistedReportView(dto)).toEqual(dto);
    expect(JSON.stringify(view)).not.toMatch(
      /normalizedAnswers|rawSum|distances|contributions|sourceSnapshot/,
    );
    const changedIdentifier = {
      view,
      receipt: { ...receipt, reportSnapshotSha256: "f".repeat(64) },
    };
    expect(await verifyPersistedReportView(changedIdentifier)).toEqual(
      changedIdentifier,
    );
  });
  it("rejects changed prose/renderer/mapping bytes even when their shapes still parse", async () => {
    const { view, receipt } = await persistedReportFixture();
    for (const mutate of [
      (v: typeof view) => {
        v.display.report.baseline.summary += "合成变化";
      },
      (v: typeof view) => {
        v.renderer.entrySha256 = "a".repeat(64);
      },
      (v: typeof view) => {
        v.mapping.states.report.runtime.version = "1.0.1";
      },
    ]) {
      const changed = structuredClone(view);
      mutate(changed);
      await expect(
        verifyPersistedReportView({ view: changed, receipt }),
      ).rejects.toThrow();
    }
  });
  it("binds completion to exact session, revision, answers and progress, never a score body", async () => {
    const { receipt, view } = await persistedReportFixture();
    const binding = receipt.binding;
    for (const change of [
      { ...binding, expectedStateRevision: binding.expectedStateRevision + 1 },
      { ...binding, consumerStateAnswersSha256: "f".repeat(64) },
      { ...binding, progressSha256: "f".repeat(64) },
      { ...binding, completionKey: "00000000-0000-4000-8000-000000000099" },
    ])
      expect(await consumerCompleteBindingSha256(change)).not.toBe(
        receipt.bindingSha256,
      );
    expect(
      consumerCompleteBindingSchema.safeParse({ ...binding, score: {} })
        .success,
    ).toBe(false);
    expect(
      persistedReportViewSchema.safeParse({
        view: { ...view, rawKey: "synthetic" },
        receipt,
      }).success,
    ).toBe(false);
    expect(
      persistedReportViewSchema.safeParse({
        view,
        receipt: {
          ...receipt,
          reportId: "00000000-0000-4000-8000-000000000099",
        },
      }).success,
    ).toBe(false);
  });
});
