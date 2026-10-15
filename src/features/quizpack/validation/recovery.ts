import "server-only";
import path from "node:path";
import type { P2aRuntimeConfig } from "@/lib/db/runtime";
import { StudioError } from "@/lib/http-security/errors";
import {
  scannedFiles,
  removeOwned,
  scanStorage,
  type Scan,
} from "../import/storage";
import { readValidationStopped } from "./receipt";
import { parseValidationAttempts, type ValidationRow } from "./repository";
import type { SettledAttempt } from "./transactions-contract";
import { ArchiveOperation } from "./operation";
/** Fresh recovery only removes exact owned temporary names; raw archives and final blobs are immutable. */
export async function recoverValidationFiles(
  op: ArchiveOperation,
  config: P2aRuntimeConfig,
  row: ValidationRow,
  scan: Scan,
) {
  const attempts = parseValidationAttempts(row.attempts_text),
    proofs = new Map<
      string,
      Awaited<ReturnType<typeof readValidationStopped>>
    >();
  if (attempts.some((a) => a.disposition === "held" && !a.fileStopProof))
    throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
  for (const attempt of attempts)
    proofs.set(
      attempt.attemptId,
      await readValidationStopped(op, config, row.id, attempt),
    );
  const settledAttempts: SettledAttempt[] = [];
  for (const attempt of attempts.filter((a) => a.disposition === "held")) {
    const proof = proofs.get(attempt.attemptId);
    if (!proof) throw new StudioError("VALIDATION_RECOVERY_REQUIRED");
    settledAttempts.push({
      attemptId: attempt.attemptId,
      mediaStop: proof.mediaStopped,
      fileStopProof: proof,
    });
  }
  const files = scannedFiles(scan, "validation", row.id);
  // Check the complete private directory before the first unlink, including historical attempts.
  for (const file of files) {
    const name = path.basename(file.file);
    if (
      !attempts.some(
        (a) =>
          proofs.get(a.attemptId) &&
          (name === `attempt-${a.attemptId}.partial` ||
            name === `stopped-${a.attemptId}.json` ||
            name === `stopped-${a.attemptId}.json.tmp-${a.attemptId}`),
      )
    )
      throw new StudioError("VALIDATION_STORAGE_CONFLICT");
  }
  await op.fileTask(async () => {
    for (const file of files) {
      const name = path.basename(file.file);
      if (name.endsWith(".partial") || name.includes(".json.tmp-")) {
        op.nonDbCheckpoint();
        try {
          await removeOwned(file.file, file.inode);
        } catch {
          throw new StudioError("VALIDATION_STORAGE_CONFLICT");
        }
        op.nonDbCheckpoint();
      }
    }
  });
  const fresh = await op.fileTask(() => scanStorage(config, op.context));
  return {
    settledAttempts,
    accountedBytes: scannedFiles(fresh, "validation", row.id).reduce(
      (sum, f) => sum + f.size,
      0,
    ),
    storageCondition: "clean" as const,
  };
}
