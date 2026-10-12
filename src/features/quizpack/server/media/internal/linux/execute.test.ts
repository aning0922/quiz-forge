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
import { createHash } from "node:crypto";
import { LIMITS, type LinuxRunRecord } from "./container-policy.mjs";
import { parseLaunchResult } from "../../evidence";
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
    const docker = vi.fn(async (_args?: readonly string[]) => {
      void _args;
      return commandResult(false);
    });
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
  it("nonzero attach preserves inspected kernel OOM evidence after confirmed cleanup", async () => {
    const fixtureRun = fixture(),
      run = scoped();
    const seccomp = "{}";
    fixtureRun.loadPolicy.mockResolvedValue({
      ...policy,
      binding: {
        ...policy.binding,
        seccompSha256: createHash("sha256").update(seccomp).digest("hex"),
      },
    });
    let record: LinuxRunRecord;
    let started = false;
    fixtureRun.docker.mockImplementation(async (args?: readonly string[]) => {
      const success = { ...commandResult(true), code: 0, reason: undefined };
      if (args?.[0] === "start") {
        started = true;
        return { ...success, code: 137 };
      }
      if (args?.[0] === "rm")
        return { ...success, stdout: Buffer.from("a".repeat(64)) };
      if (args?.[0] === "wait")
        return { ...success, stdout: Buffer.from("137") };
      if (args?.[0] !== "inspect") return success;
      return {
        ...success,
        stdout: Buffer.from(
          JSON.stringify({
            id: "a".repeat(64),
            name: `/${record.name}`,
            image: record.imageId,
            labels: {
              "qf.run": record.runId,
              "qf.nonce": record.nonce,
              "qf.profile": record.profileId,
            },
            user: "10001:10001",
            entrypoint: [record.entrypoint],
            cmd: record.args,
            mounts: [],
            health: { Test: ["NONE"] },
            env: [
              "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
              "NODE_VERSION=20.20.1",
              "YARN_VERSION=1.22.22",
              "NODE_ENV=production",
              "UV_THREADPOOL_SIZE=4",
              "MALLOC_ARENA_MAX=2",
            ],
            host: {
              Privileged: false,
              ReadonlyRootfs: true,
              CapDrop: ["ALL"],
              SecurityOpt: ["no-new-privileges=true", `seccomp=${seccomp}`],
              NetworkMode: "none",
              IpcMode: "none",
              PidMode: "",
              CgroupnsMode: "private",
              Memory: LIMITS.memory,
              MemorySwap: LIMITS.memory,
              NanoCpus: LIMITS.nanoCpus,
              PidsLimit: LIMITS.pids,
              RestartPolicy: { Name: "no" },
              LogConfig: { Type: "none" },
              AutoRemove: false,
            },
            state: {
              Running: false,
              Restarting: false,
              Status: started ? "exited" : "created",
              ExitCode: started ? 137 : 0,
              OOMKilled: started,
              Error: "",
            },
          }),
        ),
      };
    });
    const result = await fixtureRun.core.execute({
      execution,
      scope: run.scope,
      bytes: Buffer.alloc(0),
      hooks: {
        afterCreate(value) {
          record = value;
        },
      },
    });
    expect(result).toMatchObject({
      outcome: "failed",
      code: "WORKER_FAILED",
      stopped: "confirmed",
      evidence: { oomKilled: true, exitCode: 137, stdioSettled: true },
    });
    expect(await readdir(fixtureRun.controlRoot)).toEqual([]);
    run.scope.finish();
    disposeMediaOperationContext(run.context);
  });
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
  it("policy rejection after cancellation escalates to unknown without issuing a CLI", async () => {
    const fixtureRun = fixture(),
      run = scoped();
    fixtureRun.loadPolicy.mockImplementation(async () => {
      requestMediaOperationStop(run.context, "CANCELLED");
      requestMediaOperationStop(run.context, "STOP_UNCONFIRMED");
      throw new Error("synthetic");
    });
    const result = await fixtureRun.core.execute({
      execution,
      scope: run.scope,
      bytes: Buffer.from("synthetic"),
    });
    expect(result).toMatchObject({
      code: "STOP_UNCONFIRMED",
      stopped: "unknown",
    });
    expect(parseLaunchResult(Buffer.from(JSON.stringify(result)))).toEqual({
      ok: true,
      value: result,
    });
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
