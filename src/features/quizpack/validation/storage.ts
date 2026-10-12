import "server-only";
import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  lstat,
  mkdir,
  open,
  link,
  unlink,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import type { P2aRuntimeConfig } from "@/lib/db/runtime";
import { StudioError } from "@/lib/http-security/errors";
import {
  importDirectory,
  validationDirectory,
  blobPath,
  blobsDirectory,
  privateDirectory,
  privateFile,
} from "../import/storage";
import {
  copyCandidateResourceBytes,
  type PrivateArchiveCandidate,
} from "../server/validation";
import type { BlobFact } from "./transactions-contract";
import { validationAttemptSchema, type ValidationAttempt } from "./repository";
import { ArchiveOperation } from "./operation";
import { MAX_ARCHIVE_BYTES } from "./limits";
const conflict = () => new StudioError("VALIDATION_STORAGE_CONFLICT");
const absent = (error: unknown) =>
  (error as NodeJS.ErrnoException)?.code === "ENOENT";
const exists = (error: unknown) =>
  (error as NodeJS.ErrnoException)?.code === "EEXIST";
const hash = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
function sameFile(a: Stats, b: Stats) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs
  );
}
async function closeOwned(op: ArchiveOperation, handle: FileHandle) {
  try {
    await handle.close();
  } catch {
    op.markRelatedIoUnknown();
    throw conflict();
  }
}
/** Finite internal test observations; no HTTP/config fields can install them. */
export type ArchiveStorageTestHooks = {
  beforeIo?: (
    operation: "read" | "write" | "sync" | "close" | "link" | "unlink",
  ) => Promise<void>;
};
export function createArchiveStorage(hooks: ArchiveStorageTestHooks = {}) {
  const checked = async (
    op: ArchiveOperation,
    kind: Parameters<NonNullable<ArchiveStorageTestHooks["beforeIo"]>>[0],
  ) => {
    op.checkpoint();
    await hooks.beforeIo?.(kind);
    op.checkpoint();
  };
  async function readExact(
    op: ArchiveOperation,
    file: string,
    bytes: number,
    sha256: string,
  ): Promise<Buffer> {
    let handle: FileHandle | undefined;
    let result: Buffer;
    try {
      op.checkpoint();
      const original = await lstat(file);
      op.checkpoint();
      privateFile(original);
      if (original.size !== bytes || original.nlink !== 1) throw conflict();
      handle = await open(
        file,
        constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
      );
      op.checkpoint();
      const opened = await handle.stat();
      op.checkpoint();
      privateFile(opened);
      if (!sameFile(original, opened)) throw conflict();
      result = Buffer.alloc(bytes + 1);
      let count = 0;
      while (count < result.length) {
        await checked(op, "read");
        const read = await handle.read(
          result,
          count,
          result.length - count,
          count,
        );
        op.checkpoint();
        if (!read.bytesRead) break;
        count += read.bytesRead;
      }
      const after = await handle.stat();
      op.checkpoint();
      privateFile(after);
      const current = await lstat(file);
      op.checkpoint();
      privateFile(current);
      if (
        count !== bytes ||
        !sameFile(opened, after) ||
        !sameFile(after, current) ||
        hash(result.subarray(0, count)) !== sha256
      )
        throw conflict();
      result = result.subarray(0, count);
    } finally {
      if (handle) {
        // Closing an already owned handle is mandatory even after the business gate closes.
        try {
          await hooks.beforeIo?.("close");
        } finally {
          await closeOwned(op, handle);
        }
      }
    }
    op.checkpoint();
    return result;
  }
  async function syncDirectory(op: ArchiveOperation, dir: string) {
    let handle: FileHandle | undefined;
    try {
      op.checkpoint();
      const original = await lstat(dir);
      op.checkpoint();
      handle = await open(
        dir,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      op.checkpoint();
      const actual = await handle.stat();
      op.checkpoint();
      if (
        !actual.isDirectory() ||
        actual.uid !== process.getuid?.() ||
        (actual.mode & 0o777) !== 0o700 ||
        actual.ino !== original.ino ||
        actual.dev !== original.dev
      )
        throw conflict();
      await checked(op, "sync");
      await handle.sync();
      op.checkpoint();
    } finally {
      if (handle) await closeOwned(op, handle);
    }
    op.checkpoint();
  }
  const finite = (error: unknown): never => {
    if (error instanceof StudioError) {
      if (error.code === "RECEIVE_STORAGE_CONFLICT") throw conflict();
      if (error.code === "RECEIVE_SCAN_LIMIT")
        throw new StudioError("VALIDATION_SCAN_LIMIT");
      throw error;
    }
    throw conflict();
  };
  return {
    async readArchive(
      op: ArchiveOperation,
      config: P2aRuntimeConfig,
      importId: string,
      bytes: number,
      sha256: string,
    ) {
      op.claimedIoCheckpoint();
      if (
        !Number.isInteger(bytes) ||
        bytes < 1 ||
        bytes > MAX_ARCHIVE_BYTES ||
        !/^[a-f0-9]{64}$/.test(sha256)
      )
        throw conflict();
      return op.fileTask(async () => {
        try {
          await privateDirectory(importDirectory(config, importId), () =>
            op.checkpoint(),
          );
          return await readExact(
            op,
            path.join(importDirectory(config, importId), "archive.quizpack"),
            bytes,
            sha256,
          );
        } catch (error) {
          return finite(error);
        }
      });
    },
    /** One partial per attempt is reused serially; completed blobs are immutable and never deleted. */
    async archiveBlob(
      op: ArchiveOperation,
      config: P2aRuntimeConfig,
      validationId: string,
      attempt: ValidationAttempt,
      candidate: PrivateArchiveCandidate,
      index: number,
    ): Promise<BlobFact> {
      op.claimedIoCheckpoint();
      if (
        !validationAttemptSchema.safeParse(attempt).success ||
        attempt.ownerPid !== process.pid ||
        attempt.disposition !== "held" ||
        !Number.isInteger(index) ||
        index < 0
      )
        throw conflict();
      const resource = candidate.facts.resources[index];
      if (!resource) throw conflict();
      // The opaque issuer binds these dimensions/MIME/frames to the exact accepted bytes.
      const bytes = copyCandidateResourceBytes(candidate, index),
        expected = resource.declaration;
      if (
        bytes.length !== resource.bytes ||
        resource.bytes !== expected.bytes ||
        resource.blobSha256 !== expected.sha256 ||
        hash(bytes) !== resource.blobSha256
      )
        throw conflict();
      const fact: BlobFact = {
        sha256: expected.sha256,
        bytes: expected.bytes,
        mediaType: expected.mediaType,
        width: expected.width,
        height: expected.height,
        frames: 1,
      };
      return op.fileTask(async () => {
        let handle: FileHandle | undefined;
        try {
          const dir = validationDirectory(config, validationId),
            destination = blobPath(config, expected.sha256);
          op.checkpoint();
          await privateDirectory(validationDirectory(config), () =>
            op.checkpoint(),
          );
          try {
            await mkdir(dir, { mode: 0o700 });
          } catch (error) {
            if (!exists(error)) throw error;
          }
          op.checkpoint();
          await privateDirectory(dir, () => op.checkpoint());
          await privateDirectory(blobsDirectory(config), () => op.checkpoint());
          try {
            await readExact(op, destination, expected.bytes, expected.sha256);
            return fact;
          } catch (error) {
            if (!absent(error)) throw error;
          }
          const partial = path.join(
            dir,
            `attempt-${attempt.attemptId}.partial`,
          );
          op.checkpoint();
          handle = await open(
            partial,
            constants.O_WRONLY |
              constants.O_CREAT |
              constants.O_EXCL |
              constants.O_NOFOLLOW |
              constants.O_NONBLOCK,
            0o600,
          );
          op.checkpoint();
          const owned = await handle.stat();
          op.checkpoint();
          privateFile(owned);
          if (owned.nlink !== 1) throw conflict();
          let offset = 0;
          while (offset < bytes.length) {
            await checked(op, "write");
            const written = await handle.write(
              bytes,
              offset,
              bytes.length - offset,
              offset,
            );
            op.checkpoint();
            if (written.bytesWritten < 1) throw conflict();
            offset += written.bytesWritten;
          }
          await checked(op, "sync");
          await handle.sync();
          op.checkpoint();
          const final = await handle.stat();
          op.checkpoint();
          privateFile(final);
          if (
            final.ino !== owned.ino ||
            final.dev !== owned.dev ||
            final.size !== expected.bytes ||
            hash(bytes) !== expected.sha256
          )
            throw conflict();
          try {
            await hooks.beforeIo?.("close");
          } finally {
            await closeOwned(op, handle);
            handle = undefined;
          }
          op.checkpoint();
          await checked(op, "link");
          try {
            await link(partial, destination);
          } catch (error) {
            if (!exists(error)) throw error;
          }
          op.checkpoint();
          await syncDirectory(op, blobsDirectory(config));
          const current = await lstat(partial);
          op.checkpoint();
          privateFile(current);
          if (current.ino !== owned.ino || current.dev !== owned.dev)
            throw conflict();
          await checked(op, "unlink");
          await unlink(partial);
          op.checkpoint();
          await syncDirectory(op, dir);
          await readExact(op, destination, expected.bytes, expected.sha256);
          return fact;
        } catch (error) {
          return finite(error);
        } finally {
          if (handle) await closeOwned(op, handle);
        }
      });
    },
  };
}
