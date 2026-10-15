/** File-only receive regression owner. Credentials travel by IPC, never output. */
import { getDatabase, type P2aDatabase } from "../../src/lib/db/client";
import { StudioError } from "../../src/lib/http-security/errors";
import { importReceiveService } from "../../src/features/quizpack/import/service";
import { createReceiveContext } from "../../src/features/quizpack/import/context";
import type { StudioWriteCredentials } from "../../src/lib/auth/write";

type Start = {
  kind: "start";
  credentials: StudioWriteCredentials;
  productId: string;
  importId: string;
};
const send = (value: object) => {
  if (process.connected) process.send?.(value, () => {});
};
let resolveRead!: (value: IteratorResult<Uint8Array>) => void,
  resolveCancel!: () => void,
  resolveRelease!: () => void,
  readStarted = false,
  cancelStarted = false,
  readSettled = false,
  cancelSettled = false,
  started = false;
const pendingRead = new Promise<IteratorResult<Uint8Array>>((resolve) => {
  resolveRead = resolve;
});
const pendingCancel = new Promise<void>((resolve) => {
  resolveCancel = resolve;
});
const release = new Promise<void>((resolve) => {
  resolveRelease = resolve;
});
const readTask = pendingRead.then(() => {
  readSettled = true;
});
const cancelTask = pendingCancel.then(() => {
  cancelSettled = true;
});
function releaseOwnedSource() {
  resolveRead({ done: true, value: undefined });
  resolveCancel();
  resolveRelease();
}
const guard = setTimeout(() => {
  send({ kind: "failed" });
  process.exitCode = 1;
  releaseOwnedSource();
}, 20_000);
async function run(message: Start) {
  const { context, dispose } = createReceiveContext(
    new AbortController().signal,
  );
  // A finite overall budget covers real auth/claim/FS before the pending read.
  context.deadlineMonotonicMs = performance.now() + 5000;
  let database: P2aDatabase | undefined,
    code = "SUCCESS",
    databaseClosed = false;
  try {
    database = await getDatabase(context);
    await importReceiveService.receiveArchive(
      database,
      message.credentials,
      message.productId,
      message.importId,
      {
        chunks: {
          [Symbol.asyncIterator]() {
            return {
              next() {
                readStarted = true;
                send({ kind: "read-started" });
                return pendingRead;
              },
            };
          },
        },
        cancel() {
          cancelStarted = true;
          send({
            kind: "cancel-started",
            readPending: !readSettled,
            cancelPending: !cancelSettled,
          });
          return pendingCancel;
        },
      },
      context,
    );
  } catch (error) {
    code = error instanceof StudioError ? error.code : "TEST_RECEIVE_FAILED";
  } finally {
    try {
      if (database) {
        await database.close();
        databaseClosed = true;
      }
    } finally {
      dispose();
    }
  }
  send({
    kind: "result",
    code,
    readStarted,
    cancelStarted,
    readPending: !readSettled,
    cancelPending: !cancelSettled,
    databaseClosed,
  });
  await release;
  await Promise.all([readTask, cancelTask]);
  send({ kind: "drained", databaseClosed, readSettled, cancelSettled });
  clearTimeout(guard);
  if (process.connected) process.disconnect();
}
process.on("message", (message: Start | { kind: "release" }) => {
  if (message.kind === "release") releaseOwnedSource();
  else if (message.kind === "start" && !started) {
    started = true;
    void run(message).catch(() => {
      send({ kind: "failed" });
      process.exitCode = 1;
      releaseOwnedSource();
      clearTimeout(guard);
      if (process.connected) process.disconnect();
    });
  }
});
send({ kind: "ready" });
