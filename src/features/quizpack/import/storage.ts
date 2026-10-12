import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  link,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { P2aRuntimeConfig } from "@/lib/db/runtime";
import { StudioError } from "@/lib/http-security/errors";
import { archiveHashSchema, importIdSchema } from "./contracts";
import {
  MAX_FILES_PER_IMPORT,
  MAX_IMPORT_DIRECTORIES,
  MAX_RECEIPT_BYTES,
  MAX_SCAN_ENTRIES,
  SCAN_TIMEOUT_MS,
} from "./limits";
import { remainingReceiveMs } from "./context";
import { MAX_VALIDATIONS, MAX_BLOBS } from "../validation/limits";
import type { ReceiveContext } from "./service-contract";

export const attemptSchema = z.strictObject({
  attemptId: importIdSchema,
  fence: z.number().int().min(1).max(2147483647),
  ownerPid: z.number().int().min(1).max(2147483647),
  ownerNonce: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  reservationBytes: z.number().int().min(65538).max(67174400),
  disposition: z.enum(["held", "released"]),
});
export type Attempt = z.infer<typeof attemptSchema>;
export const receiptSchema = z.strictObject({
  version: z.literal(1),
  importId: importIdSchema,
  attemptId: importIdSchema,
  fence: attemptSchema.shape.fence,
  ownerPid: attemptSchema.shape.ownerPid,
  ownerNonce: attemptSchema.shape.ownerNonce,
});
export type FileFact = { file: string; size: number; inode: Stats };
export type StorageNamespace = "imports" | "validation" | "blobs";
export type StorageScanKey = `${StorageNamespace}:${string}`;
export const storageScanKey = (
  namespace: StorageNamespace,
  id: string,
): StorageScanKey => `${namespace}:${id}`;
export type Scan = {
  bytes: number;
  entries: number;
  files: Map<StorageScanKey, FileFact[]>;
};
export const storageNamespaceLimits = Object.freeze({
  imports: MAX_IMPORT_DIRECTORIES,
  validation: MAX_VALIDATIONS,
  blobs: MAX_BLOBS,
});
export function scannedFiles(
  scan: Scan,
  namespace: StorageNamespace,
  id: string,
) {
  return scan.files.get(storageScanKey(namespace, id)) ?? [];
}
const conflict = () => new StudioError("RECEIVE_STORAGE_CONFLICT");
const missing = (e: unknown) => (e as NodeJS.ErrnoException)?.code === "ENOENT";
export function instanceDirectory(config: P2aRuntimeConfig) {
  return path.join(
    /* turbopackIgnore: true */ process.cwd(),
    ".cache",
    "p2a",
    config.instanceId,
  );
}
export function uploadsDirectory(config: P2aRuntimeConfig) {
  return path.join(instanceDirectory(config), "uploads");
}
export function importsDirectory(config: P2aRuntimeConfig) {
  return path.join(uploadsDirectory(config), "imports");
}
export function validationDirectory(config: P2aRuntimeConfig, id?: string) {
  if (id !== undefined && !importIdSchema.safeParse(id).success)
    throw conflict();
  return id === undefined
    ? path.join(uploadsDirectory(config), "validation")
    : path.join(uploadsDirectory(config), "validation", id);
}
export function blobsDirectory(config: P2aRuntimeConfig) {
  return path.join(uploadsDirectory(config), "blobs");
}
export function blobPath(config: P2aRuntimeConfig, sha256: string) {
  if (!archiveHashSchema.safeParse(sha256).success) throw conflict();
  return path.join(blobsDirectory(config), `${sha256}.blob`);
}
export function importDirectory(config: P2aRuntimeConfig, id: string) {
  if (!importIdSchema.safeParse(id).success) throw conflict();
  return path.join(importsDirectory(config), id);
}
export async function privateDirectory(
  dir: string,
  check: () => void = () => {},
) {
  check();
  const s = await lstat(dir);
  check();
  if (
    !s.isDirectory() ||
    s.isSymbolicLink() ||
    (s.mode & 0o777) !== 0o700 ||
    s.uid !== process.getuid?.() ||
    (await realpath(dir)) !== dir
  )
    throw conflict();
  check();
}
export function privateFile(s: Stats) {
  if (
    !s.isFile() ||
    s.isSymbolicLink() ||
    (s.mode & 0o777) !== 0o600 ||
    s.uid !== process.getuid?.() ||
    !Number.isSafeInteger(s.size) ||
    s.size < 0
  )
    throw conflict();
}
export async function ensureStorage(
  config: P2aRuntimeConfig,
  check: () => void = () => {},
) {
  const instance = instanceDirectory(config);
  await privateDirectory(path.dirname(instance), check);
  await privateDirectory(instance, check);
  for (const dir of [
    uploadsDirectory(config),
    importsDirectory(config),
    validationDirectory(config),
    blobsDirectory(config),
  ]) {
    check();
    try {
      await mkdir(dir, { mode: 0o700 });
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    check();
    await privateDirectory(dir, check);
  }
  check();
}
export async function assertNoConfigGuard(config: P2aRuntimeConfig) {
  for (const name of [
    "imports-config.guard",
    "imports-config-recovery.guard",
  ]) {
    try {
      await lstat(
        path.join(/* turbopackIgnore: true */ instanceDirectory(config), name),
      );
      throw new StudioError("RECEIVE_BUSY");
    } catch (e) {
      if (!missing(e)) throw e;
    }
  }
}
const uuid = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const filename = new RegExp(
  `^(archive\\.quizpack|attempt-${uuid}\\.partial|stopped-${uuid}\\.json|stopped-${uuid}\\.json\\.tmp-${uuid})$`,
);
/** Bounded directory iteration. Unknown entries are maintenance errors, never ignored. */
export async function scanStorage(
  config: P2aRuntimeConfig,
  context: ReceiveContext,
): Promise<Scan> {
  const deadline = Math.min(
    context.deadlineMonotonicMs,
    performance.now() + SCAN_TIMEOUT_MS,
  );
  let entries = 0,
    bytes = 0;
  const files = new Map<StorageScanKey, FileFact[]>();
  const assertScanDeadline = () => {
    remainingReceiveMs(context);
    if (performance.now() >= deadline)
      throw new StudioError("RECEIVE_SCAN_LIMIT");
  };
  const countEntry = () => {
    assertScanDeadline();
    if (++entries > MAX_SCAN_ENTRIES)
      throw new StudioError("RECEIVE_SCAN_LIMIT");
  };
  const readDirectory = async function* (dir: string) {
    assertScanDeadline();
    const handle = await opendir(dir, { bufferSize: 32 });
    try {
      assertScanDeadline();
      for (;;) {
        assertScanDeadline();
        const entry = await handle.read();
        assertScanDeadline();
        if (!entry) return;
        yield entry;
      }
    } finally {
      await handle.close();
      assertScanDeadline();
    }
  };
  const addFile = async (file: string): Promise<FileFact> => {
    assertScanDeadline();
    const inode = await lstat(file);
    assertScanDeadline();
    privateFile(inode);
    bytes += inode.size;
    if (!Number.isSafeInteger(bytes)) throw conflict();
    return { file, size: inode.size, inode };
  };
  assertScanDeadline();
  await ensureStorage(config, assertScanDeadline);
  assertScanDeadline();
  for await (const entry of readDirectory(uploadsDirectory(config))) {
    countEntry();
    if (!["imports", "validation", "blobs"].includes(entry.name))
      throw conflict();
    await privateDirectory(
      path.join(uploadsDirectory(config), entry.name),
      assertScanDeadline,
    );
  }
  assertScanDeadline();
  for (const namespace of ["imports", "validation", "blobs"] as const) {
    let namespaceEntries = 0;
    const base = path.join(uploadsDirectory(config), namespace);
    for await (const entry of readDirectory(base)) {
      countEntry();
      if (++namespaceEntries > storageNamespaceLimits[namespace])
        throw new StudioError("RECEIVE_SCAN_LIMIT");
      if (namespace === "blobs") {
        const match = /^([0-9a-f]{64})\.blob$/.exec(entry.name);
        if (!match) throw conflict();
        files.set(storageScanKey(namespace, match[1]!), [
          await addFile(path.join(base, entry.name)),
        ]);
        continue;
      }
      if (!importIdSchema.safeParse(entry.name).success) throw conflict();
      const dir = path.join(base, entry.name);
      await privateDirectory(dir, assertScanDeadline);
      const facts: FileFact[] = [];
      for await (const child of readDirectory(dir)) {
        countEntry();
        if (facts.length >= MAX_FILES_PER_IMPORT)
          throw new StudioError("RECEIVE_SCAN_LIMIT");
        if (
          !filename.test(child.name) ||
          (namespace === "validation" && child.name === "archive.quizpack")
        )
          throw conflict();
        facts.push(await addFile(path.join(dir, child.name)));
      }
      assertScanDeadline();
      files.set(storageScanKey(namespace, entry.name), facts);
    }
    assertScanDeadline();
  }
  assertScanDeadline();
  return { bytes, entries, files };
}

export async function openPrivate(file: string): Promise<FileHandle> {
  const handle = await open(
    file,
    constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
  );
  try {
    privateFile(await handle.stat());
    return handle;
  } catch (e) {
    await handle.close();
    throw e;
  }
}
export async function readBoundedJson(file: string) {
  const handle = await openPrivate(file);
  try {
    const bytes = Buffer.alloc(MAX_RECEIPT_BYTES + 1);
    let count = 0;
    while (count < bytes.length) {
      const { bytesRead } = await handle.read(
        bytes,
        count,
        bytes.length - count,
        count,
      );
      if (!bytesRead) break;
      count += bytesRead;
    }
    if (count > MAX_RECEIPT_BYTES) throw conflict();
    return JSON.parse(bytes.subarray(0, count).toString("utf8")) as unknown;
  } finally {
    await handle.close();
  }
}
export async function removeOwned(file: string, inode: Stats) {
  let current: Stats;
  try {
    current = await lstat(file);
  } catch (e) {
    if (missing(e)) return;
    throw e;
  }
  privateFile(current);
  if (current.ino !== inode.ino || current.dev !== inode.dev) throw conflict();
  await unlink(file);
}
export async function writeStopped(
  config: P2aRuntimeConfig,
  id: string,
  attempt: Attempt,
) {
  const dir = importDirectory(config, id);
  await privateDirectory(dir);
  const destination = path.join(dir, `stopped-${attempt.attemptId}.json`);
  // A published proof is immutable. Repeated calls may only read it, never create another temp.
  try {
    const existing = receiptSchema.safeParse(
      await readBoundedJson(destination),
    );
    if (
      !existing.success ||
      existing.data.importId !== id ||
      existing.data.attemptId !== attempt.attemptId ||
      existing.data.fence !== attempt.fence ||
      existing.data.ownerPid !== attempt.ownerPid ||
      existing.data.ownerNonce !== attempt.ownerNonce
    )
      throw conflict();
    return;
  } catch (error) {
    if (!missing(error)) throw conflict();
  }
  const temp = `${destination}.tmp-${randomUUID()}`;
  const handle = await open(
    temp,
    constants.O_WRONLY |
      constants.O_CREAT |
      constants.O_EXCL |
      constants.O_NOFOLLOW,
    0o600,
  );
  const inode = await handle.stat();
  try {
    try {
      await handle.writeFile(
        JSON.stringify({
          version: 1,
          importId: id,
          attemptId: attempt.attemptId,
          fence: attempt.fence,
          ownerPid: attempt.ownerPid,
          ownerNonce: attempt.ownerNonce,
        }),
      );
      await handle.sync();
    } finally {
      await handle.close();
    }
    await link(temp, destination);
    await removeOwned(temp, inode);
  } catch (e) {
    await removeOwned(temp, inode).catch(() => {});
    throw e;
  }
}
/** Only recorded server PID, never a request-supplied PID. ESRCH alone proves exit. */
export function ownerExited(
  pid: number,
  probe: typeof process.kill = process.kill,
): boolean {
  if (!Number.isInteger(pid) || pid <= 0 || pid > 2147483647) return false;
  try {
    probe(pid, 0);
    return false;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "ESRCH";
  }
}
export async function stopped(
  config: P2aRuntimeConfig,
  id: string,
  attempt: Attempt,
): Promise<boolean> {
  const file = path.join(
    importDirectory(config, id),
    `stopped-${attempt.attemptId}.json`,
  );
  try {
    const result = receiptSchema.safeParse(await readBoundedJson(file));
    if (!result.success) throw conflict();
    const r = result.data;
    if (
      r.importId !== id ||
      r.attemptId !== attempt.attemptId ||
      r.fence !== attempt.fence ||
      r.ownerPid !== attempt.ownerPid ||
      r.ownerNonce !== attempt.ownerNonce
    )
      throw conflict();
    return true;
  } catch (e) {
    if (!missing(e)) throw conflict();
    return ownerExited(attempt.ownerPid);
  }
}
export async function hashArchive(
  file: string,
  context: ReceiveContext,
  check: () => Promise<void>,
) {
  remainingReceiveMs(context);
  await check();
  const handle = await openPrivate(file);
  const hash = createHash("sha256");
  let bytes = 0;
  try {
    const buffer = Buffer.alloc(65536);
    while (true) {
      remainingReceiveMs(context);
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
      if (!bytesRead) break;
      bytes += bytesRead;
      if (bytes > 33554432) throw conflict();
      hash.update(buffer.subarray(0, bytesRead));
    }
    await check();
    return { bytes, hash: hash.digest("hex") };
  } finally {
    await handle.close();
  }
}

export function currentReceiptLimits(scan: Scan, id: string) {
  const receipts = scannedFiles(scan, "imports", id).filter((f) =>
    /^stopped-.*\.json$/.test(path.basename(f.file)),
  );
  if (receipts.length > 3 || receipts.reduce((n, f) => n + f.size, 0) > 6144)
    throw new StudioError("RECEIVE_SCAN_LIMIT");
  for (const receipt of receipts)
    if (receipt.size > MAX_RECEIPT_BYTES)
      throw new StudioError("RECEIVE_STORAGE_CONFLICT");
}
