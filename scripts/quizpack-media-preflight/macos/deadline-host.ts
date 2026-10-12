// Closed offline issued-persistence probes; no production fault knob.
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";

type Mode = "deadline" | "abort";
type IssuedPlan =
  | { observed: false }
  | { observed: true; interrupt: "abort" }
  | { observed: true; interrupt: "deadline"; untilMonotonicMs: number };

/** Pure offline helpers: importing this file does not load a native policy. */
export function initialIssuedDeadline(start: number, target: boolean): number {
  if (!Number.isFinite(start) || start < 0 || typeof target !== "boolean")
    throw new Error("INVALID_SYNTHETIC_CONTEXT");
  return start + (target ? 5000 : 500);
}
export function isOwnIssuedRecord(
  bytes: Uint8Array,
  ownerPid: number,
): boolean {
  if (
    !(bytes instanceof Uint8Array) ||
    bytes.length === 0 ||
    bytes.length > 16384 ||
    !Number.isSafeInteger(ownerPid) ||
    ownerPid <= 0
  )
    return false;
  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    const r: unknown = JSON.parse(text);
    if (!r || typeof r !== "object" || Array.isArray(r)) return false;
    const value = r as Record<string, unknown>;
    const keys = [
      "schema",
      "runId",
      "profileId",
      "phase",
      "pid",
      "workerStart",
      "ownerPid",
      "createdAt",
    ];
    return (
      JSON.stringify(r) === text &&
      Object.keys(value).length === keys.length &&
      keys.every((key) => Object.hasOwn(value, key)) &&
      value.schema === "mac-media-active.v1" &&
      value.phase === "issued" &&
      value.ownerPid === ownerPid &&
      value.pid === null &&
      value.workerStart === null &&
      typeof value.runId === "string" &&
      /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(
        value.runId,
      ) &&
      typeof value.profileId === "string" &&
      /^[a-f0-9]{64}$/.test(value.profileId) &&
      typeof value.createdAt === "string" &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.createdAt) &&
      Number.isFinite(Date.parse(value.createdAt))
    );
  } catch {
    return false;
  }
}
export function planIssuedInterruption(
  bytes: Uint8Array,
  ownerPid: number,
  mode: Mode,
  originalDeadline: number,
  now: number,
  target: boolean,
): IssuedPlan {
  if (
    !["deadline", "abort"].includes(mode) ||
    !Number.isFinite(originalDeadline) ||
    originalDeadline < 0 ||
    !Number.isFinite(now) ||
    now < 0 ||
    typeof target !== "boolean"
  )
    throw new Error("INVALID_SYNTHETIC_CONTEXT");
  if (!isOwnIssuedRecord(bytes, ownerPid)) return { observed: false };
  if (mode === "abort") return { observed: true, interrupt: "abort" };
  // Target initialization consumes the original budget. Never grant another 5s
  // at issued; legacy keeps its existing fixed 700ms persistence delay.
  return {
    observed: true,
    interrupt: "deadline",
    untilMonotonicMs: target ? originalDeadline + 200 : now + 700,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const mode = args[0];
  if (
    (mode !== "deadline" && mode !== "abort") ||
    (args.length !== 1 && args.length !== 2) ||
    (args.length === 2 &&
      !["--runtime-target=main", "--runtime-target=fixture"].includes(args[1]!))
  )
    throw new Error("INVALID_SYNTHETIC_MODE");
  const [
    { default: sharp },
    { CONTROL_ROOT },
    { runHarnessImage },
    { SANDBOX, RUNTIME_TARGET },
  ] = await Promise.all([
    import("sharp"),
    import("./control"),
    import("./launcher"),
    import("./policy"),
  ]);
  const originalSync = fs.fsyncSync;
  const originalSpawn = childProcess.spawn;
  let issuedObserved = false;
  let platformSpawns = 0;
  let originalDeadline: number | null = null;
  const abort = new AbortController();
  try {
    fs.fsyncSync = (fd: number) => {
      originalSync(fd);
      if (issuedObserved || originalDeadline === null) return;
      let read: number | undefined;
      try {
        read = fs.openSync(
          join(CONTROL_ROOT, "active.next"),
          fs.constants.O_RDONLY |
            fs.constants.O_NOFOLLOW |
            fs.constants.O_NONBLOCK,
        );
        const before = fs.fstatSync(read);
        const current = fs.fstatSync(fd);
        if (
          !before.isFile() ||
          !current.isFile() ||
          before.ino !== current.ino ||
          before.dev !== current.dev ||
          before.uid !== process.getuid?.() ||
          current.uid !== before.uid ||
          before.nlink !== 1 ||
          current.nlink !== 1 ||
          (before.mode & 0o777) !== 0o600 ||
          (current.mode & 0o777) !== 0o600 ||
          before.size < 1 ||
          before.size > 16384 ||
          before.size !== current.size
        )
          return;
        const bytes = Buffer.alloc(before.size);
        if (fs.readSync(read, bytes, 0, bytes.length, 0) !== bytes.length)
          return;
        const after = fs.fstatSync(read);
        if (
          before.size !== after.size ||
          before.mtimeMs !== after.mtimeMs ||
          before.ctimeMs !== after.ctimeMs
        )
          return;
        const plan = planIssuedInterruption(
          bytes,
          process.pid,
          mode,
          originalDeadline,
          performance.now(),
          RUNTIME_TARGET !== null,
        );
        if (!plan.observed) return;
        issuedObserved = true;
        if (plan.interrupt === "abort") abort.abort();
        else
          while (performance.now() < plan.untilMonotonicMs) {
            /* Deliberate synchronous fsync barrier. */
          }
      } catch {
        // Unrelated fsyncs and unmatched records are not an issued barrier.
      } finally {
        if (read !== undefined) fs.closeSync(read);
      }
    };
    childProcess.spawn = ((
      ...spawnArgs: Parameters<typeof childProcess.spawn>
    ) => {
      if (spawnArgs[0] === SANDBOX) platformSpawns++;
      return originalSpawn(...spawnArgs);
    }) as typeof childProcess.spawn;
    syncBuiltinESMExports();
    const bytes = await sharp({
      create: { width: 2, height: 2, channels: 3, background: "#668899" },
    })
      .png()
      .toBuffer();
    originalDeadline = initialIssuedDeadline(
      performance.now(),
      RUNTIME_TARGET !== null,
    );
    const result = await runHarnessImage(
      bytes,
      {
        path: "assets/synthetic.png",
        mediaType: "image/png",
        bytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex"),
        width: 2,
        height: 2,
      },
      { signal: abort.signal, deadlineMonotonicMs: originalDeadline },
    );
    const empty = fs.readdirSync(CONTROL_ROOT).length === 0;
    const code = result.outcome === "failed" ? result.code : null;
    const passed =
      issuedObserved &&
      platformSpawns === 0 &&
      result.outcome === "failed" &&
      code === (mode === "deadline" ? "DEADLINE_EXCEEDED" : "CANCELLED") &&
      result.stopped === "not-started" &&
      empty;
    process.stdout.write(
      JSON.stringify({
        schema: "mac-issued-deadline.v1",
        mode,
        issuedPersistenceObserved: issuedObserved,
        platformSpawns,
        outcome: result.outcome,
        code,
        stopped: result.stopped,
        controlEmpty: empty,
      }),
    );
    if (!passed) process.exitCode = 1;
  } finally {
    fs.fsyncSync = originalSync;
    childProcess.spawn = originalSpawn;
    syncBuiltinESMExports();
  }
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.stdout.on("error", () => {
    process.exitCode = 1;
  });
  void main().catch(() => {
    process.stdout.write(
      '{"schema":"mac-issued-deadline.v1","code":"HARNESS_FAILED"}',
    );
    process.exitCode = 1;
  });
}
