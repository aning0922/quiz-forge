// Closed real synchronous persistence delay/abort tests, no production fault knob.
import fs from "node:fs";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { CONTROL_ROOT } from "./control";
import { runHarnessImage } from "./launcher";
import { SANDBOX } from "./policy";
const originalSync = fs.fsyncSync,
  originalSpawn = childProcess.spawn;
const mode = process.argv[2];
let delayed = false,
  platformSpawns = 0;
const abort = new AbortController();
try {
  if (mode !== "deadline" && mode !== "abort")
    throw new Error("INVALID_SYNTHETIC_MODE");
  fs.fsyncSync = (fd: number) => {
    originalSync(fd);
    if (delayed) return;
    const p = join(CONTROL_ROOT, "active.next");
    let read: number | undefined;
    try {
      read = fs.openSync(
        p,
        fs.constants.O_RDONLY |
          fs.constants.O_NOFOLLOW |
          fs.constants.O_NONBLOCK,
      );
      const next = fs.fstatSync(read),
        current = fs.fstatSync(fd);
      if (
        !next.isFile() ||
        next.ino !== current.ino ||
        next.dev !== current.dev ||
        next.size > 16384
      )
        return;
      const b = Buffer.alloc(Number(next.size));
      if (fs.readSync(read, b, 0, b.length, 0) !== b.length) return;
      const r = JSON.parse(b.toString());
      if (r.phase !== "issued" || r.ownerPid !== process.pid) return;
      delayed = true;
      if (mode === "abort") abort.abort();
      else {
        const until = performance.now() + 700;
        while (performance.now() < until) {}
      }
    } catch {
      /* Other fsyncs are not the synthetic issued record. */
    } finally {
      if (read !== undefined) fs.closeSync(read);
    }
  };
  childProcess.spawn = ((...args: Parameters<typeof childProcess.spawn>) => {
    if (args[0] === SANDBOX) platformSpawns++;
    return originalSpawn(...args);
  }) as typeof childProcess.spawn;
  syncBuiltinESMExports();
  const b = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#668899" },
  })
    .png()
    .toBuffer();
  const r = await runHarnessImage(
    b,
    {
      path: "assets/synthetic.png",
      mediaType: "image/png",
      bytes: b.length,
      sha256: createHash("sha256").update(b).digest("hex"),
      width: 2,
      height: 2,
    },
    { signal: abort.signal, deadlineMonotonicMs: performance.now() + 500 },
  );
  const empty = fs.readdirSync(CONTROL_ROOT).length === 0;
  process.stdout.write(
    JSON.stringify({
      schema: "mac-issued-deadline.v1",
      mode,
      issuedPersistenceObserved: delayed,
      platformSpawns,
      outcome: r.outcome,
      code: r.outcome === "failed" ? r.code : null,
      stopped: r.stopped,
      controlEmpty: empty,
    }),
  );
} catch {
  process.stdout.write(
    '{"schema":"mac-issued-deadline.v1","code":"HARNESS_FAILED"}',
  );
  process.exitCode = 1;
} finally {
  fs.fsyncSync = originalSync;
  childProcess.spawn = originalSpawn;
  syncBuiltinESMExports();
}
