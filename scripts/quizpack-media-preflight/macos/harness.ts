import { createTrustedMediaRuntime } from "../../../src/features/quizpack/server/media/internal/runtime";
import {
  createMediaOperationContext,
  disposeMediaOperationContext,
} from "../../../src/features/quizpack/server/media/operation-context";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes, createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  appendFileSync,
  truncateSync,
  closeSync,
  openSync,
  constants,
  renameSync,
  existsSync,
  linkSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  rmdirSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import { createRequire } from "node:module";
const crc32 = createRequire(import.meta.url)("buffer-crc32") as (
  bytes: Buffer,
) => Buffer;
import { MEDIA_LIMITS, type ImageDeclaration } from "../shared/contracts";
import { parseWorkerOutput } from "../shared/output";
import { parseProbeOutput } from "../shared/probe-protocol";
import {
  CONTROL_ROOT,
  ensurePrivateDirectory,
  readControlForHarness,
} from "./control";
import {
  loadPolicy,
  MAC_ROOT,
  RUNTIME_TARGET,
  RUNTIME_ROOTS,
  MAC_PROBE,
  MAC_IDENTITY_HELPER,
  POSIX_PROBE,
  REPO_ROOT,
  SANDBOX,
  WORKER,
  policyComponentId,
  policySupported,
} from "./policy";
import {
  runHarnessCase,
  runIsolatedImage,
  runHarnessImage,
  runHarnessCandidateImage,
  type HarnessCase,
} from "./launcher";
import { emitFinalReport } from "./report";
import { sealCapabilityAfterChecks, readCapabilityBytes } from "./capability";
import { parseMacOutput, parseNativeIdentity } from "./protocol";
import {
  waitForOwnedSpawn,
  assertRetainedUnknownControl,
  waitForOwnedClose,
  waitForCrashReady,
} from "./owned-barriers";
import {
  checkDelayedOwnedTimer,
  checkRejectedTargetSeal,
} from "./matrix-checks";
function macValue(bytes: Uint8Array) {
  const p = parseMacOutput(bytes);
  requireTrue(p);
  return p!;
}
const FIXTURE = join(MAC_ROOT, "fixtures"),
  SOCKET = ".cache/quizpack-media-preflight/macos/fixtures/peer.sock";
const sentinel = Buffer.from("quizforge-synthetic-media-sentinel\n");
const results: { name: string; passed: boolean; details?: unknown }[] = [];
const runId = randomUUID(),
  runRoot = join(MAC_ROOT, "runs", runId);
