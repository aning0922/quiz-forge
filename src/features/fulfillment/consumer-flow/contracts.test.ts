import { describe, expect, it } from "vitest";
import { persistedReportFixture } from "@/features/report/persisted/contracts.test-support";
import { consumerCompleteBindingSha256 } from "@/features/report/persisted/view-contracts";
import { testUuid } from "@/features/product/internal-play/contracts.test-support";
import {
  consumerAnswersSha256,
  consumerProgressSha256,
  consumerSaveBindingSha256,
  type ConsumerState,
} from "@/lib/consumer-contract/v1/state";
import {
  consumerSaveResolutionSchema,
  consumerCompleteResolutionSchema,
  consumerSessionViewSchema,
  verifyConsumerSaveResolution,
  verifyConsumerCompleteResolution,
  verifyConsumerSessionView,
} from "./contracts";

async function fixture() {
  const report = await persistedReportFixture();
  const completion = report.receipt.binding;
  const binding = {
    schemaVersion: "quizforge.consumer-save.v1" as const,
    session: completion.session,
    expectedStateRevision: 0,
    consumerStateAnswersSha256: completion.consumerStateAnswersSha256,
    progressSha256: completion.progressSha256,
  };
  const lastSave = {
    schemaVersion: "quizforge.consumer-save-receipt.v1" as const,
    binding,
    bindingSha256: await consumerSaveBindingSha256(binding),
    appliedStateRevision: 1,
    savedAt: report.view.completedAt,
  };
  const state: ConsumerState = {
    schemaVersion: "quizforge.consumer-state.v1",
    session: completion.session,
    createdAt: report.view.completedAt,
    stateRevision: 1,
    answers: report.snapshot.answers,
    progress: report.snapshot.progress,
    consumerStateAnswersSha256: completion.consumerStateAnswersSha256,
    progressSha256: completion.progressSha256,
    lastSave,
  };
  const initial: ConsumerState = {
    ...state,
    stateRevision: 0,
    answers: [],
    progress: { questionId: null },
    lastSave: null,
    consumerStateAnswersSha256: await consumerAnswersSha256([]),
    progressSha256: await consumerProgressSha256({ questionId: null }),
  };
  const save = {
    schemaVersion: "quizforge.consumer-save-resolution.v1" as const,
    binding,
    bindingSha256: lastSave.bindingSha256,
  };
  const complete = {
    schemaVersion: "quizforge.consumer-complete-resolution.v1" as const,
    binding: completion,
    bindingSha256: report.receipt.bindingSha256,
  };
  return { report, state, initial, save, complete };
}

