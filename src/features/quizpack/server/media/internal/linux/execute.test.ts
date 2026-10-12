import { mkdtemp, rm, readFile, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createLinuxFiles } from "./files.mjs";
import {
  createLinuxExecutionCore,
  type LinuxPolicy,
  type LinuxExecutionEnvironment,
} from "./execute.mjs";
import {
  beginMediaImage,
  createMediaControlScope,
  createMediaOperationContext,
  disposeMediaOperationContext,
  requestMediaOperationStop,
} from "../../operation-context";
import type { CommandResult } from "./command";
const policy: LinuxPolicy = {
  image: { imageId: `sha256:${"a".repeat(64)}` },
  profileId: "b".repeat(64),
  binding: {
    seccompSha256: "c".repeat(64),
    daemon: { id: "synthetic" },
    dependencies: {
      node: "20.20.1",
      sharp: "0.35.5",
      vips: "8.18.7",
      workerSha256: "d".repeat(64),
    },
  },
};
const commandResult = (settled: boolean): CommandResult => ({
  code: null,
  signal: null,
  reason: "WORKER_FAILED",
  stdout: Buffer.alloc(0),
  stdoutBytes: 0,
  stderrBytes: 0,
  stderrCategory: "empty",
  stderrSyscall: null,
  stderrDetails: { errno: null, fifoOperation: null, reference: null },
  settled,
});
describe("Linux issued/control barriers without a daemon", () => {
  let root: string;
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "quizforge-synthetic-linux-"));
  });
  afterEach(async () => {
    await rm(root, { recursive: true, force: true });
  });
  function fixture() {
    const stateRoot = join(root, ".cache/media"),
      controlRoot = join(stateRoot, "control");
    const docker = vi.fn(async () => commandResult(false));
    const loadPolicy = vi.fn<LinuxExecutionEnvironment["loadPolicy"]>(
      async () => policy,
    );
    const files = createLinuxFiles({ checkoutRoot: root, stateRoot });
    const core = createLinuxExecutionCore({
      ...files,
      controlRoot,
      seccompPath: join(root, "synthetic-seccomp.json"),
      docker,
      json: (bytes) => JSON.parse(Buffer.from(bytes).toString()) as unknown,
      loadPolicy,
    });
    return { core, docker, loadPolicy, controlRoot };
  }
  function scoped() {
    const context = createMediaOperationContext({
      signal: new AbortController().signal,
      deadlineMonotonicMs: performance.now() + 60_000,
    });
    return { context, scope: beginMediaImage(context)! };
  }
  const execution = {
    entrypoint: "/usr/local/bin/node" as const,
    args: ["/worker/media-worker.mjs", "8388608", "8192", "16000000"],
  };
  it("unsettled create retains its exact record/guard and blocks another invocation", async () => {
    const fixtureRun = fixture(),
      first = scoped();
    const result = await fixtureRun.core.execute({
      execution,
      scope: first.scope,
      bytes: Buffer.from("synthetic"),
    });
    expect(result).toMatchObject({
      outcome: "failed",
      code: "STOP_UNCONFIRMED",
      stopped: "unknown",
    });
    const before = await readFile(join(fixtureRun.controlRoot, "record.json"));
    expect(await readdir(fixtureRun.controlRoot)).toEqual(
      expect.arrayContaining(["record.json", "guard"]),
    );
    first.scope.finish();
    disposeMediaOperationContext(first.context);
    const second = scoped();
    expect(
      await fixtureRun.core.execute({
        execution,
        scope: second.scope,
        bytes: Buffer.from("synthetic"),
      }),
    ).toMatchObject({ code: "BUSY", stopped: "not-started" });
    expect(fixtureRun.docker).toHaveBeenCalledOnce();
    expect(await readFile(join(fixtureRun.controlRoot, "record.json"))).toEqual(
      before,
    );
    expect(await fixtureRun.core.verifyOwnStopped()).toEqual({
      stopped: "unknown",
    });
    second.scope.finish();
    disposeMediaOperationContext(second.context);
  });
  it("unsettled first policy CLI has no worker claims and blocks subsequent metadata and decode", async () => {
    const fixtureRun = fixture(),
      first = scoped();
    fixtureRun.loadPolicy.mockImplementation(async (options) => {
      const result = await options.controlCommand!(["version"], {
        deadline: options.deadline,
      });
      if (!result.settled) throw new Error("STOP_UNCONFIRMED");
      return policy;
    });
    await expect(
      fixtureRun.core.readPolicy({
        scope: createMediaControlScope(first.context),
      }),
    ).rejects.toThrow("STOP_UNCONFIRMED");
    const bytes = await readFile(join(fixtureRun.controlRoot, "policy.json"));
    expect(JSON.parse(bytes.toString())).toMatchObject({
      schema: "qf-linux-policy-run.v1",
      phase: "policy-issued",
      imageId: null,
      profileId: null,
    });
    expect(await readdir(fixtureRun.controlRoot)).toEqual(
      expect.arrayContaining(["policy.json", "guard"]),
    );
    expect(await readdir(fixtureRun.controlRoot)).not.toContain("record.json");
    first.scope.finish();
    disposeMediaOperationContext(first.context);
    const second = scoped();
    await expect(
      fixtureRun.core.readPolicy({
        scope: createMediaControlScope(second.context),
      }),
    ).rejects.toThrow("BUSY");
    expect(
      await fixtureRun.core.execute({
        execution,
        scope: second.scope,
        bytes: Buffer.from("synthetic"),
      }),
    ).toMatchObject({ code: "BUSY", stopped: "not-started" });
    expect(fixtureRun.docker).toHaveBeenCalledOnce();
    expect(await readFile(join(fixtureRun.controlRoot, "policy.json"))).toEqual(
      bytes,
    );
    second.scope.finish();
    disposeMediaOperationContext(second.context);
  });
  it("shared unknown before launch cannot be reported as not-started or invoke any command", async () => {
    const fixtureRun = fixture(),
      run = scoped();
    requestMediaOperationStop(run.context, "CANCELLED");
    requestMediaOperationStop(run.context, "STOP_UNCONFIRMED");
    expect(
      await fixtureRun.core.execute({
        execution,
        scope: run.scope,
        bytes: Buffer.from("synthetic"),
      }),
    ).toMatchObject({ code: "STOP_UNCONFIRMED", stopped: "unknown" });
    expect(fixtureRun.docker).not.toHaveBeenCalled();
    run.scope.finish();
    disposeMediaOperationContext(run.context);
  });
  it("unknown after policy does not clear its current guard", async () => {
    const fixtureRun = fixture(),
      run = scoped();
    fixtureRun.loadPolicy.mockImplementation(async () => {
      requestMediaOperationStop(run.context, "STOP_UNCONFIRMED");
      return policy;
    });
    expect(
      await fixtureRun.core.execute({
        execution,
        scope: run.scope,
        bytes: Buffer.from("synthetic"),
      }),
    ).toMatchObject({ code: "STOP_UNCONFIRMED", stopped: "unknown" });
    expect(await readdir(fixtureRun.controlRoot)).toContain("guard");
    expect(fixtureRun.docker).not.toHaveBeenCalled();
    run.scope.finish();
    disposeMediaOperationContext(run.context);
  });
  it("cancellation after policy IO prevents create and settles only its own local guard", async () => {
    const fixtureRun = fixture(),
      run = scoped();
    fixtureRun.loadPolicy.mockImplementation(async () => {
      requestMediaOperationStop(run.context, "CANCELLED");
      return policy;
    });
    expect(
      await fixtureRun.core.execute({
        execution,
        scope: run.scope,
        bytes: Buffer.from("synthetic"),
      }),
    ).toMatchObject({ code: "CANCELLED", stopped: "not-started" });
    expect(fixtureRun.docker).not.toHaveBeenCalled();
    expect(await readdir(fixtureRun.controlRoot)).toEqual([]);
    run.scope.finish();
    disposeMediaOperationContext(run.context);
  });
  it("a post-issuance exception cannot clear unknown container facts", async () => {
    const fixtureRun = fixture(),
      run = scoped();
    fixtureRun.docker.mockResolvedValue(commandResult(true));
    const result = await fixtureRun.core.execute({
      execution,
      scope: run.scope,
      bytes: Buffer.from("synthetic"),
      hooks: {
        afterCreate() {
          throw new Error("synthetic");
        },
      },
    });
    expect(result).toMatchObject({
      code: "STOP_UNCONFIRMED",
      stopped: "unknown",
    });
    expect(await readdir(fixtureRun.controlRoot)).toEqual(
      expect.arrayContaining(["record.json", "guard"]),
    );
    run.scope.finish();
    disposeMediaOperationContext(run.context);
  });
});
