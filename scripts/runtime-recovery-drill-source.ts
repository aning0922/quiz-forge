import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { lstat, mkdir, unlink } from "node:fs/promises";
import path from "node:path";
import {
  initLocalInstance,
  createOperator,
  instancePaths,
  loadManagedInstance,
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
import {
  launchPreviewServer,
  stopAndProveServerExit,
  assertServerExitProof,
} from "../tests/support/p3c-server-owner";

/** New synthetic instance only. No argument permits selecting an existing instance or author data. */
async function main() {
  if (process.argv.length !== 2)
    throw new RecoveryError("RECOVERY_ARGUMENTS_INVALID");
  const root = process.cwd();
  const budget = {
    deadlineMonotonicMs: performance.now() + RECOVERY_LIMITS.operationMs,
    signal: new AbortController().signal,
  };
  await assertRecoveryEnvironment(root, budget);
  for (const port of [55422, 55423])
    await new Promise<void>((resolve, reject) => {
      const server = createServer();
      server.once("error", reject);
      server.listen(port, "127.0.0.1", () =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    });
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
        sourcePort: 55422,
        sourceOrigin: "http://127.0.0.1:55423",
        qualification: "synthetic-only",
      }),
    ),
    budget,
  );
  const manifest = await initLocalInstance({
    port: 55422,
    origin: "http://127.0.0.1:55423",
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
      port: 55423,
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
  const record = Buffer.from(
    canonicalRecoveryJson({
      schemaVersion: "quizforge.synthetic-recovery-drill-source.v1",
      runId,
      instanceId: manifest.instanceId,
      source,
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
