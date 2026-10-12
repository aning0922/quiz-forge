import { parseProbeOutput } from "../shared/probe-protocol.ts";
import { createRequire } from "node:module";
const crc32 = createRequire(import.meta.url)("buffer-crc32");
import { measureOwnCgroup } from "./resources.mjs";
import { precheckImage } from "../shared/precheck.ts";
import sharp from "sharp";
import { lstat, symlink, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { release, arch } from "node:os";
import {
  CACHE,
  STATE,
  RUNTIME_TARGET,
  hash,
  privateDir,
  writePrivate,
  json,
  command,
  safeMain,
} from "./common.mjs";
import { executeSynthetic, runIsolatedImage } from "./controller.mjs";
import { loadPolicy } from "./policy.mjs";

safeMain(async () => {
  const runId = randomUUID();
  const root = resolve(CACHE, runId);
  await privateDir(root);
  const policy = await loadPolicy();
  const cases = [];
  const record = (id, passed, result) => {
    cases.push({ id, passed, result });
    if (RUNTIME_TARGET) {
      process.stdout.write(JSON.stringify({ case: id, passed }) + "\n");
      return;
    }
    process.stdout.write(
      JSON.stringify({
        case: id,
        passed,
        outcome: result?.outcome,
        stopped: result?.stopped,
        code: result?.code,
      }) + "\n",
    );
  };
  const a = new AbortController();
  a.abort();
  const cancelled = await executeSynthetic({ signal: a.signal });
  record(
    "cancel-before-start",
    cancelled.code === "CANCELLED" && cancelled.stopped === "not-started",
    cancelled,
  );
  const expired = await executeSynthetic({
    deadlineMonotonicMs: performance.now() - 1,
  });
  record(
    "deadline-before-start",
    expired.code === "DEADLINE_EXCEEDED" && expired.stopped === "not-started",
    expired,
  );
  const huge = await executeSynthetic({ bytes: Buffer.alloc(8388609) });
  record(
    "bytes-plus-one",
    huge.code === "INPUT_LIMIT" && huge.stopped === "not-started",
    huge,
  );
  const identity = await executeSynthetic({ scenario: "identity" });
  let versions;
  try {
    versions = json(identity.stdout);
  } catch {
    versions = null;
  }
  record(
    "image-native-identity",
    identity.outcome === "probe" &&
      versions?.node === "20.20.1" &&
      versions?.sharp === "0.35.5" &&
      versions?.workerSha256 === policy.image.workerSha256,
    { ...identity, stdout: undefined, versions },
  );
  for (const [format, width, height] of [
    ["png", 2, 2],
    ["jpeg", 512, 768],
    ["webp", 1024, 512],
    ["png", 8192, 1],
    ["png", 4000, 4000],
  ]) {
    const bytes = await sharp({
      create: {
        width,
        height,
        channels: 3,
        background: { r: 57, g: 111, b: 177 },
      },
    })
      .toFormat(format)
      .toBuffer();
    const start = performance.now();
    const result = await runIsolatedImage(
      bytes,
      {
        path: `assets/synthetic.${format === "jpeg" ? "jpg" : format}`,
        width,
        height,
        mediaType: `image/${format}`,
        bytes: bytes.length,
        sha256: hash(bytes),
      },
      {
        signal: new AbortController().signal,
        deadlineMonotonicMs: performance.now() + 5000,
      },
    );
    record(
      `decode-${format}-${width}x${height}`,
      result.outcome === "decoded" && result.stopped === "confirmed",
      {
        ...result,
        elapsedMs: Math.round(performance.now() - start),
        inputBytes: bytes.length,
      },
    );
  }
  const small = await sharp({
    create: {
      width: 2,
      height: 2,
      channels: 3,
      background: { r: 9, g: 14, b: 37 },
    },
  })
    .png()
    .toBuffer();
  const declaration = (bytes) => ({
    path: "assets/boundary.png",
    mediaType: "image/png",
    width: 2,
    height: 2,
    bytes: bytes.length,
    sha256: hash(bytes),
  });
  const pad = Buffer.alloc(8388608 - small.length);
  pad.writeUInt32BE(pad.length - 12, 0);
  pad.write("npAD", 4, "ascii");
  pad.writeUInt32BE(
    crc32.unsigned(pad.subarray(4, pad.length - 4)),
    pad.length - 4,
  );
  const exact = Buffer.concat([
    small.subarray(0, small.length - 12),
    pad,
    small.subarray(small.length - 12),
  ]);
  const exactResult = await runIsolatedImage(exact, declaration(exact), {
    signal: new AbortController().signal,
    deadlineMonotonicMs: performance.now() + 5000,
  });
  record("decode-exact-8MiB", exactResult.outcome === "decoded", exactResult);
  const corrupt = Buffer.from(small);
  let offset = 8;
  while (offset + 12 <= corrupt.length) {
    const n = corrupt.readUInt32BE(offset);
    if (corrupt.toString("ascii", offset + 4, offset + 8) === "IDAT") {
      corrupt.fill(255, offset + 8, offset + 8 + n);
      corrupt.writeUInt32BE(
        crc32.unsigned(corrupt.subarray(offset + 4, offset + 8 + n)),
        offset + 8 + n,
      );
      break;
    }
    offset += 12 + n;
  }
  const bad = await runIsolatedImage(corrupt, declaration(corrupt), {
    signal: new AbortController().signal,
    deadlineMonotonicMs: performance.now() + 5000,
  });
  record(
    "decode-corrupt-pixels",
    bad.code === "DECODE_REJECTED" && bad.stopped === "confirmed",
    bad,
  );
  const animChunk = Buffer.alloc(20);
  animChunk.writeUInt32BE(8);
  animChunk.write("acTL", 4, "ascii");
  animChunk.writeUInt32BE(2, 8);
  animChunk.writeUInt32BE(crc32.unsigned(animChunk.subarray(4, 16)), 16);
  const animated = Buffer.concat([
    small.subarray(0, 33),
    animChunk,
    small.subarray(33),
  ]);
  const animatedResult = await runIsolatedImage(
    animated,
    declaration(animated),
    {
      signal: new AbortController().signal,
      deadlineMonotonicMs: performance.now() + 5000,
    },
  );
  record(
    "png-animation-precheck",
    animatedResult.code === "DECODE_REJECTED" &&
      animatedResult.stopped === "not-started",
    animatedResult,
  );
  for (const scenario of ["posix-process", "posix-fd", "posix-network"]) {
    const result = await executeSynthetic({ scenario });
    const parsed = result.stdout ? parseProbeOutput(result.stdout) : null;
    const passed =
      result.outcome === "probe" &&
      (parsed?.mode === "process"
        ? parsed.threadAllowed && parsed.forkDenied && parsed.spawnDenied
        : parsed?.mode === "fd"
          ? parsed.scanComplete && parsed.noInheritedFileOrSocket
          : parsed?.mode === "network"
            ? [parsed.connect, parsed.bind, parsed.listen, parsed.unix].every(
                (v) => v === "socket-denied",
              )
            : false);
    record(scenario, passed, { ...result, stdout: undefined, parsed });
  }
  const large = await sharp({
    create: {
      width: 4000,
      height: 4000,
      channels: 4,
      background: { r: 71, g: 43, b: 199, alpha: 0.7 },
    },
  })
    .png()
    .toBuffer();
  const checkedLarge = precheckImage(large, {
    path: "assets/boundary.png",
    mediaType: "image/png",
    width: 4000,
    height: 4000,
    bytes: large.length,
    sha256: hash(large),
  });
  let measured;
  let measurement;
  let owned;
  const largeDeadline = performance.now() + 5000;
  if (!checkedLarge.ok) throw new Error("SYNTHETIC_LARGE");
  const largeResult = await executeSynthetic({
    bytes: checkedLarge.bytes,
    expected: checkedLarge.expected,
    deadlineMonotonicMs: largeDeadline,
    hooks: {
      afterCreate(r) {
        owned = r;
      },
      startSpawn() {
        measurement = measureOwnCgroup(owned, largeDeadline);
      },
      async afterStart() {
        measured = await measurement;
      },
    },
  });
  record(
    "native-memory-and-enforced-cgroup",
    largeResult.outcome === "decoded" &&
      measured?.measured &&
      measured.peakBytes <= 536870912 &&
      measured.limits.memory === 536870912 &&
      measured.limits.swap === 0 &&
      measured.limits.cpu === "100000 100000" &&
      measured.limits.pids === 64,
    { ...largeResult, measured },
  );
  // Four host-only synth roots. Parent proves exact files/aliases exist and checks
  // inode/content after every native attempt; no private application data involved.
  const sentinels = resolve(root, "host");
  await privateDir(sentinels);
  const before = [];
  for (const area of ["runtime", "admin", "PGDATA", "uploads"]) {
    const p = resolve(sentinels, area);
    await privateDir(p);
    const f = resolve(p, "sentinel");
    await writePrivate(f, Buffer.from(`synthetic-${runId}-${area}`));
    await symlink("sentinel", resolve(p, "alias"));
    const s = await lstat(f);
    before.push({ path: f, ino: s.ino, hash: hash(await readFile(f)) });
  }
  const nativePath = policy.image.nativeProbePath;
  if (
    !nativePath?.startsWith(CACHE + "/") ||
    hash(await readFile(nativePath)) !== policy.image.inputs["native-probe"]
  )
    throw new Error("NATIVE_BUILD_IDENTITY");
  const control = await command(nativePath, [sentinels, "control"]);
  let controlData;
  try {
    controlData = json(control.stdout);
  } catch {
    controlData = null;
  }
  record(
    "native-host-control",
    control.code === 0 &&
      !control.reason &&
      control.settled &&
      controlData?.ok === true,
    { outcome: "probe", controlData },
  );
  const native = await executeSynthetic({
    scenario: "native",
    syntheticRoot: sentinels,
  });
  let nativeData;
  try {
    nativeData = json(native.stdout);
  } catch {
    nativeData = null;
  }
  let unchanged = true;
  for (const f of before) {
    const s = await lstat(f.path);
    unchanged &&= s.ino === f.ino && hash(await readFile(f.path)) === f.hash;
  }
  record(
    "native-files-network-ipc-process-thread-fd",
    native.outcome === "probe" && nativeData?.ok === true && unchanged,
    { ...native, stdout: undefined, nativeData, sentinelsUnchanged: unchanged },
  );
  for (const scenario of [
    "stdout",
    "stderr",
    "bad-json",
    "multi-json",
    "invalid-utf8",
    "nonzero",
    "crash",
    "success-hang",
    "backpressure",
    "oom",
  ]) {
    const result = await executeSynthetic({
      scenario,
      bytes:
        scenario === "backpressure" ? Buffer.alloc(8388608) : Buffer.alloc(0),
    });
    // Fault probes produce no decoded result. JSON interpretation is tested below;
    // nonzero/crash/output caps/timeouts must have the same stop barrier.
    const expectedCode = ["stdout", "stderr"].includes(scenario)
      ? "OUTPUT_INVALID"
      : ["nonzero", "crash", "oom"].includes(scenario)
        ? "WORKER_FAILED"
        : ["success-hang", "backpressure"].includes(scenario)
          ? "DEADLINE_EXCEEDED"
          : "OUTPUT_INVALID";
    record(
      `fault-${scenario}`,
      result.stopped === "confirmed" &&
        result.outcome !== "decoded" &&
        (!expectedCode || result.code === expectedCode) &&
        (scenario !== "oom" || result.evidence?.oomKilled === true),
      { ...result, stdout: undefined },
    );
  }
  const abort = new AbortController();
  const timer = setTimeout(() => {
    abort.abort();
    abort.abort();
  }, 700);
  const aborted = await executeSynthetic({
    scenario: "hang",
    signal: abort.signal,
  });
  clearTimeout(timer);
  record(
    "abort-during-worker",
    aborted.code === "CANCELLED" && aborted.stopped === "confirmed",
    aborted,
  );
  const pending = executeSynthetic({
    scenario: "hang",
    deadlineMonotonicMs: performance.now() + 1800,
  });
  // wait for guard presence, bounded; second must not load image or issue create
  for (let i = 0; i < 100; i++) {
    try {
      await lstat(resolve(STATE, "control", "guard"));
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 10));
    }
  }
  const busy = await executeSynthetic();
  record("busy", busy.code === "BUSY" && busy.stopped === "not-started", busy);
  await pending;
  const leftovers = await import("node:fs/promises").then(async (fs) => {
    try {
      return (await fs.readdir(resolve(STATE, "control"))).sort();
    } catch {
      return ["unreadable"];
    }
  });
  record("fixed-control-clean", leftovers.length === 0, { leftovers });
  const report = {
    schema: "qf-linux-preflight.v1",
    sourceCommit: process.env.GITHUB_SHA ?? "local-uncommitted",
    ciRun: process.env.GITHUB_RUN_ID ?? null,
    kernel: release(),
    arch: arch(),
    profileId: policy.profileId,
    binding: policy.binding,
    versions,
    cases,
    limitations: ["extended-lifecycle-injection-matrix-pending"],
    accepted: false,
  };
  await writePrivate(resolve(root, "summary.json"), JSON.stringify(report));
  const boundedVersion = (value) =>
    typeof value === "string" &&
    value.trim() === value &&
    /^\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(value)
      ? value
      : null;
  const observedVersions = cases.find((c) => c.id === "image-native-identity")
    ?.passed
    ? versions
    : null;
  const memoryCase = cases.find(
    (c) => c.id === "native-memory-and-enforced-cgroup",
  );
  const decodeCase = cases.find((c) => c.id === "decode-png-4000x4000");
  const peakBytes = memoryCase?.result?.measured?.peakBytes;
  const elapsedMs = decodeCase?.result?.elapsedMs;
  const observations = {
    kernel:
      typeof report.kernel === "string" &&
      report.kernel.trim() === report.kernel &&
      /^\d{1,3}\.\d{1,3}\.\d{1,3}(?:-[A-Za-z0-9][A-Za-z0-9.+_-]{0,63})?$/.test(
        report.kernel,
      )
        ? report.kernel
        : null,
    arch: report.arch === "x64" ? report.arch : null,
    node: boundedVersion(observedVersions?.node),
    sharp: boundedVersion(observedVersions?.sharp),
    vips: boundedVersion(observedVersions?.vips),
    // These observations are from distinct 16MP probes, not one timed sample.
    native16MpPeakBytes:
      memoryCase?.passed &&
      memoryCase.result.measured?.measured === true &&
      Number.isSafeInteger(peakBytes) &&
      peakBytes >= 1 &&
      peakBytes <= 536870912
        ? peakBytes
        : null,
    decode16MpElapsedMs:
      decodeCase?.passed &&
      Number.isSafeInteger(elapsedMs) &&
      elapsedMs >= 0 &&
      elapsedMs <= 60000
        ? elapsedMs
        : null,
  };
  if (RUNTIME_TARGET) {
    process.stdout.write(
      JSON.stringify({
        schema: "quizpack-media-owned-matrix.v1",
        matrix: "linux-smoke",
        target: RUNTIME_TARGET,
        completed: cases.every((c) => c.passed),
        cases: cases.map(({ id, passed }) => ({ id, passed })),
        profiles: {
          normal: policy.profileId,
          fault: policy.profileId,
          posixProbe: policy.profileId,
          nativeProbe: policy.profileId,
        },
        ownedOperationsStopped:
          cases.every((c) => c.passed) && leftovers.length === 0,
        residualControlEntries: Math.min(16, leftovers.length),
      }) + "\n",
    );
    if (cases.some((c) => !c.passed)) process.exitCode = 1;
    return;
  }
  process.stdout.write(
    JSON.stringify({
      outcome: cases.every((c) => c.passed)
        ? "candidate-smoke-passed"
        : "candidate-smoke-failed",
      passed: cases.filter((c) => c.passed).length,
      total: cases.length,
      profileId: policy.profileId,
      ...observations,
      observationCode: Object.values(observations).every((v) => v !== null)
        ? "OBSERVED"
        : "OBSERVATION_METADATA_INVALID",
      accepted: false,
    }) + "\n",
  );
  if (cases.some((c) => !c.passed)) process.exitCode = 1;
});
