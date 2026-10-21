import { constants, type Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  type FileHandle,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { RecoveryBudget } from "./ports";
import type { RecoveryFileDigest, RecoveryStorageInventory } from "./contracts";
import { RECOVERY_LIMITS, recoveryStorageSchema } from "./contracts";
import { RecoveryError } from "./errors";

// A rejected close never becomes a grant to retry, seal, restore or delete.
const unknownHandles = new Set<unknown>();
export function assertRecoveryIoKnown(): void {
  if (unknownHandles.size) throw new RecoveryError("RECOVERY_CLOSE_UNPROVEN");
}
export function checkRecoveryBudget(budget: RecoveryBudget): void {
  assertRecoveryIoKnown();
  if (
    !Number.isFinite(budget.deadlineMonotonicMs) ||
    budget.signal.aborted ||
    performance.now() >= budget.deadlineMonotonicMs
  )
    throw new RecoveryError("RECOVERY_INTERRUPTED");
}
async function closeOwned(handle: { close(): Promise<void> }) {
  try {
    await handle.close();
  } catch {
    unknownHandles.add(handle);
    throw new RecoveryError("RECOVERY_CLOSE_UNPROVEN");
  }
}
function validStat(stat: Stats, directory: boolean, privateMode: boolean) {
  if (
    stat.isSymbolicLink() ||
    (directory ? !stat.isDirectory() : !stat.isFile()) ||
    (!directory && stat.nlink !== 1) ||
    (privateMode &&
      (stat.uid !== process.getuid?.() ||
        (stat.mode & 0o7777) !== (directory ? 0o700 : 0o600))) ||
    (!directory && (!Number.isSafeInteger(stat.size) || stat.size < 0))
  )
    throw new RecoveryError("RECOVERY_STORAGE_INVALID");
}
function sameFile(a: Stats, b: Stats) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs &&
    a.ctimeMs === b.ctimeMs
  );
}
export async function assertRecoveryDirectory(
  directory: string,
  budget: RecoveryBudget,
  privateMode = true,
): Promise<Stats> {
  checkRecoveryBudget(budget);
  if (!path.isAbsolute(directory) || path.resolve(directory) !== directory)
    throw new RecoveryError("RECOVERY_STORAGE_INVALID");
  const before = await lstat(directory);
  validStat(before, true, privateMode);
  if ((await realpath(directory)) !== directory)
    throw new RecoveryError("RECOVERY_STORAGE_INVALID");
  checkRecoveryBudget(budget);
  return before;
}
export async function createRecoveryDirectory(
  directory: string,
  budget: RecoveryBudget,
): Promise<void> {
  checkRecoveryBudget(budget);
  await assertRecoveryDirectory(path.dirname(directory), budget, false);
  try {
    await mkdir(directory, { mode: 0o700 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      throw new RecoveryError("RECOVERY_DESTINATION_EXISTS");
    throw error;
  }
  await assertRecoveryDirectory(directory, budget);
}
export async function withRecoveryFile<T>(
  file: string,
  budget: RecoveryBudget,
  max: number,
  work: (handle: FileHandle, before: Stats) => Promise<T>,
  privateMode = true,
): Promise<T> {
  checkRecoveryBudget(budget);
  await assertRecoveryDirectory(path.dirname(file), budget, privateMode);
  const before = await lstat(file);
  validStat(before, false, privateMode);
  if (before.size > max) throw new RecoveryError("RECOVERY_LIMIT_EXCEEDED");
  const handle = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    const opened = await handle.stat();
    validStat(opened, false, privateMode);
    if (!sameFile(before, opened))
      throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
    const result = await work(handle, opened);
    const after = await handle.stat();
    const current = await lstat(file);
    validStat(after, false, privateMode);
    validStat(current, false, privateMode);
    if (!sameFile(opened, after) || !sameFile(opened, current))
      throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
    checkRecoveryBudget(budget);
    return result;
  } finally {
    // Cleanup remains owned and awaited after the admission deadline or abort.
    await closeOwned(handle);
  }
}
export async function withNewRecoveryFile<T>(
  file: string,
  budget: RecoveryBudget,
  work: (handle: FileHandle) => Promise<T>,
): Promise<T> {
  checkRecoveryBudget(budget);
  await assertRecoveryDirectory(path.dirname(file), budget);
  const handle = await open(
    file,
    constants.O_CREAT |
      constants.O_EXCL |
      constants.O_RDWR |
      constants.O_NOFOLLOW,
    0o600,
  );
  try {
    validStat(await handle.stat(), false, true);
    const result = await work(handle);
    checkRecoveryBudget(budget);
    await handle.sync();
    checkRecoveryBudget(budget);
    return result;
  } finally {
    await closeOwned(handle);
  }
}
export async function digestRecoveryHandle(
  handle: FileHandle,
  budget: RecoveryBudget,
  max: number,
  expectedHeader?: Uint8Array,
): Promise<RecoveryFileDigest> {
  const before = await handle.stat();
  if (!before.isFile() || before.size > max)
    throw new RecoveryError("RECOVERY_LIMIT_EXCEEDED");
  const hash = createHash("sha256");
  const buffer = Buffer.alloc(65_536);
  const header = Buffer.alloc(expectedHeader?.length ?? 0);
  let bytes = 0;
  while (true) {
    checkRecoveryBudget(budget);
    const result = await handle.read(
      buffer,
      0,
      Math.min(buffer.length, max + 1 - bytes),
      bytes,
    );
    if (!result.bytesRead) break;
    if (bytes < header.length)
      buffer.copy(
        header,
        bytes,
        0,
        Math.min(result.bytesRead, header.length - bytes),
      );
    bytes += result.bytesRead;
    if (bytes > max) throw new RecoveryError("RECOVERY_LIMIT_EXCEEDED");
    hash.update(buffer.subarray(0, result.bytesRead));
  }
  if (
    bytes !== before.size ||
    (expectedHeader && bytes < expectedHeader.length)
  )
    throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
  if (expectedHeader && !header.equals(expectedHeader))
    throw new RecoveryError("RECOVERY_FORMAT_INVALID");
  if (!sameFile(before, await handle.stat()))
    throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
  return { bytes, sha256: hash.digest("hex") };
}
export async function digestRecoveryFile(
  file: string,
  budget: RecoveryBudget,
  max: number,
  header?: Uint8Array,
  privateMode = true,
) {
  return withRecoveryFile(
    file,
    budget,
    max,
    (handle) => digestRecoveryHandle(handle, budget, max, header),
    privateMode,
  );
}
export function assertRecoveryDigest(
  actual: RecoveryFileDigest,
  expected: RecoveryFileDigest,
): void {
  if (actual.bytes !== expected.bytes || actual.sha256 !== expected.sha256)
    throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
}
export async function readRecoveryBytes(
  file: string,
  budget: RecoveryBudget,
  max: number,
): Promise<Buffer> {
  return withRecoveryFile(file, budget, max, async (handle, stat) => {
    const buffer = Buffer.alloc(stat.size + 1);
    let total = 0;
    while (total < buffer.length) {
      checkRecoveryBudget(budget);
      const { bytesRead } = await handle.read(
        buffer,
        total,
        buffer.length - total,
        total,
      );
      if (!bytesRead) break;
      total += bytesRead;
    }
    if (total !== stat.size)
      throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
    return buffer.subarray(0, total);
  });
}
export async function writeRecoveryBytes(
  file: string,
  bytes: Uint8Array,
  budget: RecoveryBudget,
) {
  await withNewRecoveryFile(file, budget, async (handle) => {
    let written = 0;
    while (written < bytes.length) {
      checkRecoveryBudget(budget);
      const result = await handle.write(
        bytes,
        written,
        bytes.length - written,
        written,
      );
      if (!result.bytesWritten)
        throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
      written += result.bytesWritten;
    }
  });
}
export async function copyRecoveryFile(
  source: string,
  destination: string,
  expected: RecoveryFileDigest,
  budget: RecoveryBudget,
) {
  await withRecoveryFile(
    source,
    budget,
    RECOVERY_LIMITS.fileBytes,
    async (input) => {
      await withNewRecoveryFile(destination, budget, async (output) => {
        const hash = createHash("sha256");
        const buffer = Buffer.alloc(65_536);
        let total = 0;
        for (;;) {
          checkRecoveryBudget(budget);
          const { bytesRead } = await input.read(
            buffer,
            0,
            Math.min(buffer.length, expected.bytes + 1 - total),
            total,
          );
          if (!bytesRead) break;
          if (total + bytesRead > expected.bytes)
            throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
          hash.update(buffer.subarray(0, bytesRead));
          let offset = 0;
          while (offset < bytesRead) {
            checkRecoveryBudget(budget);
            const written = await output.write(
              buffer,
              offset,
              bytesRead - offset,
              total + offset,
            );
            if (!written.bytesWritten)
              throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
            offset += written.bytesWritten;
          }
          total += bytesRead;
        }
        assertRecoveryDigest(
          { bytes: total, sha256: hash.digest("hex") },
          expected,
        );
      });
    },
  );
  assertRecoveryDigest(
    await digestRecoveryFile(destination, budget, RECOVERY_LIMITS.fileBytes),
    expected,
  );
}
export async function recoveryDirectoryNames(
  directory: string,
  budget: RecoveryBudget,
  max: number,
  privateMode = true,
): Promise<string[]> {
  const before = await assertRecoveryDirectory(directory, budget, privateMode);
  const dir = await opendir(directory, { bufferSize: 32 });
  const names: string[] = [];
  try {
    for (;;) {
      checkRecoveryBudget(budget);
      const entry = await dir.read();
      if (!entry) break;
      names.push(entry.name);
      if (names.length > max)
        throw new RecoveryError("RECOVERY_LIMIT_EXCEEDED");
    }
  } finally {
    await closeOwned(dir);
  }
  const after = await assertRecoveryDirectory(directory, budget, privateMode);
  if (!sameFile(before, after))
    throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
  return names.sort();
}
export async function assertRecoveryStorage(
  base: string,
  input: RecoveryStorageInventory,
  budget: RecoveryBudget,
): Promise<void> {
  const inventory = recoveryStorageSchema.parse(input);
  await assertRecoveryDirectory(base, budget);
  const expected = new Set([
    ...inventory.directories,
    ...inventory.files.map((file) => file.path),
  ]);
  let entries = 0;
  for (const directory of inventory.directories) {
    const names = await recoveryDirectoryNames(
      path.join(base, directory),
      budget,
      RECOVERY_LIMITS.storageEntries,
    );
    for (const name of names) {
      const relative = `${directory}/${name}`;
      if (!expected.has(relative))
        throw new RecoveryError("RECOVERY_STORAGE_INVALID");
      if (++entries > RECOVERY_LIMITS.storageEntries)
        throw new RecoveryError("RECOVERY_LIMIT_EXCEEDED");
    }
    const children = [...expected]
      .filter((entry) => path.posix.dirname(entry) === directory)
      .map((entry) => path.posix.basename(entry))
      .sort();
    if (JSON.stringify(names) !== JSON.stringify(children))
      throw new RecoveryError("RECOVERY_STORAGE_INVALID");
  }
  for (const file of inventory.files)
    assertRecoveryDigest(
      await digestRecoveryFile(
        path.join(base, file.path),
        budget,
        RECOVERY_LIMITS.fileBytes,
      ),
      file,
    );
}
export async function copyRecoveryStorage(
  source: string,
  destination: string,
  inventory: RecoveryStorageInventory,
  budget: RecoveryBudget,
): Promise<void> {
  await assertRecoveryStorage(source, inventory, budget);
  await assertRecoveryDirectory(destination, budget);
  for (const directory of inventory.directories)
    await createRecoveryDirectory(path.join(destination, directory), budget);
  for (const file of inventory.files)
    await copyRecoveryFile(
      path.join(source, file.path),
      path.join(destination, file.path),
      file,
      budget,
    );
  await assertRecoveryStorage(source, inventory, budget);
  await assertRecoveryStorage(destination, inventory, budget);
  for (const directory of [...inventory.directories].reverse())
    await syncRecoveryDirectory(path.join(destination, directory), budget);
}
export async function syncRecoveryDirectory(
  directory: string,
  budget: RecoveryBudget,
) {
  const before = await assertRecoveryDirectory(directory, budget);
  const handle = await open(
    directory,
    constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
  );
  try {
    const opened = await handle.stat();
    validStat(opened, true, true);
    if (!sameFile(before, opened))
      throw new RecoveryError("RECOVERY_INTEGRITY_FAILED");
    checkRecoveryBudget(budget);
    await handle.sync();
    checkRecoveryBudget(budget);
  } finally {
    await closeOwned(handle);
  }
}
