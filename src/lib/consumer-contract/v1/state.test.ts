import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { canonicalConsumerJson } from "./canonical";
import { consumerCanonicalText, consumerTextSha256 } from "./integrity";
import { CONSUMER_LIMITS_V1 as L } from "./limits";
import { consumerIdSchema, consumerSessionRefSchema } from "./primitives";
import {
  consumerAnswersForDisplay,
  consumerAnswersSchema,
  consumerAnswersSha256,
  consumerAnswersText,
  consumerProgressSha256,
  consumerProgressText,
  consumerSaveBindingSha256,
  consumerSaveInputSchema,
  consumerSaveReceiptSchema,
  consumerStateSchema,
  verifyConsumerSaveInput,
  verifyConsumerState,
} from "./state";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const session = {
  productId: "synthetic-consumer",
  playVersionId: uuid(1),
  playSnapshotSha256: "a".repeat(64),
  keyId: uuid(2),
  sessionId: uuid(3),
};
const at = "2026-10-18T00:00:00.000Z";
const answers = [{ questionId: "question-one", optionId: "choice-a" }];
async function savedState() {
  const progress = { questionId: "question-one" };
  const binding = {
    schemaVersion: "quizforge.consumer-save.v1" as const,
    session,
    expectedStateRevision: 0,
    consumerStateAnswersSha256: await consumerAnswersSha256(answers),
    progressSha256: await consumerProgressSha256(progress),
  };
  const lastSave = {
    schemaVersion: "quizforge.consumer-save-receipt.v1" as const,
    binding,
    bindingSha256: await consumerSaveBindingSha256(binding),
    appliedStateRevision: 1,
    savedAt: at,
  };
  return {
    session,
    createdAt: at,
    stateRevision: 1,
    answers,
    progress,
    consumerStateAnswersSha256: binding.consumerStateAnswersSha256,
    progressSha256: binding.progressSha256,
    lastSave,
  };
}

describe("consumer v1 canonical boundary", () => {
  it("accounts UTF8 bytes, including punctuation, without lossy replacement", () => {
    const text = '{"b":"字"}';
    const bytes = new TextEncoder().encode(text).byteLength;
    expect(
      canonicalConsumerJson({ b: "字" }, { maxBytes: bytes, maxDepth: 2 }),
    ).toBe(text);
    expect(() =>
      canonicalConsumerJson({ b: "字" }, { maxBytes: bytes - 1, maxDepth: 2 }),
    ).toThrow();
  });
  it("rejects accessors without calling them, hidden values, cycles and exotic prototypes", () => {
    let called = false;
    const getter = Object.defineProperty({}, "value", {
      enumerable: true,
      get() {
        called = true;
        return 1;
      },
    });
    const hidden = Object.defineProperty({}, "value", { value: 1 });
    const cycle: { self?: unknown } = {};
    cycle.self = cycle;
    for (const value of [
      getter,
      hidden,
      cycle,
      new Date(),
      { value: undefined },
      [1, , 3],
    ])
      expect(() => consumerCanonicalText(value, 4096)).toThrow();
    expect(called).toBe(false);
  });
  it("bounds nesting and rejects forbidden own keys and trailing control characters", () => {
    expect(() =>
      canonicalConsumerJson({ a: { b: 1 } }, { maxBytes: 100, maxDepth: 1 }),
    ).toThrow();
    expect(() =>
      consumerCanonicalText(JSON.parse('{"__proto__":{}}'), 4096),
    ).toThrow();
    expect(consumerIdSchema.safeParse("valid-id\n").success).toBe(false);
    expect(
      consumerSessionRefSchema.safeParse({ ...session, raw: "not-allowed" })
        .success,
    ).toBe(false);
  });
  it("uses the same SHA bytes as Node and rejects unbounded text before digesting", async () => {
    const text = consumerProgressText({ questionId: null });
    expect(await consumerTextSha256(text)).toBe(
      createHash("sha256").update(text, "utf8").digest("hex"),
    );
    await expect(
      consumerTextSha256("a".repeat(2 * 1024 * 1024 + 1)),
    ).rejects.toThrow("CONSUMER_FACT_LIMIT_EXCEEDED");
  });
});

