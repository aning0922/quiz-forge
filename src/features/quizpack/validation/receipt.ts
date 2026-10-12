import "server-only";
import { createHash } from "node:crypto";
import { constants, type Stats } from "node:fs";
import {
  open,
  lstat,
  mkdir,
  link,
  unlink,
  opendir,
  type FileHandle,
} from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type { P2aRuntimeConfig } from "@/lib/db/runtime";
import { StudioError } from "@/lib/http-security/errors";
import { importIdSchema } from "../import/contracts";
import {
  validationDirectory,
  privateDirectory,
  privateFile,
} from "../import/storage";
import { canonicalP1Json } from "../v1/canonical";
import {
  validationAttemptSchema,
  validationFileStopProofSchema,
  type ValidationAttempt,
  type ValidationFileStopProof,
} from "./repository";
import { ArchiveOperation } from "./operation";
export const validationStoppedReceiptSchema = z.strictObject({
  schemaVersion: z.literal("quizpack-validation-stop-candidate.v2"),
  validationId: importIdSchema,
  attemptId: importIdSchema,
  fence: validationAttemptSchema.shape.fence,
  ownerPid: validationAttemptSchema.shape.ownerPid,
  ownerNonce: validationAttemptSchema.shape.ownerNonce,
  mediaStopped: z.enum(["confirmed", "not-started"]),
  scope: z.literal("files-and-media"),
  relatedIo: z.literal("settled"),
});
export type ValidationStoppedReceipt = z.infer<
  typeof validationStoppedReceiptSchema
>;
const conflict = () => new StudioError("VALIDATION_STORAGE_CONFLICT");
const absent = (error: unknown) =>
  (error as NodeJS.ErrnoException)?.code === "ENOENT";
const present = (error: unknown) =>
  (error as NodeJS.ErrnoException)?.code === "EEXIST";
