import { getEventListeners } from "node:events";
import { Readable } from "node:stream";
import { expect, it, vi } from "vitest";
import { readRecoveryDownloadBytes } from "./download-bytes";
import { freshBudget } from "./artifact-fixture";

it("retires deadline/abort observers on unknown close while retaining late actual ownership", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  let finish!: (error?: Error | null) => void;
  const stream = new Readable({
    read() {
      this.push(Buffer.from("x"));
      this.push(null);
    },
    destroy(_error, callback) {
      finish = callback;
    },
  });
  const controller = new AbortController();
  try {
    const result = readRecoveryDownloadBytes(
      { createReadStream: async () => stream },
      { ...freshBudget(), signal: controller.signal },
    );
    const rejected = expect(result).rejects.toThrow(
      "RECOVERY_DOWNLOAD_CLOSE_UNPROVEN",
    );
    await new Promise<void>((resolve) => process.nextTick(resolve));
    await vi.advanceTimersByTimeAsync(5000);
    await rejected;
    expect(vi.getTimerCount()).toBe(0);
    expect(getEventListeners(controller.signal, "abort")).toHaveLength(0);
    const closed = new Promise<void>((resolve) =>
      stream.once("close", () => resolve()),
    );
    finish(null);
    await closed;
    expect(stream.closed).toBe(true);
    await expect(
      readRecoveryDownloadBytes(
        { createReadStream: async () => Readable.from([]) },
        freshBudget(),
      ),
    ).rejects.toThrow("RECOVERY_DOWNLOAD_CLOSE_UNPROVEN");
  } finally {
    vi.useRealTimers();
  }
});
