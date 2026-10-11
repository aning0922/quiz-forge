import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import type { ChildProcess } from "node:child_process";
import sharp from "sharp";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ImageDeclaration, ImageInspectionContext } from "./api";
import {
  createSyntheticFixture,
  type SyntheticFixture,
} from "./fixtures/synthetic";
import { PACK_LIMITS } from "./limits";

const tracking = vi.hoisted(() => ({
  children: [] as ChildProcess[],
  active: 0,
  peak: 0,
  mode: "normal" as
    "normal" | "spawn-error" | "malformed" | "oversized" | "success",
  beforeClose: undefined as (() => void) | undefined,
}));
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (...args: Parameters<typeof actual.spawn>) => {
      const child =
        tracking.mode === "spawn-error"
          ? actual.spawn("/quizforge-nonexistent-test-executable", [], {
              stdio: ["pipe", "pipe", "ignore"],
            })
          : tracking.mode === "normal"
            ? actual.spawn(...args)
            : actual.spawn(
                process.execPath,
                [
                  "-e",
                  tracking.mode === "malformed"
                    ? "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('UNTRUSTED-DIAGNOSTIC'));"
                    : tracking.mode === "success"
                      ? "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write(JSON.stringify({ok:true,mediaType:'image/png',width:8,height:7,frames:1,mediaDecoded:true})));"
                      : "process.stdin.resume();process.stdin.on('end',()=>process.stdout.write('x'.repeat(4096)));",
                ],
                { stdio: ["pipe", "pipe", "ignore"] },
              );
      tracking.children.push(child);
      tracking.active++;
      tracking.peak = Math.max(tracking.peak, tracking.active);
      child.once("close", () => {
        tracking.active--;
        tracking.beforeClose?.();
      });
      return child;
    },
  };
});
import { inspectImage } from "./media";

let fixture: SyntheticFixture;
beforeAll(async () => {
  fixture = await createSyntheticFixture();
});
beforeEach(() => {
  tracking.children = [];
  tracking.active = 0;
  tracking.peak = 0;
  tracking.mode = "normal";
  tracking.beforeClose = undefined;
});
afterEach(() => vi.restoreAllMocks());
const context = (
  overrides: Partial<ImageInspectionContext["limits"]> = {},
  signal = new AbortController().signal,
): ImageInspectionContext => ({
  signal,
  limits: {
    resourceBytes: PACK_LIMITS.resourceBytes,
    imageDimension: PACK_LIMITS.imageDimension,
    imagePixels: PACK_LIMITS.imagePixels,
    imageMs: PACK_LIMITS.imageMs,
    ...overrides,
  },
});
const declaration = (
  bytes: Uint8Array,
  extra: Partial<ImageDeclaration> = {},
): ImageDeclaration => ({
  path: "assets/synthetic.png",
  mediaType: "image/png",
  bytes: bytes.length,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  width: 8,
  height: 7,
  ...extra,
});
const code = (result: Awaited<ReturnType<typeof inspectImage>>) =>
  result.ok ? "passed" : result.issues[0]!.code;
const noLiveChildren = () => {
  expect(tracking.active).toBe(0);
  for (const child of tracking.children) {
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    if (child.pid) expect(() => process.kill(child.pid!, 0)).toThrow();
  }
};