function same(a: Stats, b: Stats) {
  return (
    a.dev === b.dev &&
    a.ino === b.ino &&
    a.size === b.size &&
    a.mtimeMs === b.mtimeMs
  );
}
async function close(op: ArchiveOperation, handle: FileHandle) {
  try {
    await handle.close();
  } catch {
    op.markRelatedIoUnknown();
    throw conflict();
  }
}
function directory(
  config: P2aRuntimeConfig,
  id: string,
  attempt: ValidationAttempt,
) {
  if (!validationAttemptSchema.safeParse(attempt).success) throw conflict();
  return validationDirectory(config, id);
}
async function readReceipt(
  op: ArchiveOperation,
  config: P2aRuntimeConfig,
  id: string,
  attempt: ValidationAttempt,
  check: () => void,
): Promise<ValidationStoppedReceipt | null> {
  const dir = directory(config, id, attempt),
    file = path.join(dir, `stopped-${attempt.attemptId}.json`);
  let handle: FileHandle | undefined,
    value: ValidationStoppedReceipt | null = null;
  try {
    try {
      await privateDirectory(dir, check);
    } catch (error) {
      if (absent(error)) {
        check();
        return null;
      }
      throw error;
    }
    check();
    let original: Stats;
    try {
      original = await lstat(file);
    } catch (error) {
      if (absent(error)) {
        check();
        return null;
      }
      throw error;
    }
    check();
    privateFile(original);
    if (original.size > 2048 || original.nlink > 2) throw conflict();
    if (original.nlink === 2) {
      const temporary = await lstat(`${file}.tmp-${attempt.attemptId}`);
      check();
      privateFile(temporary);
      if (temporary.dev !== original.dev || temporary.ino !== original.ino)
        throw conflict();
    }
    handle = await open(
      file,
      constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK,
    );
    check();
    const opened = await handle.stat();
    check();
    privateFile(opened);
    if (!same(original, opened)) throw conflict();
    const bytes = Buffer.alloc(2049);
    let count = 0;
    for (;;) {
      check();
      const read = await handle.read(bytes, count, bytes.length - count, count);
      check();
      if (!read.bytesRead) break;
      count += read.bytesRead;
      if (count > 2048) throw conflict();
    }
    const after = await handle.stat();
    check();
    const current = await lstat(file);
    check();
    privateFile(current);
    if (
      !same(opened, after) ||
      !same(after, current) ||
      count !== original.size
    )
      throw conflict();
    const text = new TextDecoder("utf-8", {
      fatal: true,
      ignoreBOM: true,
    }).decode(bytes.subarray(0, count));
    const parsed = validationStoppedReceiptSchema.parse(JSON.parse(text));
    if (
      canonicalP1Json(parsed) !== text ||
      parsed.validationId !== id ||
      parsed.attemptId !== attempt.attemptId ||
      parsed.fence !== attempt.fence ||
      parsed.ownerPid !== attempt.ownerPid ||
      parsed.ownerNonce !== attempt.ownerNonce ||
      (attempt.mediaStop !== "unconfirmed" &&
        parsed.mediaStopped !== attempt.mediaStop)
    )
      throw conflict();
    value = parsed;
  } catch (error) {
    if (error instanceof StudioError && !error.code.startsWith("RECEIVE_"))
      throw error;
    throw conflict();
  } finally {
    if (handle) await close(op, handle);
  }
  check();
  return value;
}
/** Candidate files acquire authority only from the row's already committed strict ACK. */
export async function readValidationStopped(
  op: ArchiveOperation,
  config: P2aRuntimeConfig,
  id: string,
  attempt: ValidationAttempt,
) {
  if (!attempt.fileStopProof) return null;
  const proof = validationFileStopProofSchema.parse(attempt.fileStopProof);
  const candidate = await op.fileTask(() =>
    readReceipt(op, config, id, attempt, () => op.nonDbCheckpoint()),
  );
  if (!candidate) return null;
  if (
    proof.validationId !== candidate.validationId ||
    proof.attemptId !== candidate.attemptId ||
    proof.fence !== candidate.fence ||
    proof.ownerPid !== candidate.ownerPid ||
    proof.ownerNonce !== candidate.ownerNonce ||
    proof.scope !== candidate.scope ||
    proof.mediaStopped !== candidate.mediaStopped ||
    proof.relatedIo !== candidate.relatedIo
  )
    throw conflict();
  if (
    createHash("sha256").update(canonicalP1Json(candidate)).digest("hex") !==
    proof.receiptSha256
  )
    throw conflict();
  return proof;
}
const publications = new WeakMap<
  ArchiveOperation,
  { proof: ValidationFileStopProof; bytes: number }
