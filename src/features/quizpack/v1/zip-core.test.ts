import { describe, expect, it } from "vitest";
import { rawZip } from "./fixtures/raw-zip";
import { PACK_LIMITS } from "./limits";
import { PackToolError, readRestrictedZipCore, throwIfAborted } from "./zip";

const source = async function* (bytes: Uint8Array) {
  yield bytes;
};
describe("owned restricted ZIP execution core", () => {
  it("registers and settles the real native inflater close on success", async () => {
    const tasks: Promise<void>[] = [];
    const signal = new AbortController().signal;
    const bytes = Buffer.from("synthetic compressed JSON");
    const result = await readRestrictedZipCore(
      source(rawZip([{ name: "content.json", bytes, method: 8 }])),
      {
        signal,
        limits: PACK_LIMITS,
        checkpoint: () => throwIfAborted(signal),
        trackIo: (task) => tasks.push(task),
      },
    );
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
    expect(result.files.get("content.json")).toEqual(bytes);
  });
  it("propagates failure without losing the real pending close proof", async () => {
    const tasks: Promise<void>[] = [];
    const signal = new AbortController().signal;
    const archive = rawZip([
      {
        name: "content.json",
        bytes: Buffer.from("synthetic"),
        method: 8,
        tail: Buffer.from([0, 0, 0]),
      },
    ]);
    await expect(
      readRestrictedZipCore(source(archive), {
        signal,
        limits: PACK_LIMITS,
        checkpoint: () => throwIfAborted(signal),
        trackIo: (task) => tasks.push(task),
      }),
    ).rejects.toMatchObject({ code: "ZIP_DEFLATE_TRAILING_BYTES" });
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
  });
  it("stops new inflate work on absolute checkpoint cancellation", async () => {
    const controller = new AbortController();
    const tasks: Promise<void>[] = [];
    const archive = rawZip([
      { name: "content.json", bytes: Buffer.from("synthetic"), method: 8 },
    ]);
    await expect(
      readRestrictedZipCore(source(archive), {
        signal: controller.signal,
        limits: PACK_LIMITS,
        checkpoint: () => {
          throwIfAborted(controller.signal);
        },
        trackIo: (task) => {
          tasks.push(task);
          controller.abort(new PackToolError("OPERATION_CANCELLED"));
        },
      }),
    ).rejects.toMatchObject({ code: "OPERATION_CANCELLED" });
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
  });
  it("handles deadline abort after listener registration but before native input", async () => {
    const controller = new AbortController();
    const tasks: Promise<void>[] = [];
    let checkpoints = 0;
    const archive = rawZip([
      { name: "content.json", bytes: Buffer.from("synthetic"), method: 8 },
    ]);
    await expect(
      readRestrictedZipCore(source(archive), {
        signal: controller.signal,
        limits: PACK_LIMITS,
        checkpoint: () => {
          if (++checkpoints === 5) controller.abort();
          throwIfAborted(controller.signal);
        },
        trackIo: (task) => tasks.push(task),
      }),
    ).rejects.toMatchObject({ code: "OPERATION_CANCELLED" });
    expect(tasks).toHaveLength(1);
    await Promise.all(tasks);
  });
});