describe("complete static image decode", () => {
  it("fully decodes PNG/JPEG/WebP and returns actual facts", async () => {
    for (const asset of fixture.assets) {
      const resource = fixture.content.resources.find(
        (resource) => resource.path === asset.path,
      )!;
      const result = await inspectImage(asset.bytes, resource, context());
      expect(result).toEqual({
        ok: true,
        value: {
          mediaType: resource.mediaType,
          width: resource.width,
          height: resource.height,
          frames: 1,
          mediaDecoded: true,
        },
      });
    }
    expect(tracking.children.length).toBe(4);
    noLiveChildren();
  });
  it("checks exact byte/hash declarations before spawning", async () => {
    const bytes = fixture.assets[0]!.bytes;
    expect(
      code(
        await inspectImage(
          bytes,
          declaration(bytes, { bytes: bytes.length + 1 }),
          context(),
        ),
      ),
    ).toBe("MEDIA_INTEGRITY_MISMATCH");
    expect(
      code(
        await inspectImage(
          bytes,
          declaration(bytes, { sha256: "0".repeat(64) }),
          context(),
        ),
      ),
    ).toBe("MEDIA_INTEGRITY_MISMATCH");
    expect(tracking.children).toHaveLength(0);
  });
  it("checks magic, MIME, extension and refuses fonts or SVG", async () => {
    const bytes = fixture.assets[0]!.bytes;
    expect(
      code(
        await inspectImage(
          bytes,
          declaration(bytes, {
            path: "assets/synthetic.jpg",
            mediaType: "image/jpeg",
          }),
          context(),
        ),
      ),
    ).toBe("MEDIA_FORMAT_MISMATCH");
    expect(
      code(
        await inspectImage(
          bytes,
          declaration(bytes, { path: "assets/synthetic.webp" }),
          context(),
        ),
      ),
    ).toBe("MEDIA_FORMAT_MISMATCH");
    for (const raw of [
      "<svg>synthetic</svg>",
      "wOFFsynthetic",
      "OTTOsynthetic",
    ]) {
      const value = Buffer.from(raw);
      expect(
        code(await inspectImage(value, declaration(value), context())),
      ).toBe("MEDIA_FORMAT_MISMATCH");
    }
    expect(
      code(
        await inspectImage(
          bytes,
          declaration(bytes, { path: "assets/font.woff2" }),
          context(),
        ),
      ),
    ).toBe("MEDIA_DECLARATION_INVALID");
    expect(tracking.children).toHaveLength(0);
  });
  it("rejects wrong declared dimensions after successful full decode", async () => {
    const bytes = fixture.assets[0]!.bytes;
    expect(
      code(
        await inspectImage(bytes, declaration(bytes, { width: 7 }), context()),
      ),
    ).toBe("MEDIA_DECLARATION_MISMATCH");
    noLiveChildren();
  });
  it("rejects a PNG whose metadata succeeds but its pixels are broken", async () => {
    const bytes = Buffer.from(fixture.assets[0]!.bytes);
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = bytes.readUInt32BE(offset);
      if (bytes.toString("ascii", offset + 4, offset + 8) === "IDAT") {
        bytes.fill(0, offset + 8, offset + 8 + length);
        break;
      }
      offset += length + 12;
    }
    expect((await sharp(bytes).metadata()).width).toBe(8);
    expect(code(await inspectImage(bytes, declaration(bytes), context()))).toBe(
      "MEDIA_DECODE_FAILED",
    );
    noLiveChildren();
  });
  it("rejects a truncated JPEG even when metadata can be read", async () => {
    const original = fixture.assets[1]!.bytes;
    const bytes = Buffer.from(original.subarray(0, original.length - 10));
    expect((await sharp(bytes).metadata()).format).toBe("jpeg");
    expect(
      code(
        await inspectImage(
          bytes,
          declaration(bytes, {
            path: "assets/synthetic.jpg",
            mediaType: "image/jpeg",
            width: 9,
            height: 8,
          }),
          context(),
        ),
      ),
    ).toBe("MEDIA_DECODE_FAILED");
    noLiveChildren();
  });
  it("rejects APNG animation chunks even if libvips sees one default image", async () => {
    const original = Buffer.from(fixture.assets[0]!.bytes);
    const chunk = Buffer.alloc(20);
    chunk.writeUInt32BE(8, 0);
    chunk.write("acTL", 4, "ascii");
    chunk.writeUInt32BE(2, 8);
    const bytes = Buffer.concat([
      original.subarray(0, 33),
      chunk,
      original.subarray(33),
    ]);
    expect(code(await inspectImage(bytes, declaration(bytes), context()))).toBe(
      "MEDIA_ANIMATED",
    );
    expect(tracking.children).toHaveLength(0);
  });
  it("rejects actual animated WebP", async () => {
    const pixels = Buffer.alloc(4 * 8 * 3, 100);
    pixels.fill(200, pixels.length / 2);
    const bytes = await sharp(pixels, {
      raw: { width: 4, height: 8, channels: 3, pageHeight: 4 },
    })
      .webp({ loop: 0, delay: [100, 100] })
      .toBuffer();
    expect((await sharp(bytes, { animated: true }).metadata()).pages).toBe(2);
    expect(
      code(
        await inspectImage(
          bytes,
          declaration(bytes, {
            path: "assets/synthetic.webp",
            mediaType: "image/webp",
            width: 4,
            height: 4,
          }),
          context(),
        ),
      ),
    ).toBe("MEDIA_ANIMATED");
    expect(tracking.children).toHaveLength(0);
  });
});

