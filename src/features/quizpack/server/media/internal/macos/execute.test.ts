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
import { parseLaunchResult } from "../../evidence";
import { runOwnedMac } from "./execute";
const subprocess = vi.hoisted(() => ({ spawn: vi.fn(), spawnSync: vi.fn() }));
vi.mock("node:child_process", () => subprocess);
describe("Mac owned lifecycle with the shared stop budget", () => {
  let now: number;
  let child: EventEmitter & {
    pid: number;
    exitCode: number | null;
    signalCode: string | null;
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
      pid: 123,
      exitCode: null,
      signalCode: null,
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    subprocess.spawn.mockReturnValue(child);
    subprocess.spawnSync.mockReturnValue({
      status: 0,
      stdout: Buffer.from(
        JSON.stringify({
          schema: "mac-identity.v1",
          present: true,
          owned: true,
          startSec: 1,
          startUsec: 2,
          executable: "worker",
          residentBytes: 0,
          peakFootprintBytes: 0,
        }),
      ),
    });
  });
  afterEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  function launch() {
    const context = createMediaOperationContext({
      signal: new AbortController().signal,
      deadlineMonotonicMs: 60_100,
    });
    const scope = beginMediaImage(context)!;
    const control = { update: vi.fn(), finish: vi.fn() };
    const pending = runOwnedMac(
      "626e311b-4211-4f35-b874-a39d801b2df6",
      {
        executable: "/synthetic/node",
        args: ["/synthetic/worker"],
        bytes: Buffer.from("synthetic"),
        policy: { profile: "synthetic", profileId: "a".repeat(64) },
      },
      scope,
      now,
      {
        checkoutRoot: "/synthetic/checkout",
        identityHelper: "/synthetic/helper",
        acquireControl: () => control,
      },
    );
    child.emit("spawn");
    return { context, scope, control, pending };
  }
  it("kill/exit cannot substitute for the actual stdio close event", async () => {
    const run = launch();
    now = 200;
    requestMediaOperationStop(run.context, "STORAGE_LOCK_LOST", 1200);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
    child.emit("exit", 0, null);
    expect(run.control.finish).not.toHaveBeenCalled();
    now = 1200;
    vi.advanceTimersByTime(1000);
    expect(await run.pending).toMatchObject({
      code: "STOP_UNCONFIRMED",
      stopped: "unknown",
    });
    expect(run.control.finish).not.toHaveBeenCalled();
    child.emit("close", 0, null);
    expect(run.control.finish).not.toHaveBeenCalled();
    run.scope.finish();
    disposeMediaOperationContext(run.context);
  });
  it("close within the same cleanup deadline confirms stop after dispose", async () => {
    const run = launch();
    now = 200;
    disposeMediaOperationContext(run.context);
    now = 400;
    child.emit("close", 0, null);
    expect(await run.pending).toMatchObject({
      code: "WORKER_FAILED",
      stopped: "confirmed",
    });
    expect(run.control.finish).toHaveBeenCalledOnce();
    run.scope.finish();
  });
  it("CANCEL then UNKNOWN cannot be downgraded by an actual close or ordinary stop", async () => {
    const run = launch();
    now = 200;
    requestMediaOperationStop(run.context, "CANCELLED", 1200);
    now = 400;
    requestMediaOperationStop(run.context, "STOP_UNCONFIRMED");
    requestMediaOperationStop(run.context, "STOP_REQUESTED");
    child.emit("close", 0, null);
    expect(await run.pending).toMatchObject({
      code: "STOP_UNCONFIRMED",
      stopped: "unknown",
    });
    expect(run.control.finish).not.toHaveBeenCalled();
    run.scope.finish();
    disposeMediaOperationContext(run.context);
  });
  it("a control finish crossing the same absolute deadline cannot claim confirmation", async () => {
    const run = launch();
    now = 200;
    requestMediaOperationStop(run.context, "CANCELLED", 1200);
    run.control.finish.mockImplementation(() => {
      now = 1300;
    });
    now = 1199;
    child.emit("close", 0, null);
    expect(await run.pending).toMatchObject({
      code: "STOP_UNCONFIRMED",
      stopped: "unknown",
    });
    expect(run.control.finish).toHaveBeenCalledWith(1200);
    expect(run.scope.readState()).toMatchObject({
      phase: "stopping",
      stop: {
        reason: "STOP_UNCONFIRMED",
        stopStartedMonotonicMs: 200,
        cleanupDeadlineMonotonicMs: 1200,
      },
    });
    run.scope.finish();
    disposeMediaOperationContext(run.context);
  });
  it.each(["before", "acquire", "persist"])(
    "shared unknown at %s keeps strict evidence and never clears a guard",
    async (stage) => {
      const context = createMediaOperationContext({
        signal: new AbortController().signal,
        deadlineMonotonicMs: 60_100,
      });
      const scope = beginMediaImage(context)!;
      const control = { update: vi.fn(), finish: vi.fn() };
      if (stage === "before")
        requestMediaOperationStop(context, "STOP_UNCONFIRMED");
      control.update.mockImplementation((phase) => {
        if (stage === "persist" && phase === "issued")
          requestMediaOperationStop(context, "STOP_UNCONFIRMED");
      });
      const result = await runOwnedMac(
        "626e311b-4211-4f35-b874-a39d801b2df6",
        {
          executable: "/synthetic/node",
          args: ["/synthetic/worker"],
          bytes: Buffer.alloc(0),
          policy: { profile: "synthetic", profileId: "a".repeat(64) },
        },
        scope,
        now,
        {
          checkoutRoot: "/synthetic/root",
          identityHelper: "/synthetic/helper",
          acquireControl() {
            if (stage === "acquire")
              requestMediaOperationStop(context, "STOP_UNCONFIRMED");
            return control;
          },
        },
      );
      expect(result).toMatchObject({
        code: "STOP_UNCONFIRMED",
        stopped: "unknown",
      });
      expect(
        parseLaunchResult(
          Buffer.from(
            JSON.stringify({
              outcome: "failed",
              runId: result.runId,
              profileId: result.profileId,
              code: result.code,
              stopped: result.stopped,
            }),
          ),
        ).ok,
      ).toBe(true);
      expect(subprocess.spawn).not.toHaveBeenCalled();
      expect(control.finish).not.toHaveBeenCalled();
      scope.finish();
      disposeMediaOperationContext(context);
    },
  );
  it("late observation of the image deadline cannot create a fresh cleanup window", async () => {
    const run = launch();
    now = 11_000;
    vi.advanceTimersByTime(5000);
    expect(await run.pending).toMatchObject({
      code: "STOP_UNCONFIRMED",
      stopped: "unknown",
    });
    expect(run.control.finish).not.toHaveBeenCalled();
    expect(child.kill).not.toHaveBeenCalled();
    child.emit("close", 0, null);
    run.scope.finish();
    disposeMediaOperationContext(run.context);
  });
});
