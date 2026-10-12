import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { performance } from "node:perf_hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  beginMediaImage,
  createMediaOperationContext,
  disposeMediaOperationContext,
  requestMediaOperationStop,
} from "../../operation-context";
import { command } from "./command";
const subprocess = vi.hoisted(() => ({ spawn: vi.fn() }));
vi.mock("node:child_process", () => subprocess);
describe("Linux command shared stop deadline", () => {
  let now: number;
  let child: EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  beforeEach(() => {
    now = 100;
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
    });
    vi.spyOn(performance, "now").mockImplementation(() => now);
    child = Object.assign(new EventEmitter(), {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    subprocess.spawn.mockReturnValue(child);
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  function scoped() {
    const context = createMediaOperationContext({
      signal: new AbortController().signal,
      deadlineMonotonicMs: 60_100,
    });
    const scope = beginMediaImage(context)!;
    return { context, scope };
  }
  it("early fractional command timers re-arm instead of prematurely killing", async () => {
    const pending = command("/synthetic/command", [], {
      deadline: 1100.5,
      settleDeadline: 6100.5,
    });
    now = 1100.25;
    vi.advanceTimersByTime(1001);
    expect(child.kill).not.toHaveBeenCalled();
    now = 1100.5;
    vi.advanceTimersByTime(1);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.emit("close", null, "SIGKILL");
    expect(await pending).toMatchObject({
      reason: "DEADLINE_EXCEEDED",
      settled: true,
    });
  });
  it("factory image deadline abort is reported as its deadline reason", async () => {
    const run = scoped();
    const pending = command("/synthetic/command", [], {
      scope: run.scope,
      deadline: 5100,
      settleDeadline: 10100,
    });
    now = 5100;
    vi.advanceTimersByTime(5000);
    child.emit("close", null, "SIGKILL");
    expect(await pending).toMatchObject({
      reason: "DEADLINE_EXCEEDED",
      settled: true,
    });
    run.scope.finish();
    disposeMediaOperationContext(run.context);
  });
  it("a broken input pipe does not kill attach before its observed close", async () => {
    const run = scoped();
    const pending = command("/synthetic/command", [], {
      scope: run.scope,
      deadline: 5100,
      settleDeadline: 10100,
    });
    child.stdin.emit("error", new Error("synthetic"));
    expect(child.kill).not.toHaveBeenCalled();
    expect(run.scope.readState().phase).toBe("active");
    now = 300;
    child.emit("close", 137, null);
    expect(await pending).toMatchObject({
      code: 137,
      reason: "WORKER_FAILED",
      settled: true,
    });
    run.scope.finish();
    disposeMediaOperationContext(run.context);
  });
  it("an input error followed by cancellation kills immediately and only once", async () => {
    const run = scoped();
    const pending = command("/synthetic/command", [], {
      scope: run.scope,
      deadline: 5100,
      settleDeadline: 10100,
    });
    child.stdin.emit("error", new Error("synthetic"));
    expect(child.kill).not.toHaveBeenCalled();
    now = 200;
    requestMediaOperationStop(run.context, "CANCELLED");
    expect(child.kill).toHaveBeenCalledExactlyOnceWith("SIGKILL");
    vi.advanceTimersByTime(20);
    expect(child.kill).toHaveBeenCalledOnce();
    child.emit("close", null, "SIGKILL");
    expect(await pending).toMatchObject({
      reason: "WORKER_FAILED",
      settled: true,
    });
    run.scope.finish();
    disposeMediaOperationContext(run.context);
  });
  it("a shorter operation stop budget bounds in-flight command/stdio together", async () => {
    const run = scoped();
    const pending = command("/synthetic/command", [], {
      scope: run.scope,
      deadline: 5100,
      settleDeadline: 10_100,
    });
    now = 200;
    requestMediaOperationStop(run.context, "STORAGE_LOCK_LOST", 1200);
    now = 1200;
    vi.advanceTimersByTime(1000);
    expect(await pending).toMatchObject({ settled: false });
    child.emit("close", 0, null);
    run.scope.finish();
    disposeMediaOperationContext(run.context);
  });
  it("cleanup controls can run after cancellation using the same absolute budget", async () => {
    const run = scoped();
    now = 200;
    requestMediaOperationStop(run.context, "CANCELLED", 1200);
    const pending = command("/synthetic/control", [], {
      scope: run.scope,
      phase: "cleanup",
      deadline: 1200,
      settleDeadline: 1200,
    });
    expect(subprocess.spawn).toHaveBeenCalledOnce();
    now = 400;
    child.emit("close", 0, null);
    expect(await pending).toMatchObject({ settled: true, reason: undefined });
    run.scope.finish();
    disposeMediaOperationContext(run.context);
  });
  it("late image timeout cannot extend cleanup or issue another kill", async () => {
    const run = scoped();
    const pending = command("/synthetic/command", [], {
      scope: run.scope,
      deadline: 5100,
      settleDeadline: 10_100,
    });
    now = 11_000;
    vi.advanceTimersByTime(5000);
    expect(await pending).toMatchObject({ settled: false });
    expect(child.kill).not.toHaveBeenCalled();
    child.emit("close", 0, null);
    run.scope.finish();
    disposeMediaOperationContext(run.context);
  });
});