describe("effective limits, timeout and cancellation cleanup", () => {
  it("accepts exact size/dimension/pixel limits and rejects +1", async () => {
    const bytes = fixture.assets[0]!.bytes;
    expect(
      code(
        await inspectImage(
          bytes,
          declaration(bytes),
          context({
            resourceBytes: bytes.length,
            imageDimension: 8,
            imagePixels: 56,
          }),
        ),
      ),
    ).toBe("passed");
    for (const override of [
      { resourceBytes: bytes.length - 1 },
      { imageDimension: 7 },
      { imagePixels: 55 },
    ])
      expect(
        code(await inspectImage(bytes, declaration(bytes), context(override))),
      ).toBe("MEDIA_LIMIT");
    noLiveChildren();
  });
  it("applies actual dimension/pixel limits despite smaller false declarations", async () => {
    const bytes = await sharp({
      create: { width: 20, height: 20, channels: 3, background: "red" },
    })
      .png()
      .toBuffer();
    for (const override of [{ imageDimension: 10 }, { imagePixels: 100 }]) {
      const result = await inspectImage(
        bytes,
        declaration(bytes, { width: 1, height: 1 }),
        context(override),
      );
      expect(result.ok).toBe(false);
    }
    noLiveChildren();
  });
  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY, 5001, 1.5])(
    "rejects invalid or raised image deadline %s",
    async (imageMs) => {
      const bytes = fixture.assets[0]!.bytes;
      expect(
        code(
          await inspectImage(bytes, declaration(bytes), context({ imageMs })),
        ),
      ).toBe("INVALID_LIMITS");
      expect(tracking.children).toHaveLength(0);
    },
  );
  it("does not spawn for an already cancelled signal", async () => {
    const controller = new AbortController();
    controller.abort();
    const bytes = fixture.assets[0]!.bytes;
    expect(
      code(
        await inspectImage(
          bytes,
          declaration(bytes),
          context({}, controller.signal),
        ),
      ),
    ).toBe("MEDIA_CANCELLED");
    expect(tracking.children).toHaveLength(0);
  });
  it("times out and kills/reaps worker before resolving", async () => {
    const bytes = fixture.assets[0]!.bytes;
    expect(
      code(
        await inspectImage(bytes, declaration(bytes), context({ imageMs: 10 })),
      ),
    ).toBe("MEDIA_TIMEOUT");
    expect(tracking.children).toHaveLength(1);
    expect(tracking.children[0]!.signalCode).toBe("SIGKILL");
    noLiveChildren();
  });
  it("cancels a running worker and does not poison the next decode", async () => {
    const bytes = fixture.assets[0]!.bytes;
    const controller = new AbortController();
    const promise = inspectImage(
      bytes,
      declaration(bytes),
      context({}, controller.signal),
    );
    await vi.waitFor(() => expect(tracking.children.length).toBe(1), {
      interval: 1,
    });
    controller.abort();
    expect(code(await promise)).toBe("MEDIA_CANCELLED");
    noLiveChildren();
    expect(code(await inspectImage(bytes, declaration(bytes), context()))).toBe(
      "passed",
    );
    noLiveChildren();
  });
  it("serializes decoders, cancels queued jobs without spawning and recovers", async () => {
    const bytes = fixture.assets[0]!.bytes;
    const controller = new AbortController();
    const first = inspectImage(bytes, declaration(bytes), context());
    const cancelled = inspectImage(
      bytes,
      declaration(bytes),
      context({}, controller.signal),
    );
    const third = inspectImage(bytes, declaration(bytes), context());
    controller.abort();
    expect(code(await cancelled)).toBe("MEDIA_CANCELLED");
    expect(code(await first)).toBe("passed");
    expect(code(await third)).toBe("passed");
    expect(tracking.children).toHaveLength(2);
    expect(tracking.peak).toBe(1);
    noLiveChildren();
  });
  it("covers queue waiting in the media deadline", async () => {
    const bytes = fixture.assets[0]!.bytes;
    const first = inspectImage(bytes, declaration(bytes), context());
    const queued = inspectImage(
      bytes,
      declaration(bytes),
      context({ imageMs: 10 }),
    );
    expect(code(await queued)).toBe("MEDIA_TIMEOUT");
    expect(code(await first)).toBe("passed");
    expect(tracking.children).toHaveLength(1);
    noLiveChildren();
  });
  it("snapshots bytes and declarations before asynchronous work", async () => {
    const bytes = Buffer.from(fixture.assets[0]!.bytes);
    const expected = declaration(bytes);
    const promise = inspectImage(bytes, expected, context());
    bytes.fill(0);
    expected.width = 1;
    expect(code(await promise)).toBe("passed");
    noLiveChildren();
  });
});

