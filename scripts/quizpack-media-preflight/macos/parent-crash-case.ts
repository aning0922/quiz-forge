import { spawn } from "node:child_process";
import { readdirSync, unlinkSync, rmdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { CONTROL_ROOT, readControlForHarness } from "./control";
import {
  loadPolicy,
  RUNTIME_TARGET,
  PARENT_CRASH_DIAGNOSTIC,
  REPO_ROOT,
  MAC_IDENTITY_HELPER,
} from "./policy";
import { runHarnessImage } from "./launcher";
import { parseNativeIdentity } from "./protocol";
import { waitForCrashReady, waitForOwnedClose } from "./owned-barriers";
import type { ImageDeclaration } from "../shared/contracts";
const CODES = [
  "SYNTHETIC_ASSERTION_FAILED",
  "OWNED_READY_UNCONFIRMED",
  "OWNED_CLOSE_UNCONFIRMED",
] as const;
const finiteCode = (e: unknown) =>
  e instanceof Error && CODES.some((c) => c === e.message)
    ? e.message
    : "UNCLASSIFIED_FAILURE";
export class ParentCrashFailure extends Error {
  cleanupFailure: string | null = null;
  constructor(
    readonly stage: string,
    readonly code: string,
    readonly assertion: string | null = null,
  ) {
    super("PARENT_CRASH_DIAGNOSTIC_FAILURE");
  }
  details() {
    return {
      stage: this.stage,
      code: this.code,
      assertion: this.assertion,
      cleanupFailure: this.cleanupFailure,
    };
  }
}
/** One shared case. No capability or qualification writer is imported here. */
export async function runParentCrashCase({
  small,
  declaration,
  context,
  baseline,
  policy,
  runRoot,
}: {
  small: Buffer;
  declaration: (
    bytes: Buffer,
    width: number,
    height: number,
  ) => ImageDeclaration;
  context: () => { signal: AbortSignal; deadlineMonotonicMs: number };
  baseline: (executable: string, args: string[]) => Buffer;
  policy: ReturnType<typeof loadPolicy>;
  runRoot: string;
}) {
  let stage = "control-empty",
    primary: ParentCrashFailure | null = null;
  const assertStage = (v: unknown, assertion = stage) => {
    if (!v)
      throw new ParentCrashFailure(
        stage,
        "SYNTHETIC_ASSERTION_FAILED",
        assertion,
      );
  };
  const privateWrite = (file: string, text: string) =>
    writeFileSync(file, text, { flag: "wx", mode: 0o600 });

  assertStage(readdirSync(CONTROL_ROOT).length === 0);
  stage = "policy";
  const expectedProfileId = loadPolicy("fault").profileId;
  const host = spawn(
    process.execPath,
    [
      "--conditions=react-server",
      "--import",
      "tsx",
      resolve(
        REPO_ROOT,
        "scripts/quizpack-media-preflight/macos/crash-host.ts",
      ),
      ...(RUNTIME_TARGET ? [`--runtime-target=${RUNTIME_TARGET}`] : []),
      ...(PARENT_CRASH_DIAGNOSTIC ? ["--diagnostic-parent-crash"] : []),
    ],
    {
      cwd: REPO_ROOT,
      env: { NODE_ENV: "production" },
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  let closed = false;
  const hostClosed = new Promise<void>((resolve) =>
    host.once("close", () => {
      closed = true;
      resolve();
    }),
  );
  host.on("error", () => {});
  host.stderr.on("data", () => {});
  try {
    stage = "ready";
    const ready = await waitForCrashReady(host, performance.now() + 12000);
    assertStage(
      host.pid &&
        ready.ownerPid === host.pid &&
        ready.profileId === expectedProfileId,
    );
    stage = "control-binding";
    const saved = readControlForHarness();
    assertStage(
      saved.ownerPid === ready.ownerPid &&
        saved.runId === ready.runId &&
        saved.profileId === ready.profileId &&
        saved.pid === ready.workerPid &&
        saved.workerStart?.sec === ready.workerStart.sec &&
        saved.workerStart?.usec === ready.workerStart.usec,
    );
    stage = "kill-parent";
    assertStage(host.kill("SIGKILL"));
    stage = "parent-close";
    await waitForOwnedClose(hostClosed, performance.now() + 5000);
    stage = "restart-blocked";
    const blocked = await runHarnessImage(
      small,
      declaration(small, 2, 2),
      context(),
    );
    assertStage(
      blocked.outcome === "failed" &&
        blocked.code === "BUSY" &&
        blocked.stopped === "not-started",
    );
    stage = "worker-identity-gone";
    const until = performance.now() + 5000;
    let originalGone = false;
    while (performance.now() < until) {
      const value = parseNativeIdentity(
        baseline(MAC_IDENTITY_HELPER, [
          "identity",
          String(saved.pid),
          String(saved.ownerPid),
          policy.node,
        ]),
      );
      assertStage(value);
      if (value?.present === false) {
        originalGone = true;
        break;
      }
      await new Promise((resolve) =>
        setTimeout(
          resolve,
          Math.max(1, Math.min(100, Math.ceil(until - performance.now()))),
        ),
      );
    }
    stage = "owner-identity-gone";
    const owner = parseNativeIdentity(
      baseline(MAC_IDENTITY_HELPER, [
        "identity",
        String(saved.ownerPid),
        String(saved.ownerPid),
        policy.node,
      ]),
    );
    assertStage(owner?.present === false, "owner-absent");
    assertStage(originalGone, "original-worker-absent");
    assertStage(
      JSON.stringify(readControlForHarness()) === JSON.stringify(saved),
      "retained-control",
    );
    stage = "retain-evidence";
    privateWrite(join(runRoot, "crash-control.json"), JSON.stringify(saved));
    stage = "release-new-control";
    unlinkSync(join(CONTROL_ROOT, "active.json"));
    rmdirSync(join(CONTROL_ROOT, "guard"));
    return {
      ownedParentKilled: true,
      ownedParentCloseObserved: true,
      originalWorkerIdentityGone: true,
      restartBlocked: true,
      receiptWritten: false,
    };
  } catch (error) {
    primary =
      error instanceof ParentCrashFailure
        ? error
        : new ParentCrashFailure(stage, finiteCode(error));
    throw primary;
  } finally {
    if (
      !closed &&
      host.pid &&
      host.exitCode === null &&
      host.signalCode === null
    )
      host.kill("SIGKILL");
    stage = "parent-close";
    try {
      await waitForOwnedClose(hostClosed, performance.now() + 5000);
    } catch (error) {
      if (primary) primary.cleanupFailure = finiteCode(error);
      else throw new ParentCrashFailure("cleanup-close", finiteCode(error));
    }
  }
}
