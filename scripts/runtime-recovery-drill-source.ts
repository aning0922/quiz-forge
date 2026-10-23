import { randomUUID } from "node:crypto";
import { lstat, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import {
  initLocalInstance,
  createOperator,
  instancePaths,
  loadManagedInstance,
  openManagedDatabase,
} from "../src/lib/db/management";
import { createDatabase } from "../src/lib/db/client";
import { createPreauth, login } from "../src/lib/auth/service";
import { configureImports } from "../src/features/quizpack/import/config-management";
import { assertRecoveryEnvironment } from "../src/features/runtime-recovery/cli-environment";
import {
  RECOVERY_LIMITS,
  canonicalRecoveryJson,
  recoveryHash,
} from "../src/features/runtime-recovery/contracts";
import {
  RecoveryError,
  safeRecoveryError,
} from "../src/features/runtime-recovery/errors";
import {
  assertRecoveryDirectory,
  createRecoveryDirectory,
  readRecoveryBytes,
  syncRecoveryDirectory,
  writeRecoveryBytes,
} from "../src/features/runtime-recovery/files";
import { prepareRecoveryBusinessSource } from "../tests/recovery/business-source-fixture";
import { parseRecoverySourceOptions } from "../tests/recovery/source-options";
import { holdRecoverySourceOrigin } from "../tests/recovery/source-origin-hold";
import {
  launchPreviewServer,
  stopAndProveServerExit,
  assertServerExitProof,
} from "../tests/support/p3c-server-owner";

/** New synthetic instance only. No argument permits selecting an existing instance or author data. */
async function main() {
  const options = parseRecoverySourceOptions(process.argv.slice(2));
  const root = process.cwd();
  const budget = {
    deadlineMonotonicMs: performance.now() + RECOVERY_LIMITS.operationMs,
    signal: new AbortController().signal,
  };
  await assertRecoveryEnvironment(root, budget);
  for (const port of [options.pgPort, options.httpPort]) {
    const probe = await holdRecoverySourceOrigin(`http://127.0.0.1:${port}`);
    await probe.close();
  }
  const base = path.join(root, ".cache", "runtime-recovery-drill");
  await mkdir(path.dirname(base), { recursive: true, mode: 0o700 });
  try {
    await mkdir(base, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  await assertRecoveryDirectory(base, budget);
  const runId = randomUUID();
  const directory = path.join(base, runId);
  await createRecoveryDirectory(directory, budget);
  await writeRecoveryBytes(
    path.join(directory, "intent.json"),
    Buffer.from(
      canonicalRecoveryJson({
        runId,
        sourcePort: options.pgPort,
        sourceOrigin: options.origin,
        qualification: "synthetic-only",
      }),
    ),
    budget,
  );
  const manifest = await initLocalInstance({
    port: options.pgPort,
    origin: options.origin,
    purpose: "test",
  });
  await writeRecoveryBytes(
    path.join(directory, "instance.json"),
    Buffer.from(
      canonicalRecoveryJson({ runId, instanceId: manifest.instanceId }),
    ),
    budget,
  );
  const credentialFile = path.join(
    instancePaths(manifest.instanceId).directory,
    "r1-drill-credential",
  );
  await createOperator(manifest.instanceId, {
    label: "r1-synthetic-drill",
    role: "operator",
    credentialFile,
  });
  const identity = await lstat(credentialFile);
  const raw = (await readRecoveryBytes(credentialFile, budget, 256))
    .toString("utf8")
    .trim();
  await writeRecoveryBytes(
    path.join(directory, "operator.json"),
    Buffer.from(canonicalRecoveryJson({ credential: raw })),
    budget,
  );
  const current = await lstat(credentialFile);
  if (
    identity.dev !== current.dev ||
    identity.ino !== current.ino ||
    identity.size !== current.size
  )
    throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
  await unlink(credentialFile); // Only this command's freshly-created private bootstrap file.
  await configureImports(manifest.instanceId, true);
  const { config } = await loadManagedInstance(manifest.instanceId);
  const app = await createDatabase(config);
  let server: Awaited<ReturnType<typeof launchPreviewServer>> | undefined;
  let source: Awaited<ReturnType<typeof prepareRecoveryBusinessSource>>;
  try {
    server = await launchPreviewServer({
      cwd: root,
      instanceId: manifest.instanceId,
      runId,
      port: options.httpPort,
      runtimeConfigPath: manifest.runtimeConfigPath,
    });
    let ready = false;
    for (let attempt = 0; attempt < 100 && !ready; attempt++) {
      try {
        const response = await fetch(
          config.origin + "/api/studio/auth/session",
          { signal: AbortSignal.timeout(1000) },
        );
        await response.arrayBuffer();
        ready = response.status === 200 || response.status === 401;
      } catch {
        /* The exact owned server may still be starting. */
      }
      if (!ready) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!ready) throw new RecoveryError("RECOVERY_PROCESS_FAILED");
    const preauth = await createPreauth(app, null, randomUUID());
    const session = await login(
      app,
      preauth.raw,
      preauth.dto.csrfToken,
      raw,
      randomUUID(),
    );
    source = await prepareRecoveryBusinessSource(app, {
      sessionToken: session.raw,
      csrfToken: session.dto.csrfToken,
      requestId: randomUUID(),
    });
  } finally {
    try {
      if (server) {
        const proof = await stopAndProveServerExit(server);
        assertServerExitProof(proof, {
          cwd: root,
          instanceId: manifest.instanceId,
          runId,
        });
      }
    } finally {
      await app.close();
    }
  }
  await configureImports(manifest.instanceId, false);
  const audit = await openManagedDatabase(manifest.instanceId);
  const actualCounts: Record<string, number> = {};
  try {
    for (const [table, expected] of Object.entries({
      quizpack_import: 1,
      quizpack_validation: 1,
      product_draft: 1,
      draft_revision: 1,
      draft_review: 1,
      product_version: 1,
      internal_play_version: 1,
      access_key: 3,
      consumer_session: 2,
      quiz_report: 1,
      asset_blob: 5,
      product_asset: 5,
    })) {
      // Table names come only from this finite source-code allowlist.
      const [row] = await audit.sql.unsafe<{ count: number }[]>(
        `SELECT count(*)::int AS count FROM qf.${table}`,
      );
      if (row?.count !== expected)
        throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
      actualCounts[table] = row.count;
    }
  } finally {
    await audit.close();
  }
  const record = Buffer.from(
    canonicalRecoveryJson({
      schemaVersion: "quizforge.synthetic-recovery-drill-source.v1",
      runId,
      instanceId: manifest.instanceId,
      source,
      actualCounts,
    }),
  );
  if (record.length > 2_097_152)
    throw new RecoveryError("RECOVERY_LIMIT_EXCEEDED");
  await writeRecoveryBytes(path.join(directory, "source.json"), record, budget);
  await syncRecoveryDirectory(directory, budget);
  process.stdout.write(
    JSON.stringify({
      status: "synthetic-source-prepared",
      runId,
      instanceId: manifest.instanceId,
      sourceRecordSha256: recoveryHash(record),
      counts: source.counts,
    }) + "\n",
  );
}
main().catch((error: unknown) => {
  process.stderr.write(JSON.stringify(safeRecoveryError(error)) + "\n");
  process.exitCode = 1;
});
