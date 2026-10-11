import sharp from "sharp";
import { lstat, symlink, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { release, arch } from "node:os";
import {
  CACHE,
  hash,
  privateDir,
  writePrivate,
  json,
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
        (!expectedCode || result.code === expectedCode),
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
      await lstat(resolve(CACHE, "control", "guard"));
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
      return (await fs.readdir(resolve(CACHE, "control"))).sort();
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
    limitations: [
      "extended-lifecycle-injection-matrix-pending",
      "memory-peak-measurement-pending",
      "native-host-control-comparison-pending",
    ],
    accepted: false,
  };
  await writePrivate(resolve(root, "summary.json"), JSON.stringify(report));
  process.stdout.write(
    JSON.stringify({
      outcome: cases.every((c) => c.passed)
        ? "candidate-smoke-passed"
        : "candidate-smoke-failed",
      passed: cases.filter((c) => c.passed).length,
      total: cases.length,
      profileId: policy.profileId,
      accepted: false,
    }) + "\n",
  );
  if (cases.some((c) => !c.passed)) process.exitCode = 1;
});
