import { Readable } from "node:stream";
import { expect, it } from "vitest";
import {
  readRecoveryDownloadBytes,
  RECOVERY_DOWNLOAD_MAX_BYTES,
} from "./download-bytes";
import { freshBudget } from "./artifact-fixture";

it("returns bounded bytes only after end and actual local close", async () => {
  const stream = Readable.from([Buffer.from("real "), Buffer.from("stream")]);
  const bytes = await readRecoveryDownloadBytes(
    { createReadStream: async () => stream },
    freshBudget(),
  );
  expect(bytes.toString()).toBe("real stream");
  expect(stream.closed).toBe(true);
});
it("destroys an over-budget stream and waits its close before rejecting", async () => {
  const stream = Readable.from([
    Buffer.alloc(RECOVERY_DOWNLOAD_MAX_BYTES),
    Buffer.from("x"),
  ]);
  await expect(
    readRecoveryDownloadBytes(
      { createReadStream: async () => stream },
      freshBudget(),
    ),
  ).rejects.toThrow("RECOVERY_DOWNLOAD_LIMIT_EXCEEDED");
  expect(stream.closed).toBe(true);
});
it("closes an in-progress stream after cancellation", async () => {
  const stream = new Readable({ read() {} });
  const controller = new AbortController();
  const work = readRecoveryDownloadBytes(
    { createReadStream: async () => stream },
    { ...freshBudget(), signal: controller.signal },
  );
  setImmediate(() => controller.abort());
  await expect(work).rejects.toThrow("RECOVERY_DOWNLOAD_INTERRUPTED");
  expect(stream.closed).toBe(true);
});

it("does not grant success when end precedes the deadline but close follows it", async () => {
  const stream = new Readable({
    autoDestroy: false,
    read() {
      this.push(Buffer.from("x"));
      this.push(null);
    },
  });
  stream.once("end", () => setTimeout(() => stream.destroy(), 80));
  await expect(
    readRecoveryDownloadBytes(
      { createReadStream: async () => stream },
      freshBudget(30),
    ),
  ).rejects.toThrow();
  expect(stream.closed).toBe(true);
});

// Last: unknown creation permanently denies later admission, even after its late stream really closes.
it("bounds an unresolved creation, owns late cleanup, and never clears its unknown latch", async () => {
  let resolveCreation!: (stream: Readable) => void;
  const creation = new Promise<Readable>((resolve) => {
    resolveCreation = resolve;
  });
  const controller = new AbortController();
  const work = readRecoveryDownloadBytes(
    { createReadStream: () => creation },
    { ...freshBudget(), signal: controller.signal },
  );
  await Promise.resolve();
  controller.abort();
  await expect(work).rejects.toThrow("RECOVERY_DOWNLOAD_INTERRUPTED");
  const late = Readable.from([Buffer.from("late")]);
  const closed = new Promise<void>((resolve) =>
    late.once("close", () => resolve()),
  );
  resolveCreation(late);
  await closed;
  expect(late.closed).toBe(true);
  await expect(
    readRecoveryDownloadBytes(
      { createReadStream: async () => Readable.from([]) },
      freshBudget(),
    ),
  ).rejects.toThrow("RECOVERY_DOWNLOAD_CLOSE_UNPROVEN");
});
