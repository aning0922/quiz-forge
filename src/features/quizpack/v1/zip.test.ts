import { deflateRawSync } from "node:zlib";
import { Readable } from "node:stream";
import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { readRestrictedZip, withPackDeadline, throwIfAborted } from "./zip";

import { rawZip } from "./fixtures/raw-zip";

const good = () =>
  rawZip([{ name: "content.json", bytes: Buffer.from('{"ok":true}') }]);
const source = async function* (bytes: Buffer) {
  yield bytes;
};
const read = (bytes: Buffer, limits = {}) =>
  readRestrictedZip(source(bytes), { targetProductId: "synthetic", limits });
const code = async (bytes: Buffer, limits = {}) => {
  const result = await read(bytes, limits);
  return result.ok ? "OK" : result.issues[0]?.code;
};
const centralOffset = (bytes: Buffer) => bytes.readUInt32LE(bytes.length - 6);

describe("restricted ZIP", () => {
  it.each([0, 8])("reads method %i and verifies raw bytes", async (method) => {
    const bytes = Buffer.from("synthetic content");
    const result = await read(
      rawZip([{ name: "content.json", bytes, method }]),
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.files.get("content.json")).toEqual(bytes);
  });
  it("accepts exact input/file/total/entry limits and rejects plus one", async () => {
    const bytes = good();
    expect(
      await code(bytes, {
        archiveBytes: bytes.length,
        contentBytes: 11,
        totalUncompressedBytes: 11,
        entries: 1,
      }),
    ).toBe("OK");
    expect(await code(bytes, { archiveBytes: bytes.length - 1 })).toBe(
      "INPUT_SIZE_LIMIT",
    );
    expect(await code(bytes, { contentBytes: 10 })).toBe("ZIP_FILE_SIZE_LIMIT");
    expect(await code(bytes, { totalUncompressedBytes: 10 })).toBe(
      "ZIP_TOTAL_SIZE_LIMIT",
    );
    expect(
      await code(
        rawZip([
          { name: "content.json", bytes: Buffer.from("a") },
          { name: "manifest.json", bytes: Buffer.from("b") },
        ]),
        { entries: 1 },
      ),
    ).toBe("ZIP_ENTRY_LIMIT");
  });
  it.each([
    "../content.json",
    "Content.json",
    "/content.json",
    "assets/a%2e.png",
    "assets/../a.png",
    "assets\\a.png",
    "assets//a.png",
    "assets/a.png/",
    "assets/a.zip",
    "assets/a.ttf",
    "c:content.json",
    "assets/a\0.png",
  ])("rejects path %s", async (name) =>
    expect(await code(rawZip([{ name, bytes: Buffer.from("x") }]))).toBe(
      "ZIP_INVALID_PATH",
    ),
  );
  it("rejects duplicates", async () =>
    expect(
      await code(
        rawZip([
          { name: "content.json", bytes: Buffer.from("x") },
          { name: "content.json", bytes: Buffer.from("y") },
        ]),
      ),
    ).toBe("ZIP_DUPLICATE_PATH"));
  it.each([
    ["encryption", 8, 1, 2],
    ["descriptor", 8, 8, 2],
    ["method", 10, 12, 2],
    ["version", 6, 45, 2],
    ["extra", 30, 1, 2],
    ["comment", 32, 1, 2],
    ["volume", 34, 1, 2],
    ["ZIP64 size", 24, 0xffffffff, 4],
    ["ZIP64 offset", 42, 0xffffffff, 4],
    ["link", 38, (0o120644 << 16) >>> 0, 4],
    ["executable", 38, (0o100755 << 16) >>> 0, 4],
    ["device", 38, (0o020644 << 16) >>> 0, 4],
    ["directory", 38, 16, 4],
  ] as const)("rejects unsupported %s", async (_, offset, value, width) => {
    const bytes = good();
    const at = centralOffset(bytes) + offset;
    if (width === 2) bytes.writeUInt16LE(value, at);
    else bytes.writeUInt32LE(value, at);
    expect(await code(bytes)).toBe("ZIP_UNSUPPORTED_PROFILE");
  });
  it.each([6, 8, 10, 12, 14, 18, 22, 30])(
    "rejects mismatching local field %i",
    async (offset) => {
      const bytes = good();
      bytes[offset] = bytes[offset]! ^ 1;
      expect(await code(bytes)).toBe("ZIP_INVALID_STRUCTURE");
    },
  );
  it("rejects corrupt CRC even when both headers agree", async () => {
    const bytes = good();
    bytes.writeUInt32LE(0, 14);
    bytes.writeUInt32LE(0, centralOffset(bytes) + 16);
    expect(await code(bytes)).toBe("ZIP_CRC_MISMATCH");
  });
  it("rejects prefix, suffix, truncation, gaps and overlapping offsets", async () => {
    const bytes = good();
    for (const bad of [
      Buffer.concat([Buffer.from("x"), bytes]),
      Buffer.concat([bytes, Buffer.from("x")]),
      bytes.subarray(0, -1),
    ])
      expect(await code(bad)).toBe("ZIP_INVALID_STRUCTURE");
    const overlap = rawZip([
      { name: "content.json", bytes: Buffer.from("x") },
      { name: "manifest.json", bytes: Buffer.from("y") },
    ]);
    overlap.writeUInt32LE(
      0,
      centralOffset(overlap) + 46 + "content.json".length + 42,
    );
    expect(await code(overlap)).toBe("ZIP_INVALID_STRUCTURE");
    const hidden = good();
    hidden.writeUInt16LE(0, hidden.length - 14);
    hidden.writeUInt16LE(0, hidden.length - 12);
    expect(await code(hidden)).toBe("ZIP_INVALID_STRUCTURE");
  });
  it("rejects DEFLATE trailing bytes and a concatenated second stream", async () => {
    for (const tail of [
      Buffer.from("trailing"),
      deflateRawSync(Buffer.from("second")),
    ])
      expect(
        await code(
          rawZip([
            { name: "content.json", bytes: Buffer.from("x"), method: 8, tail },
          ]),
        ),
      ).toBe("ZIP_DEFLATE_TRAILING_BYTES");
  });
  it("rejects ratio and understated actual output before accepting CRC", async () => {
    expect(
      await code(
        rawZip([
          { name: "content.json", bytes: Buffer.alloc(10000), method: 8 },
        ]),
      ),
    ).toBe("ZIP_COMPRESSION_RATIO_LIMIT");
    const bytes = rawZip([
      { name: "content.json", bytes: Buffer.from("abcdefghijk"), method: 8 },
    ]);
    bytes.writeUInt32LE(1, 22);
    bytes.writeUInt32LE(1, centralOffset(bytes) + 24);
    expect(await code(bytes)).toBe("ZIP_ACTUAL_SIZE_LIMIT");
    bytes.writeUInt32LE(12, 22);
    bytes.writeUInt32LE(12, centralOffset(bytes) + 24);
    expect(await code(bytes)).toBe("ZIP_SIZE_MISMATCH");
  });
  it("closes input on size failure and on cancellation", async () => {
    let closed = false;
    const chunks = async function* () {
      try {
        yield good();
        yield good();
      } finally {
        closed = true;
      }
    };
    const result = await readRestrictedZip(chunks(), {
      targetProductId: "synthetic",
      limits: { archiveBytes: 1 },
    });
    expect(result.ok).toBe(false);
    await Promise.resolve();
    expect(closed).toBe(true);
    const stream = new Readable({ read() {} });
    const controller = new AbortController();
    const promise = readRestrictedZip(stream, {
      targetProductId: "synthetic",
      signal: controller.signal,
    });
    controller.abort();
    const aborted = await promise;
    expect(aborted.ok ? "OK" : aborted.issues[0]?.code).toBe(
      "OPERATION_CANCELLED",
    );
    expect(stream.destroyed).toBe(true);
  });
  it("times out a stalled stream and closes it", async () => {
    const stream = new Readable({ read() {} });
    const result = await readRestrictedZip(stream, {
      targetProductId: "synthetic",
      limits: { operationMs: 5 },
    });
    expect(result.ok ? "OK" : result.issues[0]?.code).toBe("OPERATION_TIMEOUT");
    expect(stream.destroyed).toBe(true);
  });
  it("redacts IO failures and rejects raised limits", async () => {
    const stream = async function* () {
      throw new Error("/private/secret");
      yield Buffer.alloc(0);
    };
    expect(
      await readRestrictedZip(stream(), { targetProductId: "synthetic" }),
    ).toEqual({
      ok: false,
      issues: [
        {
          code: "ZIP_READ_FAILED",
          path: [],
          message: "QuizPack operation rejected.",
        },
      ],
    });
    expect(await code(good(), { entries: 67 })).toBe("INVALID_LIMITS");
  });
  it("rejects noncanonical resource IDs and overlong names", async () => {
    for (const name of [
      "assets/0portrait.png",
      "assets/a_b.png",
      `assets/${"a".repeat(90)}.png`,
    ])
      expect(await code(rawZip([{ name, bytes: Buffer.from("x") }]))).toBe(
        "ZIP_INVALID_PATH",
      );
  });
  it("enforces resource count and individual byte boundaries", async () => {
    const bytes = rawZip([
      { name: "assets/one.png", bytes: Buffer.from("xy") },
      { name: "assets/two.png", bytes: Buffer.from("ab") },
    ]);
    expect(
      await code(bytes, {
        resources: 2,
        resourceBytes: 2,
        totalUncompressedBytes: 4,
      }),
    ).toBe("OK");
    expect(await code(bytes, { resources: 1 })).toBe("ZIP_RESOURCE_LIMIT");
    expect(await code(bytes, { resourceBytes: 1 })).toBe("ZIP_FILE_SIZE_LIMIT");
  });
  it("rejects local extra/version mismatch and EOCD unsupported fields", async () => {
    const extra = good();
    extra.writeUInt16LE(1, 28);
    expect(await code(extra)).toBe("ZIP_UNSUPPORTED_PROFILE");
    const version = good();
    version.writeUInt16LE(10, 4);
    expect(await code(version)).toBe("ZIP_INVALID_STRUCTURE");
    for (const offset of [4, 6, 20]) {
      const bytes = good();
      bytes.writeUInt16LE(1, bytes.length - 22 + offset);
      expect(await code(bytes)).toBe("ZIP_UNSUPPORTED_PROFILE");
    }
    const zip64 = good();
    zip64.writeUInt32LE(0xffffffff, zip64.length - 6);
    expect(await code(zip64)).toBe("ZIP_UNSUPPORTED_PROFILE");
    const commented = good();
    commented.writeUInt16LE(1, commented.length - 2);
    expect(await code(Buffer.concat([commented, Buffer.from("x")]))).toBe(
      "ZIP_UNSUPPORTED_PROFILE",
    );
  });
  it("rejects high-bit local aliases and broken/truncated compressed streams", async () => {
    const alias = good();
    alias[30] = alias[30]! | 0x80;
    expect(await code(alias)).toBe("ZIP_INVALID_STRUCTURE");
    const broken = rawZip([
      { name: "content.json", bytes: Buffer.from("synthetic"), method: 8 },
    ]);
    broken.fill(0xff, 42, centralOffset(broken));
    expect(await code(broken)).toBe("ZIP_READ_FAILED");
  });
  it("bounds tiny/empty chunk bookkeeping and yields to deadline timers", async () => {
    const bytes = good();
    const tiny = async function* () {
      for (const byte of bytes) {
        yield Buffer.alloc(0);
        yield Buffer.from([byte]);
      }
    };
    expect(
      (await readRestrictedZip(tiny(), { targetProductId: "synthetic" })).ok,
    ).toBe(true);
    let closed = false;
    const endless = async function* () {
      try {
        while (true) yield Buffer.alloc(0);
      } finally {
        closed = true;
      }
    };
    const result = await readRestrictedZip(endless(), {
      targetProductId: "synthetic",
      limits: { operationMs: 5 },
    });
    expect(result.ok ? "OK" : result.issues[0]?.code).toBe("OPERATION_TIMEOUT");
    await Promise.resolve();
    expect(closed).toBe(true);
  });
  it("rejects an immediately supplied 28 MiB STORE archive under a 1ms deadline", async () => {
    const bytes = rawZip(
      ["a", "b", "c", "d"].map((name) => ({
        name: `assets/${name}.png`,
        bytes: Buffer.alloc(7 * 1024 * 1024, 17),
      })),
    );
    expect(bytes.length).toBeLessThan(32 * 1024 * 1024);
    expect(await code(bytes, { operationMs: 1 })).toBe("OPERATION_TIMEOUT");
  });
  it("monotonic deadline rejects synchronous work even before a timer can run", async () => {
    await expect(
      withPackDeadline(
        { targetProductId: "synthetic", limits: { operationMs: 1 } },
        async (signal) => {
          const until = performance.now() + 5;
          while (performance.now() < until) {}
          throwIfAborted(signal);
          return "unsafe-success";
        },
      ),
    ).rejects.toMatchObject({ code: "OPERATION_TIMEOUT" });
  });
  it("nested operations inherit the original deadline without resetting it", async () => {
    await expect(
      withPackDeadline(
        { targetProductId: "synthetic", limits: { operationMs: 10 } },
        async (signal) => {
          const until = performance.now() + 6;
          while (performance.now() < until) {}
          return withPackDeadline(
            { targetProductId: "synthetic", signal },
            async (inner) => {
              const until = performance.now() + 6;
              while (performance.now() < until) {}
              throwIfAborted(inner);
              return "unsafe-success";
            },
          );
        },
      ),
    ).rejects.toMatchObject({ code: "OPERATION_TIMEOUT" });
  });
});
