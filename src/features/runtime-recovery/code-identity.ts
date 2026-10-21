import { lstat } from "node:fs/promises";
import path from "node:path";
import { canonicalRecoveryJson, recoveryHash } from "./contracts";
import type { RecoveryBudget } from "./ports";
import { RecoveryError } from "./errors";
import {
  assertRecoveryDirectory,
  checkRecoveryBudget,
  digestRecoveryFile,
  recoveryDirectoryNames,
} from "./files";

export const RECOVERY_CODE_LIMITS = Object.freeze({
  entries: 16_384,
  fileBytes: 33_554_432,
  totalBytes: 268_435_456,
  manifestBytes: 4_194_304,
});
const rootFiles = [
  "package.json",
  "pnpm-lock.yaml",
  "tsconfig.json",
  "next.config.ts",
  "postcss.config.mjs",
  ".npmrc",
];
const directories = ["src", "scripts", "migrations/p2a", "patches", "public"];

/** Actual finite code bytes, independent of commit ID, dependencies, docs and private state. */
export async function computeRecoveryCodeIdentity(
  root: string,
  budget: RecoveryBudget,
): Promise<{ codeSha256: string; fileCount: number; bytes: number }> {
  await assertRecoveryDirectory(root, budget, false);
  const files: { path: string; bytes: number; sha256: string }[] = [];
  let count = 0;
  let bytes = 0;
  const admit = () => {
    checkRecoveryBudget(budget);
    if (++count > RECOVERY_CODE_LIMITS.entries)
      throw new RecoveryError("RECOVERY_LIMIT_EXCEEDED");
  };
  const file = async (relative: string) => {
    const digest = await digestRecoveryFile(
      path.join(root, relative),
      budget,
      RECOVERY_CODE_LIMITS.fileBytes,
      undefined,
      false,
    );
    bytes += digest.bytes;
    if (bytes > RECOVERY_CODE_LIMITS.totalBytes)
      throw new RecoveryError("RECOVERY_LIMIT_EXCEEDED");
    files.push({ path: relative, ...digest });
  };
  const walk = async (relative: string): Promise<void> => {
    admit();
    const absolute = path.join(root, relative);
    await assertRecoveryDirectory(absolute, budget, false);
    const names = await recoveryDirectoryNames(
      absolute,
      budget,
      RECOVERY_CODE_LIMITS.entries,
      false,
    );
    for (const name of names) {
      if (!name || /[\u0000-\u001f\u007f\\]/.test(name))
        throw new RecoveryError("RECOVERY_STORAGE_INVALID");
      const child = `${relative}/${name}`;
      if (child.length > 2048)
        throw new RecoveryError("RECOVERY_LIMIT_EXCEEDED");
      const stat = await lstat(path.join(root, child));
      if (stat.isSymbolicLink())
        throw new RecoveryError("RECOVERY_STORAGE_INVALID");
      if (stat.isDirectory()) await walk(child);
      else {
        admit();
        await file(child);
      }
    }
    const after = await recoveryDirectoryNames(
      absolute,
      budget,
      RECOVERY_CODE_LIMITS.entries,
      false,
    );
    if (JSON.stringify(names) !== JSON.stringify(after))
      throw new RecoveryError("RECOVERY_CODE_MISMATCH");
  };
  for (const relative of rootFiles) {
    admit();
    await file(relative);
  }
  for (const relative of directories) await walk(relative);
  files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
  const text = canonicalRecoveryJson({
    schemaVersion: "quizforge.recovery-code.v1",
    files,
  });
  if (Buffer.byteLength(text) > RECOVERY_CODE_LIMITS.manifestBytes)
    throw new RecoveryError("RECOVERY_LIMIT_EXCEEDED");
  checkRecoveryBudget(budget);
  return { codeSha256: recoveryHash(text), fileCount: files.length, bytes };
}
