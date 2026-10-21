import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import path from "node:path";

const state = vi.hoisted(() => ({
  child: undefined as unknown,
  latched: false,
}));
vi.mock("node:child_process", () => ({ spawn: vi.fn(() => state.child) }));
vi.mock("@/features/runtime-recovery/files", () => ({
  checkRecoveryBudget: () => {
    if (state.latched) throw Error("RECOVERY_CLOSE_UNPROVEN");
  },
}));
function child() {
  const c = Object.assign(new EventEmitter(), {
    pid: 424242,
    stdout: new EventEmitter(),
    stderr: new EventEmitter(),
  });
  state.child = c;
  return c;
}
function absent(): never {
  throw Object.assign(Error("synthetic absent"), { code: "ESRCH" });
}
const budget = () => ({
  signal: new AbortController().signal,
  deadlineMonotonicMs: performance.now() + 10000,
});
beforeEach(() => {
  vi.resetModules();
  state.latched = false;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it("retains an unknown group after exit/close without destructive signals or success", async () => {
  const { runRecoveryPg } =
    await import("@/features/runtime-recovery/database-process");
  const c = child(),
    signals: unknown[] = [];
  vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
    signals.push(signal);
    return true;
  });
  const result = expect(
    runRecoveryPg("pg_restore", ["--version"], budget()),
  ).rejects.toThrow("RECOVERY_CLOSE_UNPROVEN");
  c.emit("spawn");
  c.emit("exit", 0, null);
  c.emit("close", 0, null);
  await result;
  expect(signals).toEqual([0]);
});

it("replays cancellation on the still-owned leader when spawn follows abort", async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const { runRecoveryPg } =
    await import("@/features/runtime-recovery/database-process");
  const c = child(),
    signals: unknown[] = [];
  vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
    if (signal === 0) return absent();
    signals.push(signal);
    return true;
  });
  const controller = new AbortController();
  const pending = runRecoveryPg("pg_restore", ["--version"], {
    ...budget(),
    signal: controller.signal,
  });
  const result = expect(pending).rejects.toThrow("RECOVERY_PROCESS_FAILED");
  controller.abort();
  expect(signals).toEqual([]);
  c.emit("spawn");
  expect(signals).toEqual(["SIGTERM"]);
  c.emit("exit", null, "SIGTERM");
  c.emit("close", null, "SIGTERM");
  await result;
  await vi.advanceTimersByTimeAsync(3000);
  expect(signals).toEqual(["SIGTERM"]);
  expect(vi.getTimerCount()).toBe(0);
});

it("waits for a late stat rejection without post-close signals or escaped timers", async () => {
  vi.useFakeTimers({
    toFake: ["setTimeout", "clearTimeout", "setInterval", "clearInterval"],
  });
  const { runRecoveryPg } =
    await import("@/features/runtime-recovery/database-process");
  const c = child(),
    signals: unknown[] = [];
  vi.spyOn(process, "kill").mockImplementation((_pid, signal) => {
    if (signal === 0) return absent();
    signals.push(signal);
    return true;
  });
  let reject!: (error: Error) => void;
  const output = {
    fd: 99,
    stat: vi.fn(
      () =>
        new Promise<never>((_resolve, fail) => {
          reject = fail;
        }),
    ),
  };
  const result = expect(
    runRecoveryPg("pg_dump", ["-Fc"], budget(), {
      output: output as unknown as import("node:fs/promises").FileHandle,
    }),
  ).rejects.toThrow("RECOVERY_PROCESS_FAILED");
  c.emit("spawn");
  await vi.advanceTimersByTimeAsync(25);
  expect(output.stat).toHaveBeenCalledOnce();
  c.emit("exit", 0, null);
  c.emit("close", 0, null);
  reject(Error("late synthetic stat failure"));
  await result;
  await vi.advanceTimersByTimeAsync(3000);
  expect(signals).toEqual([]);
  expect(vi.getTimerCount()).toBe(0);
});

it("allows only the fixed owned compensating stop despite an admission latch and abort", async () => {
  const { recoveryPgRunner, runRecoveryPg } =
    await import("@/features/runtime-recovery/database-process");
  const c = child();
  state.latched = true;
  vi.spyOn(process, "kill").mockImplementation(() => absent());
  const abort = new AbortController();
  abort.abort();
  const runner = recoveryPgRunner({
    signal: abort.signal,
    deadlineMonotonicMs: 0,
  });
  await expect(
    runRecoveryPg("pg_restore", ["--version"], budget()),
  ).rejects.toThrow("RECOVERY_CLOSE_UNPROVEN");
  const args = [
    "-D",
    path.join(process.cwd(), ".cache/p2a", "ab".repeat(16), "pgdata"),
    "-w",
    "-t",
    "5",
    "-m",
    "fast",
    "stop",
  ];
  const pending = runner("pg_ctl", args);
  c.emit("spawn");
  c.emit("exit", 0, null);
  c.emit("close", 0, null);
  await expect(pending).resolves.toBe("");
  await expect(runner("pg_ctl", [...args, "--extra"])).rejects.toThrow(
    "RECOVERY_CLOSE_UNPROVEN",
  );
  await expect(
    runRecoveryPg("pg_restore", ["--version"], budget()),
  ).rejects.toThrow("RECOVERY_CLOSE_UNPROVEN");
});
