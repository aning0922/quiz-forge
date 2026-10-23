import type { Download } from "@playwright/test";
import type { Readable } from "node:stream";
import type { RecoveryBudget } from "@/features/runtime-recovery/ports";
import { checkRecoveryBudget } from "@/features/runtime-recovery/files";

export const RECOVERY_DOWNLOAD_MAX_BYTES = 16_777_216;
const uncertain = new Set<unknown>();
/** A close event, rather than pipe finish, terminates the locally owned download stream. */
export async function readRecoveryDownloadBytes(
  download: Pick<Download, "createReadStream">,
  budget: RecoveryBudget,
): Promise<Buffer> {
  if (uncertain.size) throw Error("RECOVERY_DOWNLOAD_CLOSE_UNPROVEN");
  checkRecoveryBudget(budget);
  const owner: {
    creation?: Promise<Readable | null>;
    stream?: Readable | null;
    lateClose?: Promise<void>;
  } = {};
  let failed = false,
    settled = false;
  let interrupted!: () => void;
  const admission = new Promise<never>((_, reject) => {
    interrupted = () => {
      if (settled || failed) return;
      failed = true;
      uncertain.add(owner); // Retain the unresolved creation itself, not just a timeout flag.
      reject(Error("RECOVERY_DOWNLOAD_INTERRUPTED"));
    };
  });
  const timer = setTimeout(
    interrupted,
    Math.max(
      1,
      Math.min(30_000, budget.deadlineMonotonicMs - performance.now()),
    ),
  );
  budget.signal.addEventListener("abort", interrupted, { once: true });
  let stream: Readable | null;
  try {
    owner.creation = download.createReadStream().then(
      (stream) => {
        settled = true;
        owner.stream = stream;
        if (failed && stream)
          owner.lateClose = closeLateStream(stream).catch(() => {});
        return stream;
      },
      () => {
        settled = true;
        throw Error("RECOVERY_DOWNLOAD_FAILED");
      },
    );
    if (budget.signal.aborted) interrupted();
    stream = await Promise.race([owner.creation, admission]);
  } finally {
    clearTimeout(timer);
    budget.signal.removeEventListener("abort", interrupted);
  }
  if (!stream) throw Error("RECOVERY_DOWNLOAD_FAILED");
  return readOwned(stream, budget);
}
/** Creation can resolve after the caller already failed and began closing its context/browser. */
function closeLateStream(stream: Readable): Promise<void> {
  return new Promise((resolve, reject) => {
    if (stream.closed) {
      resolve();
      return;
    }
    const timer = setTimeout(
      () => reject(Error("RECOVERY_DOWNLOAD_CLOSE_UNPROVEN")),
      5_000,
    );
    stream.on("error", () => {});
    stream.once("close", () => {
      clearTimeout(timer);
      resolve();
    });
    stream.destroy();
  });
}
function readOwned(stream: Readable, budget: RecoveryBudget): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const owner = { stream, chunks: [] as Buffer[] };
    let bytes = 0,
      ended = false,
      closed = false;
    let failure: Error | undefined;
    let closeTimer: ReturnType<typeof setTimeout> | undefined;
    const awaitClose = () => {
      if (closed || closeTimer) return;
      closeTimer = setTimeout(() => {
        uncertain.add(owner); // Late close cannot recover this invocation/process's authority.
        failure ??= Error("RECOVERY_DOWNLOAD_CLOSE_UNPROVEN");
        clearTimeout(timer);
        budget.signal.removeEventListener("abort", aborted);
        reject(Error("RECOVERY_DOWNLOAD_CLOSE_UNPROVEN"));
      }, 5_000);
    };
    const stop = (error: Error) => {
      failure ??= error;
      if (!stream.destroyed) stream.destroy();
      awaitClose();
    };
    const aborted = () => stop(Error("RECOVERY_DOWNLOAD_INTERRUPTED"));
    const timer = setTimeout(
      aborted,
      Math.max(
        1,
        Math.min(30_000, budget.deadlineMonotonicMs - performance.now()),
      ),
    );
    budget.signal.addEventListener("abort", aborted, { once: true });
    stream.on("data", (chunk: Buffer | string) => {
      if (failure) return;
      try {
        checkRecoveryBudget(budget);
      } catch {
        aborted();
        return;
      }
      const buffer = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
      if (bytes + buffer.length > RECOVERY_DOWNLOAD_MAX_BYTES) {
        stop(Error("RECOVERY_DOWNLOAD_LIMIT_EXCEEDED"));
        return;
      }
      bytes += buffer.length;
      owner.chunks.push(Buffer.from(buffer));
    });
    stream.once("end", () => {
      ended = true;
      awaitClose();
    });
    stream.on("error", () => stop(Error("RECOVERY_DOWNLOAD_FAILED")));
    stream.once("close", () => {
      closed = true;
      clearTimeout(timer);
      if (closeTimer) clearTimeout(closeTimer);
      budget.signal.removeEventListener("abort", aborted);
      if (uncertain.has(owner)) return;
      if (failure) reject(failure);
      else if (!ended) reject(Error("RECOVERY_DOWNLOAD_FAILED"));
      else {
        try {
          if (uncertain.size) throw Error("RECOVERY_DOWNLOAD_CLOSE_UNPROVEN");
          checkRecoveryBudget(budget);
          resolve(Buffer.concat(owner.chunks, bytes));
        } catch (error) {
          reject(error);
        }
      }
    });
    if (budget.signal.aborted) aborted();
    else stream.resume();
  });
}