describe("consumer v1 state and revision-slot facts", () => {
  it("normalizes ASCII question order without mutating input and refuses duplicate winners", () => {
    const input = [
      { questionId: "q-2", optionId: "b" },
      { questionId: "q-10", optionId: "a" },
    ];
    expect(consumerAnswersSchema.parse(input).map((a) => a.questionId)).toEqual(
      ["q-10", "q-2"],
    );
    expect(input[0]!.questionId).toBe("q-2");
    expect(
      consumerAnswersSchema.safeParse([
        ...answers,
        { ...answers[0]!, optionId: "other" },
      ]).success,
    ).toBe(false);
    expect(
      consumerAnswersSchema.safeParse([{ ...answers[0], score: 100 }]).success,
    ).toBe(false);
    expect(
      consumerAnswersSchema.safeParse(
        Array.from({ length: 101 }, (_, n) => ({
          questionId: `q-${n}`,
          optionId: "a",
        })),
      ).success,
    ).toBe(false);
  });
  it("keeps versioned state facts distinct and uses safe own-key display lookup", async () => {
    expect(consumerAnswersText([])).toContain(
      "quizforge.consumer-state-answers.v1",
    );
    expect(await consumerAnswersSha256([])).not.toBe(
      await consumerProgressSha256({ questionId: null }),
    );
    const empty = consumerAnswersForDisplay([]);
    expect(empty.constructor).toBeUndefined();
    const mapped = consumerAnswersForDisplay([
      { questionId: "constructor", optionId: "choice-a" },
    ]);
    expect(Object.getPrototypeOf(mapped)).toBeNull();
    expect(Object.hasOwn(mapped, "constructor")).toBe(true);
    expect(mapped.constructor).toBe("choice-a");
    expect(Object.isFrozen(mapped)).toBe(true);
  });
  it("verifies a complete initial state but does not accept a forged empty-state digest", async () => {
    const initial = {
      session,
      createdAt: at,
      stateRevision: 0,
      answers: [],
      progress: { questionId: null },
      consumerStateAnswersSha256: await consumerAnswersSha256([]),
      progressSha256: await consumerProgressSha256({ questionId: null }),
      lastSave: null,
    };
    await expect(verifyConsumerState(initial)).resolves.toEqual(initial);
    await expect(
      verifyConsumerState({
        ...initial,
        consumerStateAnswersSha256: "b".repeat(64),
      }),
    ).rejects.toThrow("CONSUMER_STATE_HASH_MISMATCH");
    expect(consumerStateSchema.safeParse({ ...initial, answers }).success).toBe(
      false,
    );
  });
  it("requires candidate state hashes rather than trusting a caller-provided pair", async () => {
    const state = await savedState();
    const input = {
      binding: state.lastSave.binding,
      answers,
      progress: state.progress,
    };
    await expect(verifyConsumerSaveInput(input)).resolves.toEqual(input);
    await expect(
      verifyConsumerSaveInput({ ...input, progress: { questionId: null } }),
    ).rejects.toThrow("CONSUMER_STATE_HASH_MISMATCH");
    expect(
      consumerSaveInputSchema.safeParse({ ...input, requestedScore: 90 })
        .success,
    ).toBe(false);
  });
  it("binds last receipt to exact session, state revision, candidate and digest", async () => {
    const state = await savedState();
    await expect(verifyConsumerState(state)).resolves.toEqual(state);
    for (const change of [
      { ...state, lastSave: null },
      { ...state, stateRevision: 2 },
      { ...state, session: { ...session, sessionId: uuid(9) } },
      { ...state, progressSha256: "b".repeat(64) },
    ])
      expect(consumerStateSchema.safeParse(change).success).toBe(false);
    await expect(
      verifyConsumerState({
        ...state,
        lastSave: { ...state.lastSave, bindingSha256: "b".repeat(64) },
      }),
    ).rejects.toThrow("CONSUMER_STATE_HASH_MISMATCH");
  });
  it("can return to the cover while retaining answers, without inventing a no-op revision", async () => {
    const state = await savedState();
    const progress = { questionId: null };
    const binding = {
      ...state.lastSave.binding,
      expectedStateRevision: 1,
      progressSha256: await consumerProgressSha256(progress),
    };
    const next = {
      ...state,
      stateRevision: 2,
      progress,
      progressSha256: binding.progressSha256,
      lastSave: {
        ...state.lastSave,
        binding,
        bindingSha256: await consumerSaveBindingSha256(binding),
        appliedStateRevision: 2,
      },
    };
    await expect(verifyConsumerState(next)).resolves.toEqual(next);
    expect(
      consumerSaveReceiptSchema.safeParse({
        ...next.lastSave,
        appliedStateRevision: 1,
      }).success,
    ).toBe(false);
  });
  it("does not allow a receipt to wrap the database revision ceiling", async () => {
    const state = await savedState();
    expect(
      consumerSaveReceiptSchema.safeParse({
        ...state.lastSave,
        binding: {
          ...state.lastSave.binding,
          expectedStateRevision: L.maximumStateRevision,
        },
        appliedStateRevision: 0,
      }).success,
    ).toBe(false);
  });
});