const context = (ms = 5000, signal = new AbortController().signal) => ({
  signal,
  deadlineMonotonicMs: performance.now() + ms,
});
const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function declaration(
  b: Buffer,
  width: number,
  height: number,
  type: "png" | "jpeg" | "webp" = "png",
): ImageDeclaration {
  return {
    path: `assets/synthetic.${type === "jpeg" ? "jpg" : type}`,
    mediaType: `image/${type}`,
    bytes: b.length,
    sha256: digest(b),
    width,
    height,
  };
}
function fixedFailure() {
  throw new Error("SYNTHETIC_ASSERTION_FAILED");
}
function requireTrue(value: unknown) {
  if (!value) fixedFailure();
}
async function check(
  name: string,
  operation: () => Promise<unknown> | unknown,
) {
  try {
    const details = await operation();
    results.push({
      name,
      passed: true,
      ...(details === undefined ? {} : { details }),
    });
    console.log(
      JSON.stringify(
        RUNTIME_TARGET
          ? { case: name, passed: true }
          : { assertion: name, passed: true },
      ),
    );
  } catch {
    results.push({ name, passed: false });
    console.log(
      JSON.stringify(
        RUNTIME_TARGET
          ? { case: name, passed: false }
          : { assertion: name, passed: false },
      ),
    );
  }
}
function compile(source: string, target: string) {
  const r = spawnSync(
    "/usr/bin/cc",
    [
      "-std=c11",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-pthread",
      source,
      "-o",
      `${target}.next`,
    ],
    {
      cwd: REPO_ROOT,
      timeout: 10000,
      maxBuffer: 4096,
      env: { NODE_ENV: "production" },
    },
  );
  writeFileSync(
    join(
      runRoot,
      `${target === POSIX_PROBE ? "posix" : target === MAC_PROBE ? "mac" : "identity"}-compile.stderr`,
    ),
    r.stderr ?? Buffer.alloc(0),
    { flag: "wx", mode: 0o600 },
  );
  requireTrue(r.status === 0);
  chmodSync(`${target}.next`, 0o700);
  if (existsSync(target)) {
    const st = lstatSync(target);
    requireTrue(
      st.isFile() &&
        !st.isSymbolicLink() &&
        st.uid === process.getuid?.() &&
        (st.mode & 0o777) === 0o700,
    );
    unlinkSync(target);
  }
  linkSync(`${target}.next`, target);
  unlinkSync(`${target}.next`);
}
function baseline(
  executable: string,
  args: string[],
  stdio?: ("pipe" | "ignore" | number)[],
) {
  const r = spawnSync(executable, args, {
    cwd: REPO_ROOT,
    env: { NODE_ENV: "production" },
    timeout: 5000,
    maxBuffer: 2048,
    ...(stdio ? { stdio } : {}),
  });
  requireTrue(r.status === 0);
  return r.stdout;
}
async function probe(spec: HarnessCase, ms = 5000) {
  const r = await runHarnessCase(spec, context(ms));
  requireTrue(r.stopped === "confirmed" && r.code === null && r.exitCode === 0);
  return r;
}
function verifySentinels() {
  for (const zone of ["runtime", "admin", "PGDATA", "uploads"]) {
    requireTrue(readFileSync(join(FIXTURE, zone, "sentinel")).equals(sentinel));
    requireTrue(readdirSync(join(FIXTURE, zone)).join() === "sentinel");
    requireTrue(
      readFileSync(join(FIXTURE, `${zone}-hardlink/sentinel`)).equals(sentinel),
    );
    requireTrue(
      readdirSync(join(FIXTURE, `${zone}-hardlink`)).join() === "sentinel",
    );
  }
}
function privateWrite(path: string, bytes: Buffer | string) {
  writeFileSync(path, bytes, { mode: 0o600, flag: "wx" });
}
function paddingPNG(png: Buffer, desired: number) {
  const extra = desired - png.length;
  requireTrue(extra >= 12);
  const type = Buffer.from("qfST"),
    data = Buffer.alloc(extra - 12),
    head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  return Buffer.concat([
    png.subarray(0, -12),
    head,
    type,
    data,
    crc32(Buffer.concat([type, data])),
    png.subarray(-12),
  ]);
}
async function main() {
  ensurePrivateDirectory(runRoot);
  ensurePrivateDirectory(join(MAC_ROOT, "tools"));
  if (existsSync(CONTROL_ROOT) && readdirSync(CONTROL_ROOT).length)
    throw new Error("EXISTING_CONTROL_BLOCKS_HARNESS");
  requireTrue(!existsSync(FIXTURE));
  mkdirSync(FIXTURE, { mode: 0o700 });
  compile(
    resolve(REPO_ROOT, "scripts/quizpack-media-preflight/shared/posix-probe.c"),
    POSIX_PROBE,
  );
  compile(
    resolve(REPO_ROOT, "scripts/quizpack-media-preflight/macos/mac-probe.c"),
    MAC_PROBE,
  );
  if (!RUNTIME_TARGET) {
    compile(
      resolve(
        REPO_ROOT,
        "src/features/quizpack/server/media/internal/macos/identity-helper.c",
      ),
      MAC_IDENTITY_HELPER,
    );
  }
  const policy = loadPolicy();
  privateWrite(join(runRoot, "worker.sb"), policy.profile);
  privateWrite(join(runRoot, "identity.json"), JSON.stringify(policy.identity));
  for (const zone of ["runtime", "admin", "PGDATA", "uploads"]) {
    mkdirSync(join(FIXTURE, zone), { mode: 0o700 });
    privateWrite(join(FIXTURE, zone, "sentinel"), sentinel);
    symlinkSync(join(FIXTURE, zone), join(FIXTURE, `${zone}-symlink`));
    mkdirSync(join(FIXTURE, `${zone}-hardlink`), { mode: 0o700 });
    linkSync(
      join(FIXTURE, zone, "sentinel"),
      join(FIXTURE, `${zone}-hardlink/sentinel`),
    );
  }
  const small = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#668899" },
  })
    .png()
    .toBuffer();
  await check("policy identity stable across runIds and deadlines", () => {
    requireTrue(loadPolicy().profileId === policy.profileId);
    return {
      profileId: policy.profileId,
      platform: "macOS26.6.2/25G83 arm64",
      node: process.version,
      sharp: sharp.versions.sharp,
      vips: sharp.versions.vips,
    };
  });
  for (const type of ["png", "jpeg", "webp"] as const) {
    await check(`complete ${type} 64x48 decode`, async () => {
      const b = await sharp({
        create: { width: 64, height: 48, channels: 3, background: "#668899" },
      })
        [type]()
        .toBuffer();
      const r = await runHarnessImage(
        b,
        declaration(b, 64, 48, type),
        context(),
      );
      requireTrue(r.outcome === "decoded" && r.stopped === "confirmed");
      return { outcome: r.outcome, profileId: r.profileId };
    });
    await check(`complete ${type} 16MP boundary`, async () => {
      const b = await sharp({
        create: {
          width: 4000,
          height: 4000,
          channels: 3,
          background: "#668899",
        },
      })
        [type]()
        .toBuffer();
      const t = performance.now();
      const r = await runHarnessImage(
        b,
        declaration(b, 4000, 4000, type),
        context(),
      );
      requireTrue(r.outcome === "decoded" && r.stopped === "confirmed");
      return { elapsedMs: Math.round(performance.now() - t), bytes: b.length };
    });
  }
  await check("8192 exact dimension", async () => {
    const b = await sharp({
      create: { width: 8192, height: 1, channels: 3, background: "#668899" },
    })
      .png()
      .toBuffer();
    const r = await runHarnessImage(b, declaration(b, 8192, 1), context());
    requireTrue(r.outcome === "decoded");
  });
  await check("8MiB exact resource complete decode", async () => {
    const b = paddingPNG(small, MEDIA_LIMITS.bytes);
    const r = await runHarnessImage(b, declaration(b, 2, 2), context());
    requireTrue(r.outcome === "decoded");
  });
  await check(
    "+1 bytes/dimension/pixel-height rejected before launch",
    async () => {
      const b = paddingPNG(small, MEDIA_LIMITS.bytes + 1);
      for (const [bytes, d] of [
        [b, declaration(b, 2, 2)],
        [small, declaration(small, 8193, 1)],
        [small, declaration(small, 4000, 4001)],
      ] as const) {
        const r = await runHarnessImage(bytes, d, context());
        requireTrue(
          r.outcome === "failed" &&
            r.code === "INPUT_LIMIT" &&
            r.stopped === "not-started",
        );
      }
    },
  );
  await check(
    "bad pixels with intact signature and declared hash rejected",
    async () => {
      const b = Buffer.from(small);
      for (let off = 8; off + 12 <= b.length;) {
        const len = b.readUInt32BE(off);
        if (b.toString("ascii", off + 4, off + 8) === "IDAT") {
          b.fill(255, off + 8, off + 8 + len);
          crc32(b.subarray(off + 4, off + 8 + len)).copy(b, off + 8 + len);
          break;
        }
        off += len + 12;
      }
      const r = await runHarnessImage(b, declaration(b, 2, 2), context());
      requireTrue(
        r.outcome === "failed" &&
          r.code === "DECODE_REJECTED" &&
          r.stopped === "confirmed",
      );
    },
  );
  for (const zone of ["runtime", "admin", "PGDATA", "uploads"] as const)
    for (const alias of ["direct", "dots", "symlink", "hardlink"] as const) {
      await check(
        `native file open/link/rename/unlink ${zone} ${alias}`,
        async () => {
          const r = await probe({ kind: "files", zone, alias });
          const parsed = parseProbeOutput(r.output);
          requireTrue(parsed?.mode === "files");
          requireTrue(
            Object.entries(parsed ?? {})
              .filter(([, v]) => typeof v === "boolean")
              .every(([, v]) => v === true),
          );
          verifySentinels();
          return { stopped: r.stopped };
        },
      );
    }
  await check(
    "native normal thread allowed fork/spawn/vfork denied",
    async () => {
      const b = parseProbeOutput(baseline(POSIX_PROBE, ["process"]));
      requireTrue(
        b?.mode === "process" &&
          b.threadAllowed &&
          !b.forkDenied &&
          !b.spawnDenied,
      );
      const r = parseProbeOutput((await probe({ kind: "process" })).output);
      requireTrue(
        r?.mode === "process" &&
          r.threadAllowed &&
          r.forkDenied &&
          r.spawnDenied,
      );
      const v = macValue((await probe({ kind: "vfork" })).output);
      requireTrue(v.schema === "mac-probe.v1" && v.denied === true);
      const vb = macValue(baseline(MAC_PROBE, ["vfork"]));
      requireTrue(vb.denied === false);
    },
  );
  await check("same initial executable posix_spawn is denied", async () => {
    const b = macValue(baseline(MAC_PROBE, ["spawn-self"]));
    requireTrue(b.denied === false);
    const r = macValue((await probe({ kind: "spawn-self" })).output);
    requireTrue(r.denied === true);
    return {
      sameExecutableAllowedByExecLiteral: true,
      processCreationDenied: true,
    };
  });
  await check("kernel identity query errors cannot become absent", async () => {
    const r = spawnSync(MAC_PROBE, ["identity-query-failure"], {
      cwd: REPO_ROOT,
      env: { NODE_ENV: "production" },
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 1000,
      maxBuffer: 2048,
    });
    requireTrue(r.status === 70 && r.stdout.length === 0);
    const peer = await runHarnessCase({ kind: "identity-peer" }, context());
    requireTrue(peer.stopped === "confirmed");
    if (peer.exitCode === 0) {
      const v = parseNativeIdentity(peer.output);
      requireTrue(v?.present === true);
    } else requireTrue(peer.exitCode === 70 && peer.output.length === 0);
    return {
      invalidFlavorUnavailable: true,
      existingParentNeverReportedAbsent: true,
    };
  });
  for (const mode of ["deadline", "abort"] as const) {
    await check(`issued fsync ${mode} cannot launch after interruption`, () => {
      const r = spawnSync(
        process.execPath,
        [
          "--conditions=react-server",
          "--import",
          "tsx",
          resolve(
            REPO_ROOT,
            "scripts/quizpack-media-preflight/macos/deadline-host.ts",
          ),
          mode,
          ...(RUNTIME_TARGET ? [`--runtime-target=${RUNTIME_TARGET}`] : []),
        ],
        {
          cwd: REPO_ROOT,
          env: { NODE_ENV: "production" },
          stdio: ["pipe", "pipe", "pipe"],
          timeout: 12000,
          maxBuffer: 2048,
        },
      );
      requireTrue(r.status === 0);
      const v = JSON.parse(r.stdout.toString());
      requireTrue(
        v.schema === "mac-issued-deadline.v1" &&
          v.issuedPersistenceObserved === true &&
          v.platformSpawns === 0 &&
          v.outcome === "failed" &&
          v.code ===
            (mode === "deadline" ? "DEADLINE_EXCEEDED" : "CANCELLED") &&
          v.stopped === "not-started" &&
          v.controlEmpty === true,
      );
      return { platformSpawns: 0, stopped: v.stopped };
    });
  }
  await check(
    "full native FD scan and actual read/write on absent FD3",
    async () => {
      const r = parseProbeOutput((await probe({ kind: "fd" })).output);
      requireTrue(
        r?.mode === "fd" && r.scanComplete && r.noInheritedFileOrSocket,
      );
      const d = macValue((await probe({ kind: "fd-data" })).output);
      requireTrue(d.read === "closed" && d.write === "closed");
    },
  );
  const tcp = createServer((s) => s.end()),
    unix = createServer((s) => s.end());
  await new Promise<void>((res, rej) => {
    tcp.once("error", rej);
    tcp.listen(0, "127.0.0.1", res);
  });
  await new Promise<void>((res, rej) => {
    unix.once("error", rej);
    unix.listen(SOCKET, res);
  });
  const addr = tcp.address();
  requireTrue(addr && typeof addr !== "string");
  const port = (addr as { port: number }).port;
  await check("native real TCP/Unix peers and bind/listen denial", async () => {
    const b = parseProbeOutput(
      baseline(POSIX_PROBE, ["network", String(port), SOCKET]),
    );
    requireTrue(
      b?.mode === "network" &&
        b.connect === "allowed" &&
        b.bind === "allowed" &&
        b.listen === "allowed" &&
        b.unix === "allowed",
    );
    const r = parseProbeOutput((await probe({ kind: "network", port })).output);
    requireTrue(
      r?.mode === "network" &&
        r.connect === "operation-denied" &&
        r.bind === "operation-denied" &&
        r.listen === "prerequisite-denied" &&
        r.unix === "operation-denied",
    );
    const direct = macValue((await probe({ kind: "listen" })).output);
    requireTrue(direct.listen === "denied");
    return {
      connect: "EPERM/EACCES",
      bind: "EPERM/EACCES",
      listenAfterDeniedBind: "not-run",
      directUnboundListen: "EPERM/EACCES",
      unix: "EPERM/EACCES",
    };
  });
  await Promise.all([
    new Promise<void>((res) => tcp.close(() => res())),
    new Promise<void>((res) => unix.close(() => res())),
  ]);
  const nonce = randomBytes(8).toString("hex"),
    service = `org.quizforge.media.${nonce}`,
    shm = `/qf-${nonce}`;
  const server = spawn(MAC_PROBE, ["server", service], {
    env: { NODE_ENV: "production" },
    cwd: REPO_ROOT,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let serverReady = false;
  await new Promise<void>((res) => {
    const t = setTimeout(res, 1000);
    server.stdout.once("data", (b) => {
      serverReady = b.toString() === '{"schema":"mac-service.v1","ready":true}';
      clearTimeout(t);
      res();
    });
    server.once("close", () => {
      clearTimeout(t);
      res();
    });
  });
  let shmCreated = false;
  await check(
    "native synthetic Mach/shm/signal delegation denied",
    async () => {
      requireTrue(serverReady && server.pid);
      const create = macValue(baseline(MAC_PROBE, ["shm-create", shm]));
      shmCreated = create.created === true;
      requireTrue(shmCreated);
      const b = macValue(
        baseline(MAC_PROBE, ["ipc", service, shm, String(server.pid)]),
      );
      requireTrue(
        b.machLookup === "allowed" &&
          b.sharedMemory === "allowed" &&
          b.peerSignal === "allowed",
      );
      const r = macValue(
        (await probe({ kind: "ipc", nonce, peerPid: server.pid! })).output,
      );
      requireTrue(
        r.machLookup === "denied" &&
          r.sharedMemory === "denied" &&
          r.peerSignal === "denied",
      );
      return {
        machLookup: r.machLookup,
        sharedMemory: r.sharedMemory,
        peerSignal: r.peerSignal,
      };
    },
  );
  if (shmCreated) baseline(MAC_PROBE, ["shm-remove", shm]);
  if (server.exitCode === null && server.signalCode === null) {
    const settled = new Promise<void>((res) =>
      server.once("close", () => res()),
    );
    server.stdin.end("x");
    await settled;
  }
  for (const scenario of [
    "stdout",
    "stderr",
    "invalid",
    "multiple",
    "extra",
    "bom",
    "nonzero",
    "crash",
    "success-hang",
    "backpressure",
  ] as const) {
    await check(`bounded fault ${scenario}`, async () => {
      const r = await runHarnessCase(
        { kind: "fault", scenario },
        context(
          scenario === "success-hang" || scenario === "backpressure"
            ? 500
            : 5000,
        ),
      );
      requireTrue(r.stopped === "confirmed");
      const parsed = parseWorkerOutput(r.output, declaration(small, 2, 2));
      requireTrue(r.code !== null || !parsed.ok);
      if (scenario === "success-hang" || scenario === "backpressure")
        requireTrue(r.code === "DEADLINE_EXCEEDED");
      return {
        code: r.code ?? (parsed.ok ? "INVALID_TEST" : parsed.code),
        stopped: r.stopped,
        elapsedMs: Math.round(r.elapsedMs),
      };
    });
  }
  await check("pre-start cancel and expired absolute deadline", async () => {
    const abort = new AbortController();
    abort.abort();
    const a = await runHarnessImage(
      small,
      declaration(small, 2, 2),
      context(5000, abort.signal),
    );
    requireTrue(
      a.outcome === "failed" &&
        a.code === "CANCELLED" &&
        a.stopped === "not-started",
    );
    const d = await runHarnessImage(
      small,
      declaration(small, 2, 2),
      context(-1),
    );
    requireTrue(
      d.outcome === "failed" &&
        d.code === "DEADLINE_EXCEEDED" &&
        d.stopped === "not-started",
    );
  });
  await check(
    "repeated abort stops actual worker and settles stdio",
    async () => {
      const a = new AbortController();
      const p = runHarnessCase(
        { kind: "fault", scenario: "success-hang" },
        context(5000, a.signal),
      );
      setTimeout(() => {
        a.abort();
        a.abort();
      }, 100);
      const r = await p;
      requireTrue(r.code === "CANCELLED" && r.stopped === "confirmed");
    },
  );
  await check(
    "second call rejected BUSY by persistent control guard",
    async () => {
      requireTrue(readdirSync(CONTROL_ROOT).length === 0);
      const expectedProfileId = loadPolicy("fault").profileId;
      const abort = new AbortController(),
        ctx = context(5000, abort.signal);
      const p = runHarnessCase(
        { kind: "fault", scenario: "success-hang" },
        ctx,
      );
      void p.catch(() => undefined);
      let before: Awaited<ReturnType<typeof waitForOwnedSpawn>> | undefined;
      try {
        before = await waitForOwnedSpawn(
          p,
          process.pid,
          expectedProfileId,
          ctx.deadlineMonotonicMs,
        );
        // The normal target verifies the complete build before checking BUSY;
        // both calls retain this original absolute deadline.
        const r = await runHarnessImage(small, declaration(small, 2, 2), ctx);
        requireTrue(
          r.outcome === "failed" &&
            r.code === "BUSY" &&
            r.stopped === "not-started",
        );
        const saved = readControlForHarness();
        requireTrue(
          saved.phase === "spawned" &&
            saved.runId === before.runId &&
            saved.profileId === before.profileId &&
            saved.ownerPid === before.ownerPid &&
            saved.pid === before.pid &&
            saved.workerStart?.sec === before.workerStart?.sec &&
            saved.workerStart?.usec === before.workerStart?.usec,
        );
      } finally {
        // Barrier and BUSY failures must still drain this exact invocation.
        abort.abort();
        const stopped = await p;
        requireTrue(
          stopped.stopped === "confirmed" &&
            stopped.code === "CANCELLED" &&
            stopped.workerObserved &&
            stopped.profileId === expectedProfileId &&
            (!before || stopped.runId === before.runId),
        );
      }
    },
  );
  await check(
    "event-loop timer delayed cannot produce late success",
    checkDelayedOwnedTimer,
  );
  await check("sandbox-exec execs fixed worker in same owned PID", async () => {
    const r = await runHarnessCase(
      { kind: "fault", scenario: "identity-hang" },
      context(500),
    );
    const v = JSON.parse(r.output.toString());
    requireTrue(
      r.workerObserved &&
        v.parentPid === process.pid &&
        r.stopped === "confirmed" &&
        r.code === "DEADLINE_EXCEEDED",
    );
    return { sameOwnedPIDObserved: true, workerObserved: r.workerObserved };
  });
  for (const kind of [
    "malformed",
    "oversize",
    "symlink",
    "guard",
    "partial",
    "fifo",
  ] as const) {
    await check(`restart blocks ${kind} control state`, async () => {
      ensurePrivateDirectory(CONTROL_ROOT);
      const path = join(
        CONTROL_ROOT,
        kind === "partial"
          ? "active.next"
          : kind === "guard"
            ? "guard"
            : "active.json",
      );
      if (kind === "guard") mkdirSync(path, { mode: 0o700 });
      else if (kind === "fifo")
        requireTrue(
          spawnSync("/usr/bin/mkfifo", ["-m", "600", path], {
            env: { NODE_ENV: "production" },
            timeout: 1000,
            stdio: "ignore",
          }).status === 0,
        );
      else if (kind === "symlink")
        symlinkSync(join(FIXTURE, "runtime/sentinel"), path);
      else
        privateWrite(
          path,
          kind === "oversize" ? Buffer.alloc(16385) : "incomplete",
        );
      try {
        const r = await runHarnessImage(
          small,
          declaration(small, 2, 2),
          context(),
        );
        requireTrue(
          r.outcome === "failed" &&
            r.stopped === "not-started" &&
            (r.code === "BUSY" || r.code === "ISOLATION_UNAVAILABLE"),
        );
        requireTrue(existsSync(path));
        verifySentinels();
      } finally {
        if (kind === "guard") rmdirSync(path);
        else unlinkSync(path);
      }
    });
  }

  await check(
    "native FD300 injection is detected and ordinary launcher inherits none",
    async () => {
      const fd = openSync(
        join(FIXTURE, "runtime/sentinel"),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const normal = parseProbeOutput((await probe({ kind: "fd" })).output);
        requireTrue(
          normal?.mode === "fd" &&
            normal.scanComplete &&
            normal.noInheritedFileOrSocket,
        );
        const stdio: ("pipe" | "ignore" | number)[] = Array.from(
          { length: 301 },
          () => "ignore",
        );
        stdio[0] = "pipe";
        stdio[1] = "pipe";
        stdio[2] = "pipe";
        stdio[300] = fd;
        const p = loadPolicy("posix");
        const r = spawnSync(SANDBOX, ["-p", p.profile, POSIX_PROBE, "fd"], {
          cwd: REPO_ROOT,
          env: { NODE_ENV: "production" },
          stdio,
          timeout: 5000,
          maxBuffer: 2048,
        });
        requireTrue(r.status === 0);
        const injected = parseProbeOutput(r.stdout);
        requireTrue(
          injected?.mode === "fd" &&
            injected.scanComplete &&
            !injected.noInheritedFileOrSocket,
        );
        verifySentinels();
        return {
          deliberateReadOnlyFD300Detected: true,
          normalLauncherInheritsNone: true,
        };
      } finally {
        closeSync(fd);
      }
    },
  );
  await check(
    "host inherited FD300 is absent in the actual fixed launcher worker",
    async () => {
      const fd = openSync(
        join(FIXTURE, "runtime/sentinel"),
        constants.O_RDONLY | constants.O_NOFOLLOW,
      );
      try {
        const stdio: ("pipe" | "ignore" | number)[] = Array.from(
          { length: 301 },
          () => "ignore",
        );
        stdio[0] = "pipe";
        stdio[1] = "pipe";
        stdio[2] = "pipe";
        stdio[300] = fd;
        const r = spawnSync(
          process.execPath,
          [
            "--conditions=react-server",
            "--import",
            "tsx",
            resolve(
              REPO_ROOT,
              "scripts/quizpack-media-preflight/macos/fd-host.ts",
            ),
            ...(RUNTIME_TARGET ? [`--runtime-target=${RUNTIME_TARGET}`] : []),
          ],
          {
            cwd: REPO_ROOT,
            env: { NODE_ENV: "production" },
            stdio,
            timeout: 6000,
            maxBuffer: 2048,
          },
        );
        requireTrue(r.status === 0);
        const v = JSON.parse(r.stdout.toString());
        requireTrue(
          Object.keys(v).join() ===
            "schema,sourceFD300Present,stopped,workerScanComplete,workerNoExtraFD" &&
            v.schema === "mac-fd-host.v1" &&
            v.sourceFD300Present === true &&
            v.stopped === "confirmed" &&
            v.workerScanComplete === true &&
            v.workerNoExtraFD === true,
        );
        verifySentinels();
        return {
          actualHostFD300Present: true,
          actualWorkerFD300Absent: true,
          stopped: "confirmed",
        };
      } finally {
        closeSync(fd);
      }
    },
  );
  await check("credential environment is not inherited", async () => {
    const key = `QUIZFORGE_SYNTHETIC_${runId.replaceAll("-", "")}`;
    process.env[key] = "synthetic";
    try {
      const r = await probe({ kind: "fault", scenario: "environment" });
      const v = JSON.parse(r.output.toString());
      requireTrue(Array.isArray(v.keys) && v.keys.join() === "NODE_ENV");
    } finally {
      delete process.env[key];
    }
  });
  await check(
    "unknown stop keeps guard and blocks restart after late close",
    async () => {
      requireTrue(readdirSync(CONTROL_ROOT).length === 0);
      const abort = new AbortController(),
        ctx = context(5000, abort.signal);
      const expectedProfileId = loadPolicy("fault").profileId;
      const pending = runHarnessCase(
        { kind: "fault", scenario: "unknown-stop" },
        ctx,
      );
      void pending.catch(() => undefined);
      const held = join(runRoot, "mac-probe-held");
      let helperHeld = false,
        result: Awaited<ReturnType<typeof runHarnessCase>> | undefined,
        lateCloseDeadline: number | undefined;
      try {
        const before = await waitForOwnedSpawn(
          pending,
          process.pid,
          expectedProfileId,
          ctx.deadlineMonotonicMs,
        );
        renameSync(MAC_IDENTITY_HELPER, held);
        helperHeld = true;
        try {
          result = await pending;
        } finally {
          renameSync(held, MAC_IDENTITY_HELPER);
          helperHeld = false;
        }
        requireTrue(
          result.stopped === "unknown" && result.code === "STOP_UNCONFIRMED",
        );
        const blocked = await runHarnessImage(
          small,
          declaration(small, 2, 2),
          context(),
        );
        requireTrue(
          blocked.outcome === "failed" &&
            blocked.code === "BUSY" &&
            blocked.stopped === "not-started",
        );
        const saved = readControlForHarness();
        // UNKNOWN is an outcome; the original cleanup budget may forbid another phase write.
        assertRetainedUnknownControl(before, saved, result);
        lateCloseDeadline = performance.now() + 10000;
        await waitForOwnedClose(result.lateClose, lateCloseDeadline);
        requireTrue(
          JSON.stringify(readControlForHarness()) === JSON.stringify(saved),
        );
        requireTrue(
          readdirSync(CONTROL_ROOT).sort().join() === "active.json,guard",
        );
        privateWrite(
          join(runRoot, "unknown-control.json"),
          JSON.stringify(saved),
        );
        // Exact live ChildProcess close/stdio is a later fixture-maintenance fact, never an original stop receipt.
        unlinkSync(join(CONTROL_ROOT, "active.json"));
        rmdirSync(join(CONTROL_ROOT, "guard"));
        return {
          returnedStopped: "unknown",
          lateActualCloseObserved: true,
          noAutomaticRecordCleanup: true,
          restartBlocked: true,
          receiptWritten: false,
          elapsedMs: Math.round(result.elapsedMs),
        };
      } finally {
        if (helperHeld) renameSync(held, MAC_IDENTITY_HELPER);
        if (!result) {
          abort.abort();
          result = await pending;
        }
        if (result.stopped === "unknown") {
          lateCloseDeadline ??= performance.now() + 10000;
          await waitForOwnedClose(result.lateClose, lateCloseDeadline);
        }
      }
    },
  );
  // Drain failure stops this matrix before creating any dependent producer.
  requireTrue(
    results.at(-1)?.passed === true && readdirSync(CONTROL_ROOT).length === 0,
  );
  await check(
    "parent crash leaves persisted worker identity and restart blocked",
    async () => {
      requireTrue(readdirSync(CONTROL_ROOT).length === 0);
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
        const ready = await waitForCrashReady(host, performance.now() + 12000);
        requireTrue(
          host.pid &&
            ready.ownerPid === host.pid &&
            ready.profileId === expectedProfileId,
        );
        const saved = readControlForHarness();
        requireTrue(
          saved.ownerPid === ready.ownerPid &&
            saved.runId === ready.runId &&
            saved.profileId === ready.profileId &&
            saved.pid === ready.workerPid &&
            saved.workerStart?.sec === ready.workerStart.sec &&
            saved.workerStart?.usec === ready.workerStart.usec,
        );
        requireTrue(host.kill("SIGKILL"));
        await waitForOwnedClose(hostClosed, performance.now() + 5000);
        const blocked = await runHarnessImage(
          small,
          declaration(small, 2, 2),
          context(),
        );
        requireTrue(
          blocked.outcome === "failed" &&
            blocked.code === "BUSY" &&
            blocked.stopped === "not-started",
        );
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
          requireTrue(value);
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
        const owner = parseNativeIdentity(
          baseline(MAC_IDENTITY_HELPER, [
            "identity",
            String(saved.ownerPid),
            String(saved.ownerPid),
            policy.node,
          ]),
        );
        requireTrue(
          owner?.present === false &&
            originalGone &&
            JSON.stringify(readControlForHarness()) === JSON.stringify(saved),
        );
        privateWrite(
          join(runRoot, "crash-control.json"),
          JSON.stringify(saved),
        );
        unlinkSync(join(CONTROL_ROOT, "active.json"));
        rmdirSync(join(CONTROL_ROOT, "guard"));
        return {
          ownedParentKilled: true,
          ownedParentCloseObserved: true,
          originalWorkerIdentityGone: true,
          restartBlocked: true,
          receiptWritten: false,
        };
      } finally {
        if (
          !closed &&
          host.pid &&
          host.exitCode === null &&
          host.signalCode === null
        )
          host.kill("SIGKILL");
        await waitForOwnedClose(hostClosed, performance.now() + 5000);
      }
    },
  );
  requireTrue(
    results.at(-1)?.passed === true && readdirSync(CONTROL_ROOT).length === 0,
  );
  await check(
    "unsupported Node metadata is closed before platform operation",
    async () => {
      const descriptor = Object.getOwnPropertyDescriptor(process, "version");
      requireTrue(descriptor);
      try {
        Object.defineProperty(process, "version", {
          ...descriptor,
          value: "v20.20.2",
        });
        const r = await runHarnessImage(
          small,
          declaration(small, 2, 2),
          context(),
        );
        requireTrue(
          r.outcome === "failed" &&
            r.code === "UNSUPPORTED_PLATFORM" &&
            r.stopped === "not-started",
        );
      } finally {
        Object.defineProperty(process, "version", descriptor!);
      }
      return {
        test: "synthetic metadata override; not a second actual Node installation",
      };
    },
  );
  await check(
    "missing control helper does not launch or fall back",
    async () => {
      const held = join(runRoot, "helper-missing");
      renameSync(MAC_IDENTITY_HELPER, held);
      try {
        const r = await runHarnessImage(
          small,
          declaration(small, 2, 2),
          context(),
        );
        requireTrue(
          r.outcome === "failed" &&
            r.code === "ISOLATION_UNAVAILABLE" &&
            r.stopped === "not-started",
        );
      } finally {
        renameSync(held, MAC_IDENTITY_HELPER);
      }
    },
  );
  await check("kernel peak RSS two fresh workers per 16MP format", async () => {
    const measurements: Record<string, unknown> = {};
    for (const type of ["png", "jpeg", "webp"] as const) {
      const b = await sharp({
        create: {
          width: 4000,
          height: 4000,
          channels: 3,
          background: "#668899",
        },
      })
        [type]()
        .toBuffer();
      const samples: { kernelPeakRSSBytes: number; elapsedMs: number }[] = [];
      for (let i = 0; i < 2; i++) {
        const start = performance.now();
        const r = spawnSync(
          "/usr/bin/time",
          [
            "-l",
            SANDBOX,
            "-p",
            policy.profile,
            policy.node,
            WORKER,
            "8388608",
            "8192",
            "16000000",
          ],
          {
            cwd: REPO_ROOT,
            env: { NODE_ENV: "production" },
            input: b,
            timeout: 5000,
            maxBuffer: 4096,
          },
        );
        privateWrite(
          join(runRoot, `rss-${type}-${i}.stderr`),
          r.stderr ?? Buffer.alloc(0),
        );
        requireTrue(
          r.status === 0 &&
            parseWorkerOutput(r.stdout, declaration(b, 4000, 4000, type)).ok,
        );
        const match = r.stderr
          .toString()
          .match(/(\d+)\s+maximum resident set size/);
        requireTrue(match);
        samples.push({
          kernelPeakRSSBytes: Number(match?.[1]),
          elapsedMs: Math.round(performance.now() - start),
        });
      }
      measurements[type] = samples;
    }
    return {
      measurements,
      nativeRSSHardLimit: false,
      measurement:
        "trusted time -l observes same-PID exec; each worker fresh; OS cache not reset",
    };
  });
  verifySentinels();
  requireTrue(readdirSync(CONTROL_ROOT).length === 0);
  rmSync(FIXTURE, { recursive: true });

  const candidateComponentId = policyComponentId(policy);
  privateWrite(
    join(runRoot, "provisional-capability.json"),
    JSON.stringify({
      schema: "mac-media-capability.v1",
      componentId: candidateComponentId,
    }),
  );
  await check(
    "failed final capability check preserves prior seal",
    async () => {
      if (RUNTIME_TARGET) return checkRejectedTargetSeal();
      const previous = readCapabilityBytes();
      requireTrue(
        sealCapabilityAfterChecks(false, candidateComponentId) === false,
      );
      requireTrue(readCapabilityBytes().equals(previous));
      return { ordinaryCapabilityUntouched: true };
    },
  );
  await check("public API requires frozen component identity", async () => {
    const actual = loadPolicy();
    let priorSupported = policySupported(actual);
    if (RUNTIME_TARGET) {
      const operation = createMediaOperationContext(context());
      try {
        priorSupported =
          (
            await createTrustedMediaRuntime(RUNTIME_ROOTS).readBinding(
              operation,
              "sealed",
            )
          ).outcome === "bound";
      } finally {
        disposeMediaOperationContext(operation);
      }
    }
    const ordinary = await runIsolatedImage(
      small,
      declaration(small, 2, 2),
      context(),
    );
    requireTrue(
      priorSupported
        ? ordinary.outcome === "decoded"
        : ordinary.outcome === "failed" &&
            ordinary.code === "ISOLATION_UNAVAILABLE" &&
            ordinary.stopped === "not-started",
    );
    const r = await runHarnessCandidateImage(
      small,
      declaration(small, 2, 2),
      context(),
      candidateComponentId,
    );
    requireTrue(r.outcome === "decoded" && r.stopped === "confirmed");
    const originalSize = lstatSync(MAC_IDENTITY_HELPER).size;
    try {
      appendFileSync(MAC_IDENTITY_HELPER, Buffer.from([0]));
      const changed = await runHarnessCandidateImage(
        small,
        declaration(small, 2, 2),
        context(),
        candidateComponentId,
      );
      requireTrue(
        changed.outcome === "failed" &&
          changed.code === "ISOLATION_UNAVAILABLE" &&
          changed.stopped === "not-started",
      );
    } finally {
      truncateSync(MAC_IDENTITY_HELPER, originalSize);
    }
    try {
      chmodSync(MAC_IDENTITY_HELPER, 0o600);
      const changed = await runHarnessCandidateImage(
        small,
        declaration(small, 2, 2),
        context(),
        candidateComponentId,
      );
      requireTrue(
        changed.outcome === "failed" &&
          changed.code === "ISOLATION_UNAVAILABLE" &&
          changed.stopped === "not-started",
      );
    } finally {
      chmodSync(MAC_IDENTITY_HELPER, 0o700);
    }
    const altered = {
      ...actual,
      identity: { ...actual.identity, nodeSha256: "0".repeat(64) },
    };
    requireTrue(policyComponentId(altered) !== candidateComponentId);
    return {
      componentId: policyComponentId(actual),
      profileId: actual.profileId,
    };
  });
  const profiles = {
    worker: loadPolicy().profileId,
    posix: loadPolicy("posix").profileId,
    mac: loadPolicy("mac").profileId,
    fault: loadPolicy("fault").profileId,
  };
  const finalResidual = readdirSync(CONTROL_ROOT);
  requireTrue(finalResidual.length === 0);
  const allChecksPassed = results.every((r) => r.passed);
  const finalLog = JSON.stringify({
    matrix: "mac-media-matrix.v1",
    passed: allChecksPassed,
    assertions: results.length,
    failed: results.filter((r) => !r.passed).map((r) => r.name),
    profileId: policy.profileId,
    residualControlEntries: finalResidual.length,
  });
  privateWrite(
    join(runRoot, "summary.json"),
    JSON.stringify({
      schema: "mac-media-matrix.v1",
      profileId: policy.profileId,
      componentId: policyComponentId(policy),
      profiles,
      results,
      residualControlEntries: finalResidual,
      passed: allChecksPassed,
    }),
  );
  if (RUNTIME_TARGET) {
    const bounded = {
      schema: "quizpack-media-owned-matrix.v1",
      matrix: "macos",
      target: RUNTIME_TARGET,
      completed: allChecksPassed,
      cases: results.map(({ name, passed }) => ({ id: name, passed })),
      profiles: {
        normal: profiles.worker,
        fault: profiles.fault,
        posixProbe: profiles.posix,
        macProbe: profiles.mac,
      },
      ownedOperationsStopped: allChecksPassed && finalResidual.length === 0,
      residualControlEntries: Math.min(16, finalResidual.length),
    };
    process.stdout.write(JSON.stringify(bounded) + "\n");
    if (!allChecksPassed) process.exitCode = 1;
    return;
  }
  let capabilityCommitted = false;
  if (allChecksPassed && process.argv.includes("--record-capability"))
    capabilityCommitted = sealCapabilityAfterChecks(true, candidateComponentId);
  // No directory reads, assertions or summary construction after the commit point.
  // Reporting failure preserves the committed outcome and its prewritten private evidence.
  await emitFinalReport(process.stdout, finalLog, capabilityCommitted);
  if (!allChecksPassed) process.exitCode = 1;
}
main().catch(() => {
  if (existsSync(runRoot) && !existsSync(join(runRoot, "summary.json"))) {
    try {
      privateWrite(
        join(runRoot, "summary.json"),
        JSON.stringify({
          schema: "mac-media-matrix.v1",
          passed: false,
          code: "HARNESS_FAILED",
          results,
        }),
      );
    } catch {}
  }
  console.log(
    JSON.stringify({
      matrix: "mac-media-matrix.v1",
      passed: false,
      code: "HARNESS_FAILED",
      completedAssertions: results.length,
    }),
  );
  process.exitCode = 1;
});
