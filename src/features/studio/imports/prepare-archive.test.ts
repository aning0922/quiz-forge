import { describe, expect, it, vi } from "vitest";
import { prepareArchive } from "./prepare-archive";

describe("local archive preparation", () => {
  it("rejects empty and oversized files before any byte read", async () => {
    for (const size of [0, 33_554_433]) {
      const file = { size, arrayBuffer: vi.fn() } as unknown as Blob;
      await expect(prepareArchive(file, 33_554_432)).rejects.toThrow(
        "ARCHIVE_SIZE_INVALID",
      );
      expect(file.arrayBuffer).not.toHaveBeenCalled();
    }
  });
  it("retains the complete immutable request and exact file with one canonical key", async () => {
    const file = new Blob(["abc"]);
    const pending = await prepareArchive(file, 33_554_432);
    expect(pending.file).toBe(file);
    expect(pending.input).toEqual({
      expectedArchiveBytes: 3,
      expectedArchiveSha256:
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
      target: { kind: "new-draft" },
    });
    expect(pending.idempotencyKey).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});