describe("worker protocol failures", () => {
  it.each(["spawn-error", "malformed", "oversized"] as const)(
    "fails closed on %s and releases decoder",
    async (mode) => {
      tracking.mode = mode;
      const bytes = fixture.assets[0]!.bytes;
      const result = await inspectImage(bytes, declaration(bytes), context());
      expect(code(result)).toBe("MEDIA_WORKER_FAILED");
      expect(JSON.stringify(result)).not.toContain("UNTRUSTED-DIAGNOSTIC");
      expect(tracking.active).toBe(0);
      tracking.mode = "normal";
      expect(
        code(await inspectImage(bytes, declaration(bytes), context())),
      ).toBe("passed");
      expect(tracking.active).toBe(0);
    },
  );
});

describe("monotonic deadline checks independent of timer dispatch", () => {
  it("refuses to spawn after synchronous checks have consumed the deadline", async () => {
    vi.spyOn(performance, "now").mockReturnValueOnce(0).mockReturnValue(5000);
    const bytes = fixture.assets[0]!.bytes;
    expect(code(await inspectImage(bytes, declaration(bytes), context()))).toBe(
      "MEDIA_TIMEOUT",
    );
    expect(tracking.children).toHaveLength(0);
  });
  it("refuses to spawn after acquire yields even when timer has not fired", async () => {
    let tick = 0;
    vi.spyOn(performance, "now").mockImplementation(() => tick);
    const bytes = fixture.assets[0]!.bytes;
    const pending = inspectImage(bytes, declaration(bytes), context());
    tick = 5000;
    expect(code(await pending)).toBe("MEDIA_TIMEOUT");
    expect(tracking.children).toHaveLength(0);
  });
  it("checks again immediately before spawn", async () => {
    vi.spyOn(performance, "now")
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(0)
      .mockReturnValue(5000);
    const bytes = fixture.assets[0]!.bytes;
    expect(code(await inspectImage(bytes, declaration(bytes), context()))).toBe(
      "MEDIA_TIMEOUT",
    );
    expect(tracking.children).toHaveLength(0);
  });
  it("rejects a successful worker closing after deadline without waiting for the timer", async () => {
    let tick = 0;
    vi.spyOn(performance, "now").mockImplementation(() => tick);
    tracking.mode = "success";
    tracking.beforeClose = () => {
      tick = 5000;
    };
    const bytes = fixture.assets[0]!.bytes;
    expect(code(await inspectImage(bytes, declaration(bytes), context()))).toBe(
      "MEDIA_TIMEOUT",
    );
    noLiveChildren();
    tick = 0;
    tracking.beforeClose = undefined;
    expect(code(await inspectImage(bytes, declaration(bytes), context()))).toBe(
      "passed",
    );
    noLiveChildren();
  });
  it("does not accept deadline expiry during successful protocol validation", async () => {
    let checksAfterClose = 0;
    let closed = false;
    vi.spyOn(performance, "now").mockImplementation(() =>
      closed && ++checksAfterClose >= 2 ? 5000 : 0,
    );
    tracking.mode = "success";
    tracking.beforeClose = () => {
      closed = true;
    };
    const bytes = fixture.assets[0]!.bytes;
    expect(code(await inspectImage(bytes, declaration(bytes), context()))).toBe(
      "MEDIA_TIMEOUT",
    );
    noLiveChildren();
  });
  it("prioritizes external cancellation when a close is also past deadline", async () => {
    let tick = 0;
    vi.spyOn(performance, "now").mockImplementation(() => tick);
    tracking.mode = "success";
    const controller = new AbortController();
    tracking.beforeClose = () => {
      tick = 5000;
      controller.abort();
    };
    const bytes = fixture.assets[0]!.bytes;
    expect(
      code(
        await inspectImage(
          bytes,
          declaration(bytes),
          context({}, controller.signal),
        ),
      ),
    ).toBe("MEDIA_CANCELLED");
    noLiveChildren();
  });
  it("rejects a queued job on grant after its deadline without spawning", async () => {
    let tick = 0;
    vi.spyOn(performance, "now").mockImplementation(() => tick);
    tracking.mode = "success";
    const bytes = fixture.assets[0]!.bytes;
    const first = inspectImage(bytes, declaration(bytes), context());
    const queued = inspectImage(
      bytes,
      declaration(bytes),
      context({ imageMs: 1000 }),
    );
    tick = 1000;
    expect(code(await first)).toBe("passed");
    expect(code(await queued)).toBe("MEDIA_TIMEOUT");
    expect(tracking.children).toHaveLength(1);
    noLiveChildren();
  });
});

