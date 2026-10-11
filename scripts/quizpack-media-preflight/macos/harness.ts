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
  MAC_PROBE,
  POSIX_PROBE,
  REPO_ROOT,
  SANDBOX,
  WORKER,
  CAPABILITY_FILE,
  policyComponentId,
  policySupported,
} from "./policy";
import {
  runHarnessCase,
  runIsolatedImage,
  runHarnessImage,
  type HarnessCase,
} from "./launcher";
import { parseMacOutput, parseNativeIdentity } from "./protocol";
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
    console.log(JSON.stringify({ assertion: name, passed: true }));
  } catch {
    results.push({ name, passed: false });
    console.log(JSON.stringify({ assertion: name, passed: false }));
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
    join(runRoot, `${target === POSIX_PROBE ? "posix" : "mac"}-compile.stderr`),
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
      const p = runHarnessCase(
        { kind: "fault", scenario: "success-hang" },
        context(800),
      );
      const r = await runHarnessImage(
        small,
        declaration(small, 2, 2),
        context(),
      );
      requireTrue(
        r.outcome === "failed" &&
          r.code === "BUSY" &&
          r.stopped === "not-started",
      );
      requireTrue((await p).stopped === "confirmed");
    },
  );
  await check(
    "event-loop timer delayed cannot produce late success",
    async () => {
      const p = runHarnessImage(small, declaration(small, 2, 2), context(500));
      const until = performance.now() + 800;
      while (performance.now() < until) {}
      const r = await p;
      requireTrue(
        r.outcome === "failed" &&
          r.code === "DEADLINE_EXCEEDED" &&
          r.stopped === "confirmed",
      );
    },
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
            "--import",
            "tsx",
            resolve(
              REPO_ROOT,
              "scripts/quizpack-media-preflight/macos/fd-host.ts",
            ),
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
      const pending = runHarnessCase(
        { kind: "fault", scenario: "unknown-stop" },
        context(800),
      );
      await new Promise((res) => setTimeout(res, 100));
      const before = readControlForHarness();
      requireTrue(
        before.ownerPid === process.pid && before.workerStart && before.pid,
      );
      const held = join(runRoot, "mac-probe-held");
      renameSync(MAC_PROBE, held);
      let r: Awaited<ReturnType<typeof runHarnessCase>>;
      try {
        r = await pending;
      } finally {
        renameSync(held, MAC_PROBE);
      }
      requireTrue(r.stopped === "unknown" && r.code === "STOP_UNCONFIRMED");
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
      requireTrue(
        saved.runId === r.runId &&
          saved.phase === "unknown" &&
          saved.workerStart?.sec === before.workerStart?.sec &&
          saved.workerStart?.usec === before.workerStart?.usec,
      );
      await Promise.race([
        r.lateClose,
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error("LATE_STOP_UNCONFIRMED")), 3000),
        ),
      ]);
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
      // Explicit harness-only cleanup follows this exact live ChildProcess close/stdio proof.
      unlinkSync(join(CONTROL_ROOT, "active.json"));
      rmdirSync(join(CONTROL_ROOT, "guard"));
      return {
        returnedStopped: "unknown",
        lateActualCloseObserved: true,
        noAutomaticRecordCleanup: true,
        restartBlocked: true,
        receiptWritten: false,
        elapsedMs: Math.round(r.elapsedMs),
      };
    },
  );
  await check(
    "parent crash leaves persisted worker identity and restart blocked",
    async () => {
      const host = spawn(
        process.execPath,
        [
          "--import",
          "tsx",
          resolve(
            REPO_ROOT,
            "scripts/quizpack-media-preflight/macos/crash-host.ts",
          ),
        ],
        {
          cwd: REPO_ROOT,
          env: { NODE_ENV: "production" },
          stdio: ["pipe", "pipe", "pipe"],
        },
      );
      const hostClosed = new Promise<void>((res) =>
        host.once("close", () => res()),
      );
      let ready = false;
      await new Promise<void>((res) => {
        const t = setTimeout(res, 2000);
        host.stdout.once("data", (b) => {
          ready = b.toString() === '{"ready":true}';
          clearTimeout(t);
          res();
        });
        host.stderr.on("data", () => {});
        host.once("close", () => {
          clearTimeout(t);
          res();
        });
      });
      requireTrue(ready && host.pid);
      const saved = readControlForHarness();
      requireTrue(
        saved.ownerPid === host.pid && saved.pid && saved.workerStart,
      );
      host.kill("SIGKILL");
      await hostClosed;
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
      const until = performance.now() + 4000;
      let originalGone = false;
      while (performance.now() < until) {
        const v = parseNativeIdentity(
          baseline(MAC_PROBE, [
            "identity",
            String(saved.pid),
            String(saved.ownerPid),
            policy.node,
          ]),
        );
        requireTrue(v);
        if (
          !v?.present ||
          v.startSec !== saved.workerStart?.sec ||
          v.startUsec !== saved.workerStart?.usec
        ) {
          originalGone = true;
          break;
        }
        await new Promise((res) => setTimeout(res, 100));
      }
      requireTrue(
        originalGone &&
          JSON.stringify(readControlForHarness()) === JSON.stringify(saved),
      );
      privateWrite(join(runRoot, "crash-control.json"), JSON.stringify(saved));
      // This harness created the parent and exact worker identity. Kernel identity is gone,
      // descendants were denied and owned parent stdio settled. No launcher receipt is invented.
      unlinkSync(join(CONTROL_ROOT, "active.json"));
      rmdirSync(join(CONTROL_ROOT, "guard"));
      return {
        ownedParentKilled: true,
        originalWorkerIdentityGone: true,
        restartBlocked: true,
        receiptWritten: false,
      };
    },
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
      renameSync(MAC_PROBE, held);
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
        renameSync(held, MAC_PROBE);
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

  if (
    results.every((r) => r.passed) &&
    process.argv.includes("--record-capability")
  ) {
    const st = lstatSync(CAPABILITY_FILE);
    requireTrue(
      st.isFile() && !st.isSymbolicLink() && st.uid === process.getuid?.(),
    );
    writeFileSync(
      CAPABILITY_FILE,
      JSON.stringify({
        schema: "mac-media-capability.v1",
        componentId: policyComponentId(policy),
      }) + "\n",
    );
  }
  await check("public API requires frozen component identity", async () => {
    const actual = loadPolicy();
    requireTrue(policySupported(actual));
    const r = await runIsolatedImage(
      small,
      declaration(small, 2, 2),
      context(),
    );
    requireTrue(r.outcome === "decoded" && r.stopped === "confirmed");
    const originalSize = lstatSync(MAC_PROBE).size;
    try {
      appendFileSync(MAC_PROBE, Buffer.from([0]));
      const changed = await runIsolatedImage(
        small,
        declaration(small, 2, 2),
        context(),
      );
      requireTrue(
        changed.outcome === "failed" &&
          changed.code === "ISOLATION_UNAVAILABLE" &&
          changed.stopped === "not-started",
      );
    } finally {
      truncateSync(MAC_PROBE, originalSize);
    }
    try {
      chmodSync(MAC_PROBE, 0o600);
      const changed = await runIsolatedImage(
        small,
        declaration(small, 2, 2),
        context(),
      );
      requireTrue(
        changed.outcome === "failed" &&
          changed.code === "ISOLATION_UNAVAILABLE" &&
          changed.stopped === "not-started",
      );
    } finally {
      chmodSync(MAC_PROBE, 0o700);
    }
    const altered = {
      ...actual,
      identity: { ...actual.identity, nodeSha256: "0".repeat(64) },
    };
    requireTrue(!policySupported(altered));
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
  privateWrite(
    join(runRoot, "summary.json"),
    JSON.stringify({
      schema: "mac-media-matrix.v1",
      profileId: policy.profileId,
      componentId: policyComponentId(policy),
      profiles,
      results,
      residualControlEntries: readdirSync(CONTROL_ROOT),
      passed: results.every((r) => r.passed),
    }),
  );
  console.log(
    JSON.stringify({
      matrix: "mac-media-matrix.v1",
      passed: results.every((r) => r.passed),
      assertions: results.length,
      failed: results.filter((r) => !r.passed).map((r) => r.name),
      profileId: policy.profileId,
      residualControlEntries: readdirSync(CONTROL_ROOT).length,
    }),
  );
  if (results.some((r) => !r.passed)) process.exitCode = 1;
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
