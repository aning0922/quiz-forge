import { beforeAll, expect, it } from "vitest";
import { persistedReportFixtureV2 } from "./contracts-v2.test-support";
import {
  verifyPersistedReportDetailV2,
  verifyPersistedReportSnapshotV2,
} from "./snapshot-contract-v2";
import {
  consumerStateV2Schema,
  consumerSaveBindingV2Schema,
  consumerSaveBindingSha256V2,
  consumerMatchingSha256V2,
  consumerCompleteBindingSha256V2,
} from "@/lib/consumer-contract/v2/state";
import {
  observeConsumerCompletionV2,
  observeConsumerSaveV2,
} from "@/features/fulfillment/consumer-flow/resolution-v2";
import { testMoment } from "@/features/product/internal-play/contracts.test-support";
let fixture: Awaited<ReturnType<typeof persistedReportFixtureV2>>;
beforeAll(async () => {
  fixture = await persistedReportFixtureV2();
});
it("verifies a complete structured report from actual synthetic answers with all six volumes and the v2 fixed play", async () => {
  const { snapshot, receipt } = fixture;
  expect(snapshot.view.display.body.volumes.map((v) => v.id)).toEqual([
    "encounter",
    "dimensions",
    "patterns",
    "counterevidence",
    "literature",
    "closure",
  ]);
  expect(snapshot.view.display.body.answers).toHaveLength(24);
  await expect(
    verifyPersistedReportDetailV2({ snapshot, receipt }),
  ).resolves.toEqual({ snapshot, receipt });
  expect(snapshot.binding.consumerStateAnswersSha256).not.toBe(
    snapshot.score.score.answersHash,
  );
});
it("rejects a preference substitution even when its direct context digest has been updated", async () => {
  const changed = structuredClone(fixture.snapshot);
  changed.matchingContext.preference = "female";
  changed.score.score.matchingContext = changed.matchingContext;
  const sha = await consumerMatchingSha256V2(changed.matchingContext);
  changed.binding.matchingContextSha256 = sha;
  changed.score.score.matchingContextSha256 = sha;
  changed.view.display.matchingContextSha256 = sha;
  changed.view.display.body.provenance.matchingContextSha256 = sha;
  changed.view.completionBindingSha256 = await consumerCompleteBindingSha256V2(
    changed.binding,
  );
  await expect(verifyPersistedReportSnapshotV2(changed)).rejects.toThrow(
    "CONSUMER_REPORT_SNAPSHOT_MISMATCH",
  );
});
it("rejects changed prose without a matching frozen body digest", async () => {
  const changed = structuredClone(fixture.snapshot);
  changed.view.display.body.volumes[0]!.paragraphs[0]!.text = "已被替换的文字";
  await expect(
    verifyPersistedReportDetailV2({
      snapshot: changed,
      receipt: fixture.receipt,
    }),
  ).rejects.toThrow();
});
async function state() {
  const s = fixture.snapshot,
    b = {
      ...s.binding,
      schemaVersion: "quizforge.consumer-save.v2" as const,
      expectedStateRevision: 0,
    };
  const binding = consumerSaveBindingV2Schema.parse({
    schemaVersion: b.schemaVersion,
    session: b.session,
    expectedStateRevision: b.expectedStateRevision,
    consumerStateAnswersSha256: b.consumerStateAnswersSha256,
    progressSha256: b.progressSha256,
    matchingContextSha256: b.matchingContextSha256,
  });
  const bindingSha256 = await consumerSaveBindingSha256V2(binding);
  return consumerStateV2Schema.parse({
    schemaVersion: "quizforge.consumer-state.v2",
    session: binding.session,
    createdAt: testMoment,
    stateRevision: 1,
    answers: s.answers,
    progress: s.progress,
    consumerStateAnswersSha256: binding.consumerStateAnswersSha256,
    progressSha256: binding.progressSha256,
    matchingContext: s.matchingContext,
    matchingContextSha256: binding.matchingContextSha256,
    lastSave: {
      schemaVersion: "quizforge.consumer-save-receipt.v2",
      binding,
      bindingSha256,
      appliedStateRevision: 1,
      savedAt: testMoment,
    },
  });
}
it("observes a context-only CAS save and identifies a same-revision completion context conflict", async () => {
  const s = await state();
  expect((await observeConsumerSaveV2(s.lastSave!.binding, s, null)).kind).toBe(
    "applied-current",
  );
  const binding = {
    ...fixture.snapshot.binding,
    matchingContextSha256: await consumerMatchingSha256V2({
      ...s.matchingContext!,
      preference: "female",
    }),
  };
  expect((await observeConsumerCompletionV2(binding, s, null)).kind).toBe(
    "state-conflict",
  );
});
it("treats the original completion key with a different context as operation-conflict", async () => {
  const s = await state(),
    binding = {
      ...fixture.snapshot.binding,
      matchingContextSha256: await consumerMatchingSha256V2({
        ...s.matchingContext!,
        preference: "female",
      }),
    };
  expect(
    (await observeConsumerCompletionV2(binding, s, fixture.receipt)).kind,
  ).toBe("operation-conflict");
});
it("rejects mixed request protocols using the fixed-play-derived state branch", async () => {
  const { observeCurrentSave, observeCurrentCompletion } =
    await import("@/features/fulfillment/consumer-flow/current-contracts");
  const s = await state(),
    b = s.lastSave!.binding;
  await expect(
    observeCurrentSave(
      {
        schemaVersion: "quizforge.consumer-save.v1",
        session: b.session,
        expectedStateRevision: b.expectedStateRevision,
        consumerStateAnswersSha256: b.consumerStateAnswersSha256,
        progressSha256: b.progressSha256,
      },
      s,
      null,
    ),
  ).rejects.toThrow("INVALID_REQUEST");
  const c = fixture.snapshot.binding;
  await expect(
    observeCurrentCompletion(
      {
        schemaVersion: "quizforge.consumer-complete.v1",
        session: c.session,
        expectedStateRevision: c.expectedStateRevision,
        consumerStateAnswersSha256: c.consumerStateAnswersSha256,
        progressSha256: c.progressSha256,
        completionKey: c.completionKey,
      },
      s,
      null,
    ),
  ).rejects.toThrow("INVALID_REQUEST");
});
