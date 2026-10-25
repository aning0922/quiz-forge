import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  RECOVERY_TABLES,
  RECOVERY_ROW_FORMAT,
  canonicalRecoveryJson,
  recoveryHash,
  type RecoveryStorageInventory,
} from "@/features/runtime-recovery/contracts";
import type {
  RecoveryBudget,
  WithQuiescentRecoverySnapshot,
} from "@/features/runtime-recovery/ports";

export function freshBudget(ms = 30_000): RecoveryBudget {
  return {
    deadlineMonotonicMs: performance.now() + ms,
    signal: new AbortController().signal,
  };
}
/** Structural artifact tests only: no claim of actual PG dump, source admission or restore. */
export async function artifactFixture() {
  const cache = path.join(process.cwd(), ".cache");
  await mkdir(cache, { recursive: true, mode: 0o700 });
  const root = await mkdtemp(path.join(cache, "recovery-tools-"));
  const sourceRoot = path.join(root, "source");
  const instanceId = "ab".repeat(16);
  const instanceDirectory = path.join(sourceRoot, ".cache", "p2a", instanceId);
  const blob = Buffer.from("finite synthetic blob");
  const blobPath = `uploads/blobs/${recoveryHash(blob)}.blob`;
  const inventory: RecoveryStorageInventory = {
    directories: [
      "uploads",
      "uploads/blobs",
      "uploads/imports",
      "uploads/validation",
    ],
    files: [{ path: blobPath, bytes: blob.length, sha256: recoveryHash(blob) }],
  };
  for (const directory of inventory.directories)
    await mkdir(path.join(instanceDirectory, directory), {
      recursive: true,
      mode: 0o700,
    });
  await writeFile(path.join(instanceDirectory, blobPath), blob, {
    mode: 0o600,
    flag: "wx",
  });
  const baseEvidence = {
    rowFormat: RECOVERY_ROW_FORMAT,
    migrations: Array.from({ length: 18 }, (_, i) => ({
      version: `${String(i + 1).padStart(4, "0")}_test`,
      checksum: recoveryHash(`synthetic migration ${i}`),
    })),
    tables: RECOVERY_TABLES.map((name) => ({
      name,
      rows: 0,
      bytes: 0,
      sha256: recoveryHash(""),
    })),
  };
  const source = {
    instanceId,
    purpose: "test" as const,
    root: sourceRoot,
    origin: "http://127.0.0.1:55421",
    pgPort: 55422,
    postgresVersion: 180004 as const,
    importsEnabled: false as const,
    codeSha256: "cd".repeat(32),
  };
  const database = {
    ...baseEvidence,
    graphSha256: recoveryHash(canonicalRecoveryJson(baseEvidence)),
  };
  const dump = Buffer.from("PGDMP\u0001structural-test-not-a-real-pg-archive");
  const events: string[] = [];
  const snapshot: WithQuiescentRecoverySnapshot = async (_input, work) => {
    const result = await work({
      source,
      database,
      storage: inventory,
      instanceDirectory,
      assertValid: async () => {
        events.push("lease-check");
      },
      dumpTo: async (file) => {
        await file.writeFile(dump);
        events.push("dump-written");
        return { bytes: dump.length, sha256: recoveryHash(dump) };
      },
    });
    events.push("a-closed");
    return result;
  };
  const directory = path.join(root, `backup-${randomUUID()}`);
  return {
    root,
    directory,
    source,
    instanceDirectory,
    inventory,
    blob,
    blobPath,
    dump,
    snapshot,
    events,
    input: {
      ...freshBudget(),
      instanceId,
      codeSha256: source.codeSha256,
      directory,
      assertCodeIdentity: async () => {
        events.push("code-check");
      },
    },
  };
}
