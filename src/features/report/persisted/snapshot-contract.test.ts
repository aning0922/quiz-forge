import { describe, expect, it } from "vitest";
import { consumerAnswersSha256 } from "@/lib/consumer-contract/v1/state";
import { persistedReportFixture } from "./contracts.test-support";
import {
  persistedReportSnapshotSchema,
  verifyPersistedReportDetail,
  verifyPersistedReportSnapshot,
} from "./snapshot-contract";

describe("server-only persisted deterministic report contract draft", () => {
  it("retains full actual synthetic score/answers/display and independent state versus engine hashes", async () => {
    const { snapshot, receipt } = await persistedReportFixture();
    expect(await verifyPersistedReportDetail({ snapshot, receipt })).toEqual({
      snapshot,
      receipt,
    });
    expect(await consumerAnswersSha256(snapshot.answers)).toBe(
      snapshot.binding.consumerStateAnswersSha256,
    );
    expect(snapshot.binding.consumerStateAnswersSha256).not.toBe(
      snapshot.score.score.answersHash,
    );
    expect(snapshot.view.display.answersHash).toBe(
      snapshot.score.score.answersHash,
    );
  });
  it("rejects mismatched selected result, dimensions, source, engine and play identities", async () => {
    const { snapshot } = await persistedReportFixture();
    for (const mutate of [
      (v: typeof snapshot) => {
        v.score.score.decision.selectedResultRef.id = "other-result";
      },
      (v: typeof snapshot) => {
        v.score.score.dimensions[0]!.dimensionRef.id = "other-dimension";
      },
      (v: typeof snapshot) => {
        v.score.canonicalContentSha256 = "f".repeat(64);
      },
      (v: typeof snapshot) => {
        v.score.score.engine.id = "dimensions";
      },
      (v: typeof snapshot) => {
        v.binding.session.playSnapshotSha256 = "f".repeat(64);
      },
      (v: typeof snapshot) => {
        v.view.display.dimensions[0]!.normalizedText = "99.9";
      },
      (v: typeof snapshot) => {
        v.view.display.result.portrait.sha256 = "f".repeat(64);
      },
    ]) {
      const changed = structuredClone(snapshot);
      mutate(changed);
      expect(persistedReportSnapshotSchema.safeParse(changed).success).toBe(
        false,
      );
    }
  });
  it("rejects tampered state/complete/full report SHA and never silently accepts duplicate engine answers", async () => {
    const { snapshot, receipt } = await persistedReportFixture();
    const hash = structuredClone(snapshot);
    hash.binding.progressSha256 = "f".repeat(64);
    await expect(verifyPersistedReportSnapshot(hash)).rejects.toThrow(
      "CONSUMER_REPORT_SNAPSHOT_MISMATCH",
    );
    const progress = structuredClone(snapshot);
    progress.progress.questionId = progress.answers[0]!.questionId;
    await expect(verifyPersistedReportSnapshot(progress)).rejects.toThrow(
      "CONSUMER_REPORT_SNAPSHOT_MISMATCH",
    );
    const duplicate = structuredClone(snapshot);
    duplicate.score.score.normalizedAnswers.push(
      duplicate.score.score.normalizedAnswers[0]!,
    );
    expect(() =>
      persistedReportSnapshotSchema.safeParse(duplicate),
    ).not.toThrow();
    expect(persistedReportSnapshotSchema.safeParse(duplicate).success).toBe(
      false,
    );
    await expect(
      verifyPersistedReportDetail({
        snapshot,
        receipt: { ...receipt, reportSnapshotSha256: "f".repeat(64) },
      }),
    ).rejects.toThrow("CONSUMER_REPORT_SNAPSHOT_MISMATCH");
    await expect(
      verifyPersistedReportDetail({
        snapshot,
        receipt: { ...receipt, displaySha256: "f".repeat(64) },
      }),
    ).rejects.toThrow("CONSUMER_REPORT_SNAPSHOT_MISMATCH");
  });
});