describe("consumer resolution boundaries", () => {
  it("accepts exact last application and rejects relabeling it as unresolved or superseded", async () => {
    const f = await fixture();
    const value = { ...f.save, kind: "applied-current", state: f.state };
    expect(await verifyConsumerSaveResolution(value, f.save.binding)).toEqual(
      value,
    );
    for (const kind of ["unresolved", "superseded"])
      expect(
        consumerSaveResolutionSchema.safeParse({ ...value, kind }).success,
      ).toBe(false);
    await expect(
      verifyConsumerSaveResolution(value, {
        ...f.save.binding,
        progressSha256: "f".repeat(64),
      }),
    ).rejects.toThrow("CONSUMER_RESOLUTION_MISMATCH");
  });
  it("calls an overwritten successful save superseded without claiming it never applied", async () => {
    const f = await fixture();
    const nextBinding = { ...f.save.binding, expectedStateRevision: 1 };
    const state = {
      ...f.state,
      stateRevision: 2,
      lastSave: {
        ...f.state.lastSave!,
        binding: nextBinding,
        bindingSha256: await consumerSaveBindingSha256(nextBinding),
        appliedStateRevision: 2,
      },
    };
    const value = { ...f.save, kind: "superseded", state };
    expect(await verifyConsumerSaveResolution(value, f.save.binding)).toEqual(
      value,
    );
    expect(
      consumerSaveResolutionSchema.safeParse({
        ...value,
        kind: "applied-current",
      }).success,
    ).toBe(false);
    expect(
      consumerSaveResolutionSchema.safeParse({ ...value, kind: "unresolved" })
        .success,
    ).toBe(false);
    expect(
      await verifyConsumerCompleteResolution(
        { ...f.complete, kind: "superseded", state },
        f.complete.binding,
      ),
    ).toBeDefined();
  });
  it("keeps unchanged base unresolved and rejects future/cross-session observations or invented terminal kinds", async () => {
    const f = await fixture();
    const value = { ...f.save, kind: "unresolved", state: f.initial };
    expect(await verifyConsumerSaveResolution(value, f.save.binding)).toEqual(
      value,
    );
    for (const kind of [
      "not-applied",
      "expired",
      "cancelled",
      "applied-current",
      "superseded",
    ])
      expect(
        consumerSaveResolutionSchema.safeParse({ ...value, kind }).success,
      ).toBe(false);
    expect(
      consumerSaveResolutionSchema.safeParse({
        ...value,
        binding: { ...f.save.binding, expectedStateRevision: 1 },
      }).success,
    ).toBe(false);
    const crossed = structuredClone(value);
    crossed.state.session = {
      ...crossed.state.session,
      sessionId: testUuid(90),
    };
    expect(consumerSaveResolutionSchema.safeParse(crossed).success).toBe(false);
    expect(
      consumerSaveResolutionSchema.safeParse({
        ...value,
        rawKey: "synthetic-forbidden",
      }).success,
    ).toBe(false);
  });
  it("checks outer and nested digests instead of accepting shape-valid tampering", async () => {
    const f = await fixture();
    const value = { ...f.save, kind: "applied-current", state: f.state };
    await expect(
      verifyConsumerSaveResolution(
        {
          ...value,
          bindingSha256: "f".repeat(64),
          state: {
            ...f.state,
            lastSave: { ...f.state.lastSave!, bindingSha256: "f".repeat(64) },
          },
        },
        f.save.binding,
      ),
    ).rejects.toThrow();
    const altered = structuredClone(value);
    altered.state.answers[0]!.optionId = "other-option";
    await expect(
      verifyConsumerSaveResolution(altered, f.save.binding),
    ).rejects.toThrow("CONSUMER_STATE_HASH_MISMATCH");
  });
  it("separates original completion success, another key and a conflicting use of the same key", async () => {
    const f = await fixture();
    const applied = {
      ...f.complete,
      kind: "applied",
      report: f.report.receipt,
    };
    expect(
      await verifyConsumerCompleteResolution(applied, f.complete.binding),
    ).toEqual(applied);
    for (const kind of ["completed-other", "operation-conflict"])
      expect(
        consumerCompleteResolutionSchema.safeParse({ ...applied, kind })
          .success,
      ).toBe(false);
    const other = { ...f.complete.binding, completionKey: testUuid(91) };
    const otherValue = {
      ...applied,
      kind: "completed-other",
      binding: other,
      bindingSha256: await consumerCompleteBindingSha256(other),
    };
    expect(await verifyConsumerCompleteResolution(otherValue, other)).toEqual(
      otherValue,
    );
    expect(
      consumerCompleteResolutionSchema.safeParse({
        ...otherValue,
        kind: "applied",
      }).success,
    ).toBe(false);
    const collision = { ...f.complete.binding, progressSha256: "f".repeat(64) };
    const conflict = {
      ...applied,
      kind: "operation-conflict",
      binding: collision,
      bindingSha256: await consumerCompleteBindingSha256(collision),
    };
    expect(await verifyConsumerCompleteResolution(conflict, collision)).toEqual(
      conflict,
    );
    await expect(
      verifyConsumerCompleteResolution(otherValue, f.complete.binding),
    ).rejects.toThrow("CONSUMER_RESOLUTION_MISMATCH");
  });
  it("distinguishes same-revision immutable hash conflict from an unresolved exact completion", async () => {
    const f = await fixture();
    const value = { ...f.complete, kind: "unresolved", state: f.state };
    expect(
      await verifyConsumerCompleteResolution(value, f.complete.binding),
    ).toEqual(value);
    expect(
      consumerCompleteResolutionSchema.safeParse({
        ...value,
        kind: "state-conflict",
      }).success,
    ).toBe(false);
    const binding = { ...f.complete.binding, progressSha256: "f".repeat(64) };
    const conflict = {
      ...value,
      kind: "state-conflict",
      binding,
      bindingSha256: await consumerCompleteBindingSha256(binding),
    };
    expect(await verifyConsumerCompleteResolution(conflict, binding)).toEqual(
      conflict,
    );
    expect(
      consumerCompleteResolutionSchema.safeParse({
        ...conflict,
        kind: "unresolved",
      }).success,
    ).toBe(false);
    expect(
      consumerCompleteResolutionSchema.safeParse({ ...value, state: f.initial })
        .success,
    ).toBe(false);
  });
  it("returns completion authority without claiming the old save produced it", async () => {
    const f = await fixture();
    const value = { ...f.save, kind: "completed", report: f.report.receipt };
    expect(await verifyConsumerSaveResolution(value, f.save.binding)).toEqual(
      value,
    );
    expect(
      consumerSaveResolutionSchema.safeParse({ ...value, state: f.state })
        .success,
    ).toBe(false);
    const cross = structuredClone(value);
    cross.report.binding.session = {
      ...cross.report.binding.session,
      keyId: testUuid(92),
    };
    expect(consumerSaveResolutionSchema.safeParse(cross).success).toBe(false);
  });
  it("permits an expired Key's completed report, rejects expired grants and does not grant edit rights", async () => {
    const f = await fixture();
    const value = {
      schemaVersion: "quizforge.consumer-session-view.v1",
      grant: {
        grantId: testUuid(93),
        session: f.state.session,
        issuedAt: "2026-10-18T00:00:00.000Z",
        expiresAt: "2026-10-18T08:00:00.000Z",
        csrf: "A".repeat(43),
      },
      observedAt: "2026-10-18T02:00:00.000Z",
      keyExpiresAt: "2026-10-18T01:00:00.000Z",
      outcome: { kind: "completed", report: f.report.receipt },
    };
    expect(await verifyConsumerSessionView(value)).toEqual(value);
    expect(
      consumerSessionViewSchema.safeParse({
        ...value,
        outcome: { kind: "editable", state: f.state },
      }).success,
    ).toBe(false);
    expect(
      await verifyConsumerSessionView({
        ...value,
        outcome: { kind: "expired", state: f.state },
      }),
    ).toBeDefined();
    expect(
      consumerSessionViewSchema.safeParse({
        ...value,
        observedAt: value.grant.expiresAt,
      }).success,
    ).toBe(false);
    expect(
      consumerSessionViewSchema.safeParse({
        ...value,
        grant: { ...value.grant, csrf: "A".repeat(42) + "B" },
      }).success,
    ).toBe(false);
  });
});
