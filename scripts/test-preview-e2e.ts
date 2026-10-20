import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import { lstat, realpath } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";
import { z } from "zod";
import { previewE2eArguments } from "./p3c-e2e-arguments";
import { loadRuntimeConfig, readPrivateJson } from "../src/lib/db/runtime";
import { configureImports } from "../src/features/quizpack/import/config-management";
import { openTestDatabase } from "../tests/db/p2a-fixture";
import {
  cleanupPreviewFixture,
  readPreviewFixture,
} from "../tests/db/p3c-preview-fixture";
import { PREVIEW_FIXTURE_PRIVATE_NAME } from "../tests/db/p3c-preview-fixture-contract";
import {
  cleanupDraftRevisionFixture,
  readDraftRevisionFixture,
} from "../tests/db/p3d-draft-revision-fixture";
import { DRAFT_REVISION_FIXTURE_PRIVATE_NAME } from "../tests/db/p3d-draft-revision-fixture-contract";
import {
  cleanupInternalVersionFixture,
  readInternalVersionFixture,
} from "../tests/db/p3e-internal-version-fixture";
import { INTERNAL_VERSION_FIXTURE_PRIVATE_NAME } from "../tests/db/p3e-internal-version-fixture-contract";
import {
  launchPreviewServer,
  assertPreviewServerRunning,
  stopAndProveServerExit,
  assertServerExitProof,
  type OwnedPreviewServer,
  type ServerExitProof,
} from "../tests/support/p3c-server-owner";
const execute = promisify(execFile),
  require = createRequire(import.meta.url);