describe("native buffer loader allowlist", () => {
  it.each(["tiff", "svg"])(
    "blocks %s decoding in the real worker before its metadata whitelist",
    async (format) => {
      const bytes =
        format === "tiff"
          ? await sharp(fixture.assets[0]!.bytes).tiff().toBuffer()
          : Buffer.from(
              '<svg width="8" height="7" xmlns="http://www.w3.org/2000/svg"><rect width="8" height="7" fill="red"/></svg>',
            );
      expect((await sharp(bytes).metadata()).format).toBe(format);
      const actual =
        await vi.importActual<typeof import("node:child_process")>(
          "node:child_process",
        );
      const child = actual.spawn(
        process.execPath,
        [
          fileURLToPath(new URL("./media-worker.mjs", import.meta.url)),
          String(PACK_LIMITS.resourceBytes),
          String(PACK_LIMITS.imageDimension),
          String(PACK_LIMITS.imagePixels),
        ],
        { stdio: ["pipe", "pipe", "ignore"], env: { NODE_ENV: "production" } },
      );
      const output: Buffer[] = [];
      child.stdout.on("data", (chunk) => output.push(chunk));
      const closed = new Promise<void>((resolve, reject) => {
        child.once("error", reject);
        child.once("close", (code) =>
          code === 0 ? resolve() : reject(new Error("Worker failed")),
        );
      });
      child.stdin.end(bytes);
      await closed;
      expect(JSON.parse(Buffer.concat(output).toString("utf8"))).toEqual({
        ok: false,
        code: "MEDIA_DECODE_FAILED",
      });
      expect(child.exitCode).toBe(0);
    },
  );
});
