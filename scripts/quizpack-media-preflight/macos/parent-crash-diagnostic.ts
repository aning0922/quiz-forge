/** Fixed single-case diagnostic. Never emits an owned-matrix/qualification receipt. */
import { mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import sharp from "sharp";
import {
  PARENT_CRASH_DIAGNOSTIC,
  MAC_ROOT,
  REPO_ROOT,
  loadPolicy,
} from "./policy";
import { CONTROL_ROOT, ensurePrivateDirectory } from "./control";
import { runParentCrashCase, ParentCrashFailure } from "./parent-crash-case";
async function main() {
  if (
    !PARENT_CRASH_DIAGNOSTIC ||
    process.argv.length !== 3 ||
    process.argv[2] !== "--diagnostic-parent-crash"
  )
    throw Error("INVALID_DIAGNOSTIC_ARGUMENTS");
  ensurePrivateDirectory(MAC_ROOT);
  ensurePrivateDirectory(CONTROL_ROOT);
  if (readdirSync(CONTROL_ROOT).length)
    throw Error("DIAGNOSTIC_CONTROL_PRESENT");
  const runRoot = join(MAC_ROOT, "run-" + randomUUID());
  mkdirSync(runRoot, { mode: 0o700 });
  const base = {
    schema: "quizforge.parent-crash-diagnostic.v1",
    qualification: false,
    capabilityCommitted: false,
    recordCommitted: false,
  };
  writeFileSync(
    join(runRoot, "intent.json"),
    JSON.stringify({ ...base, case: "parent-crash", deadlinesChanged: false }) +
      "\n",
    { flag: "wx", mode: 0o600 },
  );
  let outcome: object;
  try {
    const policy = loadPolicy();
    const small = await sharp({
      create: {
        width: 2,
        height: 2,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      },
    })
      .png()
      .toBuffer();
    const details = await runParentCrashCase({
      small,
      policy,
      runRoot,
      declaration: (b, width, height) => ({
        path: "assets/synthetic.png",
        mediaType: "image/png",
        bytes: b.length,
        sha256: createHash("sha256").update(b).digest("hex"),
        width,
        height,
      }),
      context: () => ({
        signal: new AbortController().signal,
        deadlineMonotonicMs: performance.now() + 5000,
      }),
      baseline: (executable, args) => {
        const r = spawnSync(executable, args, {
          cwd: REPO_ROOT,
          env: { NODE_ENV: "production" },
          timeout: 5000,
          maxBuffer: 2048,
        });
        if (r.status !== 0) throw Error("SYNTHETIC_ASSERTION_FAILED");
        return r.stdout;
      },
    });
    outcome = { ...base, outcome: "case-passed", details };
  } catch (error) {
    outcome = {
      ...base,
      outcome: "case-failed",
      details:
        error instanceof ParentCrashFailure
          ? error.details()
          : {
              stage: "preflight",
              code: "UNCLASSIFIED_FAILURE",
              cleanupFailure: null,
            },
    };
    process.exitCode = 1;
  }
  writeFileSync(join(runRoot, "result.json"), JSON.stringify(outcome) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
  console.log(JSON.stringify(outcome));
}
main().catch(() => {
  console.log(
    JSON.stringify({
      schema: "quizforge.parent-crash-diagnostic.v1",
      outcome: "entry-rejected",
      qualification: false,
      capabilityCommitted: false,
      recordCommitted: false,
    }),
  );
  process.exitCode = 1;
});
