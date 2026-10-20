import { performance } from "node:perf_hooks";
import { afterEach, expect, it, vi } from "vitest";
import { createStudioRequestBudget } from "./request-budget";
import { readStudioJson } from "./json";
import { errorResponse, StudioError } from "./errors";

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

it("keeps the handler's earlier absolute deadline across later phases", async () => {
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockReturnValue(12_000);
  const source = new AbortController();
  const request = createStudioRequestBudget(source.signal, 1000);
  try {
    expect(request.budget.deadlineMonotonicMs).toBe(16_000);
    request.checkpoint();
    await vi.advanceTimersByTimeAsync(3999);
    expect(request.budget.signal.aborted).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(request.budget.signal.aborted).toBe(true);
    expect(() => request.checkpoint()).toThrow("STUDIO_UNAVAILABLE");
  } finally {
    request.dispose();
  }
});

it("propagates an already aborted request and later cancellation", () => {
  for (const already of [true, false]) {
    const source = new AbortController();
    if (already) source.abort();
    const request = createStudioRequestBudget(source.signal);
    try {
      if (!already) source.abort();
      expect(request.budget.signal.aborted).toBe(true);
      expect(() => request.checkpoint()).toThrow("STUDIO_UNAVAILABLE");
    } finally {
      request.dispose();
    }
  }
});

it("checks monotonic expiration before a delayed timer receives CPU time", () => {
  const clock = vi.spyOn(performance, "now").mockReturnValue(1000);
  const request = createStudioRequestBudget(new AbortController().signal);
  try {
    clock.mockReturnValue(16_000);
    expect(() => request.checkpoint()).toThrow("STUDIO_UNAVAILABLE");
    expect(request.budget.signal.aborted).toBe(true);
  } finally {
    request.dispose();
  }
});

it("rejects nonfinite, negative and future handler start values", () => {
  vi.spyOn(performance, "now").mockReturnValue(1000);
  for (const start of [NaN, Infinity, -Infinity, -1, 1001])
    expect(() =>
      createStudioRequestBudget(new AbortController().signal, start),
    ).toThrow("INVALID_REQUEST");
});

function pendingBody(cancel: () => void | Promise<void>) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode("{}"));
    },
    cancel,
  });
  const request = new Request("http://127.0.0.1:3100", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    duplex: "half",
  } as RequestInit);
  return { request, body };
}

it("shortens the body's five second budget to the remaining handler budget", async () => {
  vi.useFakeTimers();
  vi.spyOn(performance, "now").mockReturnValue(1000);
  const cancel = vi.fn();
  const { request, body } = pendingBody(cancel);
  const rejected = expect(
    readStudioJson(request, {
      signal: new AbortController().signal,
      deadlineMonotonicMs: 1020,
    }),
  ).rejects.toThrow("INVALID_REQUEST");
  await vi.advanceTimersByTimeAsync(20);
  await rejected;
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(body.locked).toBe(false);
});

it("cancels a pending body on handler abort without waiting on untrusted cancel", async () => {
  const source = new AbortController();
  const cancel = vi.fn(() => new Promise<void>(() => {}));
  const { request, body } = pendingBody(cancel);
  const rejected = expect(
    readStudioJson(request, {
      signal: source.signal,
      deadlineMonotonicMs: performance.now() + 1000,
    }),
  ).rejects.toThrow("INVALID_REQUEST");
  source.abort();
  await rejected;
  expect(cancel).toHaveBeenCalledTimes(1);
  expect(body.locked).toBe(false);
});

it("exposes only a finite draft conflict revision and never internal source details", async () => {
  expect(
    await errorResponse(
      new StudioError("DRAFT_SOURCE_CHANGED", 2),
      "id",
    ).json(),
  ).toEqual({
    code: "DRAFT_SOURCE_CHANGED",
    requestId: "id",
    currentRevision: 2,
  });
  for (const revision of [0, -1, 1.1, NaN, 2147483648])
    expect(
      await errorResponse(
        new StudioError("DRAFT_SOURCE_CHANGED", revision),
        "id",
      ).json(),
    ).toEqual({ code: "DRAFT_SOURCE_CHANGED", requestId: "id" });
  for (const [code, status] of [
    ["DRAFT_ALREADY_EXISTS", 409],
    ["DRAFT_SOURCE_INVALID", 409],
    ["DRAFT_NOT_FOUND", 404],
    ["DRAFT_REVISION_NOT_FOUND", 404],
  ] as const) {
    const response = errorResponse(new StudioError(code, 2), "id");
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code, requestId: "id" });
  }
});
