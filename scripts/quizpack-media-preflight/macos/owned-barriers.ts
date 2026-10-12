// Private offline observations. These helpers neither launch nor release a control object.
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { performance } from "node:perf_hooks";
import { TextDecoder } from "node:util";
import { z } from "zod";
import { readControlForHarness } from "./control";
import type { MacExecutionResult } from "../../../src/features/quizpack/server/media/internal/macos/execute";
function requireTrue(value: unknown): asserts value {
  if (!value) throw new Error("OWNED_BARRIER_FAILED");
}
export async function waitForOwnedSpawn(
  pending: Promise<MacExecutionResult>,
  ownerPid: number,
  profileId: string,
  deadline: number,
) {
  let settled = false;
  void pending.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  const withinDeadline = () => {
    if (performance.now() >= deadline)
      throw new Error("OWNED_SPAWN_UNCONFIRMED");
  };
  withinDeadline();
  const issued = readControlForHarness();
  withinDeadline();
  requireTrue(
    issued.ownerPid === ownerPid &&
      issued.profileId === profileId &&
      ["issued", "spawned"].includes(issued.phase),
  );
  while (performance.now() < deadline && !settled) {
    const current = readControlForHarness();
    withinDeadline();
    requireTrue(
      current.runId === issued.runId &&
        current.ownerPid === ownerPid &&
        current.profileId === profileId,
    );
    if (issued.workerStart)
      requireTrue(
        current.pid === issued.pid &&
          current.workerStart?.sec === issued.workerStart.sec &&
          current.workerStart?.usec === issued.workerStart.usec,
      );
    if (
      current.phase === "spawned" &&
      current.pid !== null &&
      current.workerStart !== null
    ) {
      withinDeadline();
      return current;
    }
    await new Promise<void>((resolve) =>
      setTimeout(
        resolve,
        Math.max(1, Math.min(10, Math.ceil(deadline - performance.now()))),
      ),
    );
  }
  throw new Error("OWNED_SPAWN_UNCONFIRMED");
}
type ControlIdentity = Pick<
  ReturnType<typeof readControlForHarness>,
  "runId" | "profileId" | "ownerPid" | "pid" | "workerStart" | "phase"
>;
export function assertRetainedUnknownControl(
  before: ControlIdentity,
  saved: ControlIdentity,
  result: Pick<MacExecutionResult, "runId" | "profileId" | "code" | "stopped">,
): void {
  requireTrue(
    result.stopped === "unknown" &&
      result.code === "STOP_UNCONFIRMED" &&
      before.pid !== null &&
      before.workerStart !== null,
  );
  requireTrue(
    saved.runId === result.runId &&
      saved.runId === before.runId &&
      saved.profileId === result.profileId &&
      saved.profileId === before.profileId &&
      saved.ownerPid === before.ownerPid &&
      saved.pid === before.pid &&
      saved.workerStart?.sec === before.workerStart.sec &&
      saved.workerStart?.usec === before.workerStart.usec,
  );
  requireTrue(saved.phase === "spawned" || saved.phase === "unknown");
}
export function waitForOwnedClose(
  closed: Promise<void>,
  deadline: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined,
      finished = false;
    const finish = (ok: boolean) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      if (ok) resolve();
      else reject(new Error("OWNED_CLOSE_UNCONFIRMED"));
    };
    const observe = () => {
      if (performance.now() >= deadline) finish(false);
      else
        timer = setTimeout(
          observe,
          Math.max(1, Math.ceil(deadline - performance.now())),
        );
    };
    closed.then(
      () => finish(performance.now() < deadline),
      () => finish(false),
    );
    observe();
  });
}
export const crashReadySchema = z.strictObject({
  schema: z.literal("mac-parent-crash-ready.v1"),
  runId: z.string().uuid(),
  profileId: z.string().regex(/^[a-f0-9]{64}$/),
  ownerPid: z.number().int().positive().safe(),
  workerPid: z.number().int().positive().safe(),
  workerStart: z.strictObject({
    sec: z.number().int().nonnegative().safe(),
    usec: z.number().int().min(0).max(999999),
  }),
});
export function waitForCrashReady(
  host: ChildProcessWithoutNullStreams,
  deadline: number,
): Promise<z.infer<typeof crashReadySchema>> {
  return new Promise((resolve, reject) => {
    let timer: NodeJS.Timeout | undefined,
      finished = false,
      stdout = Buffer.alloc(0),
      stderrBytes = 0;
    const finish = (value: z.infer<typeof crashReadySchema> | null) => {
      if (finished) return;
      finished = true;
      if (timer) clearTimeout(timer);
      host.stdout.removeListener("data", data);
      host.stderr.removeListener("data", stderr);
      host.removeListener("error", failed);
      host.removeListener("close", failed);
      if (value) resolve(value);
      else reject(new Error("OWNED_READY_UNCONFIRMED"));
    };
    const data = (chunk: Buffer) => {
      if (stdout.length + chunk.length > 2048) {
        finish(null);
        return;
      }
      stdout = Buffer.concat([stdout, chunk]);
      const newline = stdout.indexOf(10);
      if (newline < 0) return;
      if (newline !== stdout.length - 1) {
        finish(null);
        return;
      }
      try {
        const text = new TextDecoder("utf-8", {
          fatal: true,
          ignoreBOM: true,
        }).decode(stdout.subarray(0, newline));
        const value: unknown = JSON.parse(text);
        const parsed = crashReadySchema.safeParse(value);
        if (
          !parsed.success ||
          JSON.stringify(value) !== text ||
          parsed.data.ownerPid !== host.pid ||
          performance.now() >= deadline
        )
          finish(null);
        else finish(parsed.data);
      } catch {
        finish(null);
      }
    };
    const stderr = (chunk: Buffer) => {
      stderrBytes += chunk.length;
      if (stderrBytes > 4096) finish(null);
    };
    const failed = () => finish(null);
    const observe = () => {
      if (performance.now() >= deadline) finish(null);
      else
        timer = setTimeout(
          observe,
          Math.max(1, Math.ceil(deadline - performance.now())),
        );
    };
    host.stdout.on("data", data);
    host.stderr.on("data", stderr);
    host.once("error", failed);
    host.once("close", failed);
    observe();
  });
}