>();
/** Non-serializable, original-request-only qualification; the digest is from completed publisher bytes. */
export function validationFileStopPublication(
  op: ArchiveOperation,
  id: string,
  attempt: ValidationAttempt,
) {
  const published = publications.get(op);
  if (
    !published ||
    published.proof.validationId !== id ||
    published.proof.attemptId !== attempt.attemptId ||
    published.proof.fence !== attempt.fence ||
    published.proof.ownerPid !== attempt.ownerPid ||
    published.proof.ownerNonce !== attempt.ownerNonce
  )
    throw conflict();
  const qualification = op.fileStopAckQualification();
  return Object.freeze({
    ...published,
    qualification,
    toJSON() {
      throw conflict();
    },
  });
}
export function validationStoppedReceiptBytes(
  op: ArchiveOperation,
  id: string,
  attempt: ValidationAttempt,
): number {
  return Buffer.byteLength(stoppedReceiptText(op, id, attempt));
}
function stoppedReceiptText(
  op: ArchiveOperation,
  id: string,
  attempt: ValidationAttempt,
): string {
  const completion = op.completion();
  if (completion.mediaStopped === "unknown") throw conflict();
  const value = validationStoppedReceiptSchema.parse({
    schemaVersion: "quizpack-validation-stop-candidate.v2",
    validationId: id,
    attemptId: attempt.attemptId,
    fence: attempt.fence,
    ownerPid: attempt.ownerPid,
    ownerNonce: attempt.ownerNonce,
    mediaStopped: completion.mediaStopped,
    scope: "files-and-media",
    relatedIo: "settled",
  });
  return canonicalP1Json(value);
}
/** Called only after all business gates close and real platform/main-process tasks settle. */
export async function writeValidationStopped(
  op: ArchiveOperation,
  config: P2aRuntimeConfig,
  id: string,
  attempt: ValidationAttempt,
): Promise<boolean> {
  if (!op.canIssueStoppedReceipt()) return false;
  if (attempt.ownerPid !== process.pid) throw conflict();
  const completion = op.completion();
  if (completion.mediaStopped === "unknown") return false;
  const text = stoppedReceiptText(op, id, attempt);
  if (Buffer.byteLength(text) > 2048) throw conflict();
  const published = await op.stoppedReceiptTask(async (check) => {
    const dir = directory(config, id, attempt),
      destination = path.join(dir, `stopped-${attempt.attemptId}.json`),
      temp = `${destination}.tmp-${attempt.attemptId}`;
    let handle: FileHandle | undefined;
    try {
      await privateDirectory(validationDirectory(config), check);
      check();
      try {
        await mkdir(dir, { mode: 0o700 });
      } catch (error) {
        if (!present(error)) throw error;
      }
      check();
      const existing = await readReceipt(op, config, id, attempt, check);
      if (existing) {
        if (canonicalP1Json(existing) !== text) throw conflict();
        return true;
      }
      check();
      const entries = await opendir(dir, { bufferSize: 16 });
      try {
        let count = 0;
        for (;;) {
          check();
          const entry = await entries.read();
          check();
          if (!entry) break;
          if (++count > 14) throw new StudioError("VALIDATION_SCAN_LIMIT");
        }
      } finally {
        try {
          await entries.close();
        } catch {
          op.markRelatedIoUnknown();
          throw conflict();
        }
      }
      check();
      handle = await open(
        temp,
        constants.O_WRONLY |
          constants.O_CREAT |
          constants.O_EXCL |
          constants.O_NOFOLLOW |
          constants.O_NONBLOCK,
        0o600,
      );
      check();
      const owned = await handle.stat();
      check();
      privateFile(owned);
      if (owned.nlink !== 1) throw conflict();
      await handle.writeFile(text, "utf8");
      check();
      await handle.sync();
      check();
      await close(op, handle);
      handle = undefined;
      check();
      try {
        await link(temp, destination);
      } catch (error) {
        if (!present(error)) throw error;
      }
      check();
      const published = await readReceipt(op, config, id, attempt, check);
      if (!published || canonicalP1Json(published) !== text) throw conflict();
      const current = await lstat(temp);
      check();
      privateFile(current);
      if (current.ino !== owned.ino || current.dev !== owned.dev)
        throw conflict();
      await unlink(temp);
      check();
      handle = await open(
        dir,
        constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW,
      );
      check();
      await handle.sync();
      check();
      await close(op, handle);
      handle = undefined;
      check();
      return true;
    } catch (error) {
      if (error instanceof StudioError && !error.code.startsWith("RECEIVE_"))
        throw error;
      throw conflict();
    } finally {
      if (handle) await close(op, handle);
    }
  });
  if (published) {
    const candidate = validationStoppedReceiptSchema.parse(JSON.parse(text));
    const fields = {
      validationId: candidate.validationId,
      attemptId: candidate.attemptId,
      fence: candidate.fence,
      ownerPid: candidate.ownerPid,
      ownerNonce: candidate.ownerNonce,
      scope: candidate.scope,
      mediaStopped: candidate.mediaStopped,
      relatedIo: candidate.relatedIo,
    };
    const proof = validationFileStopProofSchema.parse({
      ...fields,
      schemaVersion: "quizpack-validation-file-stop-proof.v1",
      protocol: "candidate-receipt-db-ack.v1",
      receiptSha256: createHash("sha256").update(text).digest("hex"),
    });
    publications.set(op, { proof, bytes: Buffer.byteLength(text) });
  }
  return published;
}
