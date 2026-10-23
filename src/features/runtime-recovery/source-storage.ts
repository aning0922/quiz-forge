import "server-only";
import { lstat } from "node:fs/promises";
import path from "node:path";
import type { P2aRuntimeConfig } from "@/lib/db/runtime";
import {
  instanceDirectory,
  ownerExited,
  receiptSchema,
} from "@/features/quizpack/import/storage";
import { parseValidationAttempts } from "@/features/quizpack/validation/repository";
import { validationStoppedReceiptSchema } from "@/features/quizpack/validation/receipt";
import type { RecoverySql } from "./database-evidence";
import type { RecoveryBudget } from "./ports";
import {
  RECOVERY_LIMITS,
  recoveryStorageSchema,
  type RecoveryStorageInventory,
} from "./contracts";
import {
  assertRecoveryDirectory,
  digestRecoveryFile,
  readRecoveryBytes,
  recoveryDirectoryNames,
  checkRecoveryBudget,
} from "./files";
import { RecoveryError } from "./errors";

const invalid = () => new RecoveryError("RECOVERY_SOURCE_NOT_QUIESCENT");
export async function assertRecoveryMaintenanceGuardsAbsent(
  directory: string,
  allowPendingTarget = false,
): Promise<void> {
  for (const name of [
    "imports-config.guard",
    "imports-config-recovery.guard",
    "recovery-pending.json",
    "start.lock",
  ]) {
    if (allowPendingTarget && name === "recovery-pending.json") continue;
    try {
      await lstat(path.join(directory, name));
      throw invalid();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}

/** A reads only uploads and named maintenance guards, never arbitrary private instance files. */
export async function readRecoverySourceStorage(
  config: P2aRuntimeConfig,
  sql: RecoverySql,
  budget: RecoveryBudget,
  allowPendingTarget = false,
): Promise<RecoveryStorageInventory> {
  checkRecoveryBudget(budget);
  const root = instanceDirectory(config);
  await assertRecoveryDirectory(path.dirname(root), budget);
  await assertRecoveryDirectory(root, budget);
  await assertRecoveryMaintenanceGuardsAbsent(root, allowPendingTarget);
  const imports = await sql.unsafe<Record<string, unknown>[]>(
    "SELECT id,status,storage_condition,reserved_bytes,lease_until,attempts,actual_archive_sha256,actual_archive_bytes FROM qf.quizpack_import ORDER BY id LIMIT 1025",
  );
  const validations = await sql.unsafe<Record<string, unknown>[]>(
    "SELECT id,status,storage_condition,reserved_bytes,lease_until,attempts_text FROM qf.quizpack_validation ORDER BY id LIMIT 1025",
  );
  const blobs = await sql.unsafe<
    { sha256: string; bytes: number; storage_key: string }[]
  >(
    "SELECT sha256,bytes,storage_key FROM qf.asset_blob ORDER BY sha256 LIMIT 4097",
  );
  if (imports.length > 1024 || validations.length > 1024 || blobs.length > 4096)
    throw new RecoveryError("RECOVERY_LIMIT_EXCEEDED");
  const importMap = new Map(imports.map((row) => [String(row.id), row]));
  const validationMap = new Map(
    validations.map((row) => [String(row.id), row]),
  );
  const expected = new Map<
    string,
    {
      bytes?: number;
      sha256?: string;
      required: boolean;
      receipt?: (bytes: Buffer) => void;
    }
  >();
  const admit = (row: Record<string, unknown>) => {
    if (
      row.storage_condition !== "clean" ||
      Number(row.reserved_bytes) !== 0 ||
      row.lease_until !== null
    )
      throw invalid();
  };
  for (const row of imports) {
    admit(row);
    if (row.status === "receiving" || !Array.isArray(row.attempts))
      throw invalid();
    if (row.status === "received") {
      if (
        typeof row.actual_archive_sha256 !== "string" ||
        typeof row.actual_archive_bytes !== "number"
      )
        throw invalid();
      expected.set(`uploads/imports/${row.id}/archive.quizpack`, {
        bytes: row.actual_archive_bytes,
        sha256: row.actual_archive_sha256,
        required: true,
      });
    }
    for (const item of row.attempts as Record<string, unknown>[]) {
      if (item.disposition !== "released") throw invalid();
      const receipt = `uploads/imports/${row.id}/stopped-${item.attemptId}.json`;
      expected.set(receipt, {
        required: !ownerExited(Number(item.ownerPid)),
        receipt: (bytes) => {
          let value: unknown;
          try {
            value = JSON.parse(bytes.toString("utf8"));
          } catch {
            throw invalid();
          }
          const result = receiptSchema.safeParse(value);
          if (
            !result.success ||
            result.data.importId !== row.id ||
            result.data.attemptId !== item.attemptId ||
            result.data.fence !== item.fence ||
            result.data.ownerPid !== item.ownerPid ||
            result.data.ownerNonce !== item.ownerNonce
          )
            throw invalid();
        },
      });
    }
  }
  for (const row of validations) {
    admit(row);
    if (
      ["validating", "archiving"].includes(String(row.status)) ||
      typeof row.attempts_text !== "string"
    )
      throw invalid();
    for (const item of parseValidationAttempts(row.attempts_text)) {
      if (item.disposition !== "released" || item.mediaStop === "unconfirmed")
        throw invalid();
      const proof = item.fileStopProof;
      const receipt = `uploads/validation/${row.id}/stopped-${item.attemptId}.json`;
      expected.set(receipt, {
        required: !!proof || !ownerExited(item.ownerPid),
        ...(proof ? { sha256: proof.receiptSha256 } : {}),
        receipt: (bytes) => {
          let value: unknown;
          try {
            value = JSON.parse(bytes.toString("utf8"));
          } catch {
            throw invalid();
          }
          const result = validationStoppedReceiptSchema.safeParse(value);
          if (
            !result.success ||
            result.data.validationId !== row.id ||
            result.data.attemptId !== item.attemptId ||
            result.data.fence !== item.fence ||
            result.data.ownerPid !== item.ownerPid ||
            result.data.ownerNonce !== item.ownerNonce ||
            result.data.mediaStopped !== item.mediaStop
          )
            throw invalid();
        },
      });
    }
  }
  for (const row of blobs) {
    if (row.storage_key !== `blobs/${row.sha256}.blob`) throw invalid();
    expected.set(`uploads/${row.storage_key}`, {
      bytes: row.bytes,
      sha256: row.sha256,
      required: true,
    });
  }
  const directories: string[] = [],
    files: RecoveryStorageInventory["files"] = [];
  const seen = new Set<string>();
  const walk = async (relative: string): Promise<void> => {
    if (directories.length + files.length >= RECOVERY_LIMITS.storageEntries)
      throw new RecoveryError("RECOVERY_LIMIT_EXCEEDED");
    const dir = path.join(root, relative);
    await assertRecoveryDirectory(dir, budget);
    directories.push(relative);
    for (const name of await recoveryDirectoryNames(
      dir,
      budget,
      RECOVERY_LIMITS.storageEntries,
    )) {
      if (directories.length + files.length >= RECOVERY_LIMITS.storageEntries)
        throw new RecoveryError("RECOVERY_LIMIT_EXCEEDED");
      const child = `${relative}/${name}`,
        full = path.join(root, child);
      const stat = await lstat(full);
      if (stat.isDirectory()) {
        const namespace =
          /^uploads\/(imports|validation)\/([a-f0-9-]{36})$/.exec(child);
        if (
          !["uploads/blobs", "uploads/imports", "uploads/validation"].includes(
            child,
          ) &&
          !(
            namespace &&
            (namespace[1] === "imports" ? importMap : validationMap).has(
              namespace[2]!,
            )
          )
        )
          throw invalid();
        await walk(child);
      } else {
        const fact = expected.get(child);
        if (!fact) throw invalid();
        const digest = await digestRecoveryFile(
          full,
          budget,
          fact.receipt ? 2048 : RECOVERY_LIMITS.fileBytes,
        );
        if (
          (fact.bytes !== undefined && fact.bytes !== digest.bytes) ||
          (fact.sha256 !== undefined && fact.sha256 !== digest.sha256)
        )
          throw invalid();
        if (fact.receipt)
          fact.receipt(await readRecoveryBytes(full, budget, 2048));
        files.push({ path: child, ...digest });
        seen.add(child);
      }
    }
  };
  await walk("uploads");
  for (const [name, fact] of expected)
    if (fact.required && !seen.has(name)) throw invalid();
  return recoveryStorageSchema.parse({
    directories: directories.sort(),
    files: files.sort((a, b) =>
      a.path < b.path ? -1 : a.path > b.path ? 1 : 0,
    ),
  });
}
