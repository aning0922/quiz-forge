import { describe, expect, it } from "vitest";
import { digestV2 } from "@/features/quiz/scoring/v2/boundary";
import { consumerAnswersSha256, consumerProgressSha256 } from "../v1/state";
import {
  consumerMatchingTextV2,
  consumerMatchingSha256V2,
  consumerSaveBindingSha256V2,
  verifyConsumerStateV2,
  verifyConsumerSaveInputV2,
  consumerSaveInputV2Schema,
} from "./state";
const session = {
  productId: "synthetic-v2",
  playVersionId: "11111111-1111-4111-8111-111111111111",
  playSnapshotSha256: "a".repeat(64),
  keyId: "22222222-2222-4222-8222-222222222222",
  sessionId: "33333333-3333-4333-8333-333333333333",
};
const context = (preference: "male" | "female" | "any") => ({
  schemaVersion: "quiz-matching-context.v1",
  preference,
  policyRef: { id: "pool", productId: "synthetic-v2", version: "1.0.0" },
});
describe("consumer v2 preference facts", () => {
  it("distinguishes null from any and matches the D1 UTF-8 hash domain exactly", async () => {
    expect(consumerMatchingTextV2(null)).toBe("null");
    expect(await consumerMatchingSha256V2(null)).toBe(
      digestV2("quiz-matching-context.v1", null),
    );
    expect(await consumerMatchingSha256V2(context("any"))).toBe(
      digestV2("quiz-matching-context.v1", context("any")),
    );
    expect(await consumerMatchingSha256V2(null)).not.toBe(
      await consumerMatchingSha256V2(context("any")),
    );
  });
  it("permits null only in the pristine initial state and requires explicit save preferences", async () => {
    const progress = { questionId: null };
    const initial = {
      schemaVersion: "quizforge.consumer-state.v2",
      session,
      createdAt: "2026-10-26T00:00:00.000Z",
      stateRevision: 0,
      answers: [],
      progress,
      consumerStateAnswersSha256: await consumerAnswersSha256([]),
      progressSha256: await consumerProgressSha256(progress),
      matchingContext: null,
      matchingContextSha256: await consumerMatchingSha256V2(null),
      lastSave: null,
    };
    expect((await verifyConsumerStateV2(initial)).matchingContext).toBeNull();
    await expect(
      verifyConsumerStateV2({ ...initial, matchingContext: context("any") }),
    ).rejects.toThrow();
    const binding = {
      schemaVersion: "quizforge.consumer-save.v2",
      session,
      expectedStateRevision: 0,
      consumerStateAnswersSha256: initial.consumerStateAnswersSha256,
      progressSha256: initial.progressSha256,
      matchingContextSha256: await consumerMatchingSha256V2(context("any")),
    };
    const input = {
      binding,
      answers: [],
      progress,
      matchingContext: context("any"),
    };
    expect(
      (await verifyConsumerSaveInputV2(input)).matchingContext.preference,
    ).toBe("any");
    expect(
      consumerSaveInputV2Schema.safeParse({ ...input, matchingContext: null })
        .success,
    ).toBe(false);
    const lastSave = {
      schemaVersion: "quizforge.consumer-save-receipt.v2",
      binding,
      bindingSha256: await consumerSaveBindingSha256V2(binding),
      appliedStateRevision: 1,
      savedAt: "2026-10-26T00:00:01.000Z",
    };
    expect(
      (
        await verifyConsumerStateV2({
          ...initial,
          stateRevision: 1,
          matchingContext: input.matchingContext,
          matchingContextSha256: binding.matchingContextSha256,
          lastSave,
        })
      ).stateRevision,
    ).toBe(1);
    await expect(
      verifyConsumerStateV2({ ...initial, stateRevision: 1, lastSave }),
    ).rejects.toThrow();
    await expect(
      verifyConsumerSaveInputV2({
        ...input,
        matchingContext: context("female"),
      }),
    ).rejects.toThrow("CONSUMER_STATE_HASH_MISMATCH");
  });
});
