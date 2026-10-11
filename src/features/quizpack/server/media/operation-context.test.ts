import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MediaOperationContext } from "./contracts";
import {
  beginMediaImage,
  createMediaOperationContext,
  disposeMediaOperationContext,
  readMediaOperationState,
  requestMediaOperationStop,
} from "./operation-context";

describe("trusted media operation context", () => {
  let now: number;
  let contexts: MediaOperationContext[];
  beforeEach(() => {
    now = 100;
    contexts = [];
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    vi.spyOn(performance, "now").mockImplementation(() => now);
  });
  afterEach(() => {
    for (const context of contexts) {
      try {
        disposeMediaOperationContext(context);
      } catch {
        /* Already disposed. */
      }
    }
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  function create(deadline = 60_100, signal = new AbortController().signal) {
    const context = createMediaOperationContext({
      signal,
      deadlineMonotonicMs: deadline,
    });
    contexts.push(context);
    return context;
  }
  it("rejects forged, copied and disposed runtime identities", () => {
    const context = create();
    expect(Object.isFrozen(context)).toBe(true);
    expect(() => readMediaOperationState({ ...context })).toThrow(
      "INVALID_MEDIA_OPERATION_CONTEXT",
    );
    expect(() =>
      readMediaOperationState({} as MediaOperationContext),
    ).toThrow();
    disposeMediaOperationContext(context);
    expect(() => beginMediaImage(context)).toThrow();
  });
  it.each([NaN, Infinity, -1])("rejects invalid deadlines: %s", (deadline) => {
    expect(() => create(deadline)).toThrow("INVALID_MEDIA_OPERATION_CONTEXT");
  });
  it("observes an already expired business deadline using its original trigger", () => {
    now = 7000;
    const context = create(1000);
    expect(readMediaOperationState(context)).toMatchObject({
      phase: "stopping",
      stop: {
        reason: "BUSINESS_DEADLINE_EXCEEDED",
        stopStartedMonotonicMs: 1000,
        cleanupDeadlineMonotonicMs: 6000,
      },
    });
    expect(context.signal.aborted).toBe(true);
  });
  it("late timer delivery cannot restart the five-second cleanup allowance", () => {
    const context = create(1100);
    now = 8000;
    vi.advanceTimersByTime(1000);
    expect(readMediaOperationState(context)).toMatchObject({
      phase: "stopping",
      stop: { stopStartedMonotonicMs: 1100, cleanupDeadlineMonotonicMs: 6100 },
    });
  });
  it("abort observed after an elapsed image deadline selects the earlier trigger", () => {
    const external = new AbortController();
    const context = create(60_100, external.signal);
    const image = beginMediaImage(context)!;
    now = 8000;
    external.abort();
    expect(image.readState()).toMatchObject({
      phase: "stopping",
      stop: {
        reason: "IMAGE_DEADLINE_EXCEEDED",
        stopStartedMonotonicMs: 5100,
        cleanupDeadlineMonotonicMs: 10_100,
      },
    });
    image.finish();
    expect(beginMediaImage(context)).toBeNull();
  });
  it("abort before any deadline fixes actual observation time", () => {
    const external = new AbortController();
    const context = create(60_100, external.signal);
    now = 200;
    external.abort();
    expect(readMediaOperationState(context)).toMatchObject({
      phase: "stopping",
      stop: {
        reason: "CANCELLED",
        stopStartedMonotonicMs: 200,
        cleanupDeadlineMonotonicMs: 5200,
      },
    });
  });
  it("repeated stop calls only tighten the same deadline", () => {
    const context = create();
    now = 200;
    const first = requestMediaOperationStop(context, "STORAGE_LOCK_LOST");
    now = 4000;
    expect(
      requestMediaOperationStop(context, "RUNTIME_FAILED", 20_000),
    ).toEqual(first);
    expect(requestMediaOperationStop(context, "STOP_REQUESTED", 5000)).toEqual({
      ...first,
      cleanupDeadlineMonotonicMs: 5000,
    });
    expect(
      requestMediaOperationStop(context, "STOP_REQUESTED", 9000)
        .cleanupDeadlineMonotonicMs,
    ).toBe(5000);
    expect(Object.isFrozen(first)).toBe(true);
  });
  it("single image is serial and each successful scope keeps the original business budget", () => {
    const context = create(7100);
    const first = beginMediaImage(context)!;
    expect(beginMediaImage(context)).toBeNull();
    now = 2000;
    first.finish();
    const second = beginMediaImage(context)!;
    expect(second.deadlineMonotonicMs).toBe(7000);
    now = 4000;
    second.finish();
    expect(beginMediaImage(context)?.deadlineMonotonicMs).toBe(7100);
  });
  it("dispose of an active image aborts it and keeps authoritative cleanup state", () => {
    const context = create();
    const image = beginMediaImage(context)!;
    const observed: unknown[] = [];
    context.signal.addEventListener("abort", () =>
      observed.push(image.readState()),
    );
    now = 300;
    disposeMediaOperationContext(context);
    expect(observed).toEqual([expect.objectContaining({ phase: "stopping" })]);
    expect(context.signal.aborted).toBe(true);
    now = 9000;
    expect(image.readState()).toMatchObject({
      phase: "stopping",
      stop: {
        reason: "STOP_REQUESTED",
        stopStartedMonotonicMs: 300,
        cleanupDeadlineMonotonicMs: 5300,
      },
    });
    image.finish();
    expect(() => readMediaOperationState(context)).toThrow();
    expect(() => beginMediaImage(context)).toThrow();
  });
  it("dispose after a late image deadline keeps the expired cleanup budget", () => {
    const context = create();
    const image = beginMediaImage(context)!;
    now = 12_000;
    disposeMediaOperationContext(context);
    expect(image.readState()).toMatchObject({
      phase: "stopping",
      stop: {
        reason: "IMAGE_DEADLINE_EXCEEDED",
        cleanupDeadlineMonotonicMs: 10_100,
      },
    });
  });
  it("invalid explicit stop cannot corrupt the active context", () => {
    const context = create();
    expect(() =>
      requestMediaOperationStop(context, "STOP_REQUESTED", Infinity),
    ).toThrow();
    expect(readMediaOperationState(context).phase).toBe("active");
  });
});
