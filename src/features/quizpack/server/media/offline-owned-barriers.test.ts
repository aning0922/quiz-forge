import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock(
  "../../../../../scripts/quizpack-media-preflight/macos/control",
  () => ({ readControlForHarness: mocks.read }),
);
import {
  waitForOwnedSpawn,
  assertRetainedUnknownControl,
  waitForOwnedClose,
  waitForCrashReady,
} from "../../../../../scripts/quizpack-media-preflight/macos/owned-barriers";
import type { MacExecutionResult } from "./internal/macos/execute";
const profileId = "e".repeat(64),
  runId = "00000000-0000-4000-8000-000000000001";
const issued = {
  runId,
  profileId,
  ownerPid: 1234,
  phase: "issued",
  pid: null,
  workerStart: null,
};
const spawned = {
  ...issued,
  phase: "spawned",
  pid: 4321,
  workerStart: { sec: 100, usec: 1 },
};
let now: number;
beforeEach(() => {
  now = 100;
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  mocks.read.mockReset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});
function pendingRun() {
  return new Promise<MacExecutionResult>(() => {});
}
function host() {
  return Object.assign(new EventEmitter(), {
    pid: 1234,
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
  }) as unknown as ChildProcessWithoutNullStreams;
}
const ready = {
  schema: "mac-parent-crash-ready.v1",
  runId,
  profileId,
  ownerPid: 1234,
  workerPid: 4321,
  workerStart: { sec: 100, usec: 1 },
};
describe("private owned matrix barriers", () => {
  it("initialization exceeding 100ms still waits for exact native spawn facts", async () => {
    mocks.read.mockReturnValue(issued);
    const pending = waitForOwnedSpawn(pendingRun(), 1234, profileId, 5100);
    now = 900;
    await vi.advanceTimersByTimeAsync(100);
    mocks.read.mockReturnValue(spawned);
    await vi.advanceTimersByTimeAsync(10);
    expect(await pending).toEqual(spawned);
  });
  it("issued alone is not a spawn proof and expiration fails", async () => {
    mocks.read.mockReturnValue(issued);
    const pending = waitForOwnedSpawn(pendingRun(), 1234, profileId, 5100);
    const rejected = expect(pending).rejects.toThrow("OWNED_SPAWN_UNCONFIRMED");
    now = 5100;
    await vi.advanceTimersByTimeAsync(10);
    await rejected;
  });
  it("a substituted run or known worker identity cannot supply the barrier", async () => {
    mocks.read
      .mockReturnValueOnce(spawned)
      .mockReturnValue({ ...spawned, workerStart: { sec: 101, usec: 1 } });
    await expect(
      waitForOwnedSpawn(pendingRun(), 1234, profileId, 5100),
    ).rejects.toThrow("OWNED_BARRIER_FAILED");
  });
  it.each(["initial", "spawned"])(
    "%s synchronous control reads crossing the original deadline fail closed",
    async (stage) => {
      const crossing = () => {
        now = 5101;
        return stage === "initial" ? issued : spawned;
      };
      if (stage === "initial") mocks.read.mockImplementation(crossing);
      else mocks.read.mockReturnValueOnce(issued).mockImplementation(crossing);
      await expect(
        waitForOwnedSpawn(pendingRun(), 1234, profileId, 5100),
      ).rejects.toThrow("OWNED_SPAWN_UNCONFIRMED");
    },
  );
  it("every single split of the bounded newline frame accepts the same identity", async () => {
    const text = JSON.stringify(ready) + "\n";
    for (let split = 1; split < text.length; split++) {
      const child = host(),
        pending = waitForCrashReady(child, 12100);
      child.stdout.emit("data", Buffer.from(text.slice(0, split)));
      child.stdout.emit("data", Buffer.from(text.slice(split)));
      expect(await pending).toEqual(ready);
    }
  });
  it("host startup past two seconds accepts a bounded exact readiness packet", async () => {
    const child = host(),
      pending = waitForCrashReady(child, 12100),
      text = JSON.stringify(ready) + "\n";
    now = 3100;
    await vi.advanceTimersByTimeAsync(2000);
    child.stdout.emit("data", Buffer.from(text.slice(0, 80)));
    child.stdout.emit("data", Buffer.from(text.slice(80)));
    expect(await pending).toEqual(ready);
    expect(child.stdout.listenerCount("data")).toBe(0);
  });
  it.each(["wrong-owner", "extra", "duplicate", "oversized"])(
    "%s readiness is rejected",
    async (mode) => {
      const child = host(),
        pending = waitForCrashReady(child, 12100);
      const rejected = expect(pending).rejects.toThrow(
        "OWNED_READY_UNCONFIRMED",
      );
      const data =
        mode === "wrong-owner"
          ? JSON.stringify({ ...ready, ownerPid: 1235 }) + "\n"
          : mode === "extra"
            ? JSON.stringify({ ...ready, extra: true }) + "\n"
            : mode === "duplicate"
              ? JSON.stringify(ready).replace(
                  '"ownerPid":1234',
                  '"ownerPid":1235,"ownerPid":1234',
                ) + "\n"
              : "x".repeat(2049);
      child.stdout.emit("data", Buffer.from(data));
      await rejected;
    },
  );
  it("inner-object braces and a split final newline are valid partial frames", async () => {
    const child = host(),
      pending = waitForCrashReady(child, 12100),
      text = JSON.stringify(ready) + "\n";
    child.stdout.emit("data", Buffer.from(text.slice(0, -2)));
    child.stdout.emit("data", Buffer.from(text.slice(-2, -1)));
    child.stdout.emit("data", Buffer.from("\n"));
    expect(await pending).toEqual(ready);
  });
  it.each(["extra-bytes", "two-lines", "late"])(
    "%s frame cannot authorize readiness",
    async (kind) => {
      const child = host(),
        pending = waitForCrashReady(child, 12100);
      const rejected = expect(pending).rejects.toThrow(
        "OWNED_READY_UNCONFIRMED",
      );
      if (kind === "late") now = 12100;
      child.stdout.emit(
        "data",
        Buffer.from(
          JSON.stringify(ready) +
            "\n" +
            (kind === "extra-bytes"
              ? "x"
              : kind === "two-lines"
                ? JSON.stringify(ready) + "\n"
                : ""),
        ),
      );
      await rejected;
    },
  );
  it.each(["spawned", "unknown"] as const)(
    "a retained %s record keeps UNKNOWN rather than requiring a late write",
    (phase) => {
      expect(() =>
        assertRetainedUnknownControl(
          spawned as typeof spawned & { phase: "spawned" },
          { ...spawned, phase },
          { runId, profileId, code: "STOP_UNCONFIRMED", stopped: "unknown" },
        ),
      ).not.toThrow();
      expect(() =>
        assertRetainedUnknownControl(
          spawned as typeof spawned & { phase: "spawned" },
          { ...spawned, phase, workerStart: { sec: 101, usec: 1 } },
          { runId, profileId, code: "STOP_UNCONFIRMED", stopped: "unknown" },
        ),
      ).toThrow("OWNED_BARRIER_FAILED");
    },
  );
  it("missing readiness times out at the original absolute bound", async () => {
    const child = host(),
      pending = waitForCrashReady(child, 12100);
    const rejected = expect(pending).rejects.toThrow("OWNED_READY_UNCONFIRMED");
    now = 12100;
    await vi.advanceTimersByTimeAsync(12000);
    await rejected;
  });
  it("early close deadline timers rearm and require actual close", async () => {
    let close: () => void = () => {};
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    const pending = waitForOwnedClose(closed, 1100.5);
    now = 1100.25;
    await vi.advanceTimersByTimeAsync(1001);
    now = 1100.4;
    close();
    await expect(pending).resolves.toBeUndefined();
  });
  it("late close cannot be converted into an in-window proof", async () => {
    let close: () => void = () => {};
    const closed = new Promise<void>((resolve) => {
      close = resolve;
    });
    const pending = waitForOwnedClose(closed, 1100);
    const rejected = expect(pending).rejects.toThrow("OWNED_CLOSE_UNCONFIRMED");
    now = 1100;
    close();
    await rejected;
  });
});