const interrupted = new AbortController();
const interrupt = () => interrupted.abort();
process.once("SIGINT", interrupt);
process.once("SIGTERM", interrupt);
let phase = "configuration";
let failurePhase: string | undefined;
function checkpoint() {
  if (interrupted.signal.aborted) throw Error("MANAGED_E2E_INTERRUPTED");
}
function groupAbsent(pid: number) {
  try {
    process.kill(-pid, 0);
    return false;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ESRCH") return true;
    throw Error("E2E_WORKER_GROUP_UNPROVEN");
  }
}
async function waitReady(owner: OwnedPreviewServer) {
  const deadline = performance.now() + 60_000;
  while (performance.now() < deadline) {
    checkpoint();
    assertPreviewServerRunning(owner);
    try {
      const r = await fetch("http://127.0.0.1:3100", {
        signal: AbortSignal.timeout(1000),
        redirect: "error",
        cache: "no-store",
      });
      await r.body?.cancel();
      if (r.ok) {
        assertPreviewServerRunning(owner);
        return;
      }
    } catch {
      /* Retry only our still-running owned Next. */
    }
    await delay(100);
  }
  throw Error("MANAGED_E2E_START_TIMEOUT");
}
async function playwright(
  owner: OwnedPreviewServer,
  env: NodeJS.ProcessEnv,
  args: string[],
): Promise<number> {
  const child = spawn(
    process.execPath,
    [
      require.resolve("@playwright/test/cli"),
      "test",
      "--config",
      "playwright.owned.config.ts",
      ...args,
    ],
    { cwd: process.cwd(), env, stdio: "inherit", detached: true },
  );
  let closed = false,
    failed = false,
    code: number | null = null;
  const close = new Promise<void>((resolve) =>
    child.once("close", (value) => {
      closed = true;
      code = value;
      resolve();
    }),
  );
  child.once("error", () => {
    failed = true;
  });
  const signal = (value: NodeJS.Signals) => {
    // Once close is observed, a surviving group has no trustworthy leader identity.
    if (closed && child.pid) {
      if (!groupAbsent(child.pid)) throw Error("E2E_WORKER_GROUP_UNPROVEN");
      return;
    }
    try {
      if (child.pid) process.kill(-child.pid, value);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ESRCH")
        throw Error("E2E_WORKER_GROUP_UNPROVEN");
    }
  };
  const deadline = performance.now() + 30 * 60_000;
  try {
    while (!closed) {
      checkpoint();
      assertPreviewServerRunning(owner);
      if (failed || performance.now() >= deadline)
        throw Error("MANAGED_E2E_CHILD_FAILED");
      await Promise.race([close, delay(100)]);
    }
    if (failed || !child.pid) throw Error("MANAGED_E2E_CHILD_FAILED");
    assertPreviewServerRunning(owner);
    return code ?? 1;
  } finally {
    if (child.pid) {
      if (!closed || !groupAbsent(child.pid)) signal("SIGTERM");
      const until = performance.now() + 5000,
        start = performance.now();
      while (
        (!closed || !groupAbsent(child.pid)) &&
        performance.now() < until
      ) {
        if (performance.now() - start >= 2000) signal("SIGKILL");
        await delay(25);
      }
      if (!closed || !groupAbsent(child.pid))
        throw Error("E2E_WORKER_GROUP_UNPROVEN");
      await close;
    } else if (!closed) throw Error("E2E_WORKER_GROUP_UNPROVEN");
  }
}
async function exists(file: string) {
  try {
    await lstat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
async function cleanupLegacy(configFile: string, env: NodeJS.ProcessEnv) {
  for (const [name, script] of [
    ["drafts-e2e-fixture.json", "tests/db/p2b3-studio-fixture.ts"],
    ["validations-e2e-fixture.json", "tests/db/p2b2b-e2e-fixture.ts"],
  ] as const) {
    const file = path.join(path.dirname(configFile), name);
    if (!(await exists(file))) continue;
    const value = z
      .object({ runId: z.uuid() })
      .parse(await readPrivateJson(file));
    await execute(
      process.execPath,
      [
        "--conditions=react-server",
        "--import",
        "tsx",
        script,
        "cleanup",
        value.runId,
      ],
      { cwd: process.cwd(), env, timeout: 60_000, maxBuffer: 4096 },
    );
    process.stdout.write(
      JSON.stringify({ phase: "cleanup", fixture: name, result: "passed" }) +
        "\n",
    );
  }
}
async function main() {
  const args = previewE2eArguments(process.argv.slice(2));
  const cwd = await realpath(process.cwd()),
    config = await loadRuntimeConfig();
  if (
    !["test", "ci"].includes(config.purpose) ||
    config.origin !== "http://127.0.0.1:3100"
  )
    throw Error("MANAGED_E2E_TEST_INSTANCE_REQUIRED");
  const configFile = process.env.QUIZFORGE_P2A_CONFIG;
  if (
    !configFile ||
    !path.isAbsolute(configFile) ||
    (await realpath(configFile)) !== configFile
  )
    throw Error("MANAGED_E2E_TEST_INSTANCE_REQUIRED");
  const runId = randomUUID(),
    identity = { cwd, instanceId: config.instanceId, runId };
  for (const name of [
    INTERNAL_VERSION_FIXTURE_PRIVATE_NAME,
    DRAFT_REVISION_FIXTURE_PRIVATE_NAME,
    PREVIEW_FIXTURE_PRIVATE_NAME,
    "drafts-e2e-fixture.json",
    "validations-e2e-fixture.json",
  ]) {
    if (await exists(path.join(path.dirname(configFile), name)))
      throw Error("EXISTING_E2E_FIXTURE_PRESERVED");
  }
  const env = {
    ...process.env,
    QUIZFORGE_P2A_CONFIG: configFile,
    QF_PREVIEW_E2E_RUN_ID: runId,
    QF_DRAFT_REVISION_E2E_RUN_ID: runId,
    QF_INTERNAL_VERSION_E2E_RUN_ID: runId,
    TSX_TSCONFIG_PATH: path.join(cwd, "tsconfig.json"),
    PLAYWRIGHT_BROWSERS_PATH: path.join(cwd, ".cache", "ms-playwright"),
  };
  let owner: OwnedPreviewServer | undefined,
    proof: ServerExitProof | undefined,
    passed = false;
  try {
    phase = "server-start";
    checkpoint();
    owner = await launchPreviewServer({
      ...identity,
      port: 3100,
      runtimeConfigPath: configFile,
      env,
    });
    await waitReady(owner);
    phase = "playwright";
    const code = await playwright(owner, env, args);
    if (code !== 0) throw Error("MANAGED_E2E_TESTS_FAILED");
    passed = true;
  } catch (error) {
    failurePhase ??= phase;
    throw error;
  } finally {
    phase = "server-stop";
    if (owner) proof = await stopAndProveServerExit(owner);
  }
  checkpoint();
  if (!passed || !proof) throw Error("MANAGED_E2E_EXIT_UNPROVEN");
  assertServerExitProof(proof, identity);
  phase = "internal-version-cleanup";
  const internalFixtureFile = path.join(
    path.dirname(configFile),
    INTERNAL_VERSION_FIXTURE_PRIVATE_NAME,
  );
  if (await exists(internalFixtureFile)) {
    const db = await openTestDatabase();
    try {
      const fixture = await readInternalVersionFixture(db, runId);
      if (!fixture.completed)
        throw Error("INTERNAL_VERSION_FIXTURE_UNKNOWN_PRESERVED");
      await configureImports(db.config.instanceId, false);
      await cleanupInternalVersionFixture(db, runId, proof);
    } finally {
      await db.close();
    }
    process.stdout.write(
      JSON.stringify({
        phase: "cleanup",
        fixture: INTERNAL_VERSION_FIXTURE_PRIVATE_NAME,
        result: "passed",
      }) + "\n",
    );
  } else if (args.length === 0)
    throw Error("INTERNAL_VERSION_E2E_NOT_EXECUTED");
  phase = "draft-revision-cleanup";
  const revisionFixtureFile = path.join(
    path.dirname(configFile),
    DRAFT_REVISION_FIXTURE_PRIVATE_NAME,
  );
  if (await exists(revisionFixtureFile)) {
    const db = await openTestDatabase();
    try {
      const fixture = await readDraftRevisionFixture(db, runId);
      if (!fixture.completed)
        throw Error("DRAFT_REVISION_FIXTURE_UNKNOWN_PRESERVED");
      await cleanupDraftRevisionFixture(db, runId, proof);
    } finally {
      await db.close();
    }
    process.stdout.write(
      JSON.stringify({
        phase: "cleanup",
        fixture: DRAFT_REVISION_FIXTURE_PRIVATE_NAME,
        result: "passed",
      }) + "\n",
    );
  } else if (args.length === 0) throw Error("DRAFT_REVISION_E2E_NOT_EXECUTED");
  phase = "preview-cleanup";
  const fixtureFile = path.join(
    path.dirname(configFile),
    PREVIEW_FIXTURE_PRIVATE_NAME,
  );
  if (await exists(fixtureFile)) {
    const db = await openTestDatabase();
    try {
      const fixture = await readPreviewFixture(db, runId);
      if (!fixture.completed) throw Error("PREVIEW_FIXTURE_UNKNOWN_PRESERVED");
      const cleaned = await cleanupPreviewFixture(db, runId, proof);
      process.stdout.write(
        JSON.stringify({
          phase: "preview-native-control",
          observation: cleaned.nativeControl,
        }) + "\n",
      );
    } finally {
      await db.close();
    }
    process.stdout.write(
      JSON.stringify({
        phase: "cleanup",
        fixture: PREVIEW_FIXTURE_PRIVATE_NAME,
        result: "passed",
      }) + "\n",
    );
  } else if (args.length === 0) throw Error("PREVIEW_E2E_NOT_EXECUTED");
  phase = "legacy-cleanup";
  await cleanupLegacy(configFile, env);
  process.stdout.write(
    JSON.stringify({
      schemaVersion: "quizforge-owned-e2e.v1",
      tests: "passed",
      scope: args.length === 0 ? "full" : "filtered",
      serverExit: "proven",
      workersStopped: true,
      cleanup: "passed",
    }) + "\n",
  );
}
main()
  .catch(() => {
    process.stderr.write(
      JSON.stringify({
        code: "MANAGED_E2E_FAILED",
        phase: failurePhase ?? phase,
        fixtureState: "preserved-if-not-confirmed-clean",
      }) + "\n",
    );
    process.exitCode = 1;
  })
  .finally(() => {
    process.removeListener("SIGINT", interrupt);
    process.removeListener("SIGTERM", interrupt);
  });
