import { describe, expect, it } from "vitest";

import { PACK_LIMITS, resolvePackLimits, type PackLimits } from "./limits";

describe("P1 validation limits", () => {
  it("allows exact bounds or lower independent snapshots", () => {
    const input = { imagePixels: 12, archiveBytes: PACK_LIMITS.archiveBytes };
    const resolved = resolvePackLimits(input);
    input.imagePixels = 24;
    expect(resolved.ok && resolved.value.imagePixels).toBe(12);
    expect(resolvePackLimits(PACK_LIMITS).ok).toBe(true);
    expect(resolvePackLimits().ok).toBe(true);
  });

  it.each([NaN, Infinity, -1, 0, 1.5, PACK_LIMITS.imagePixels + 1])(
    "rejects invalid or increased values %s",
    (imagePixels) => {
      expect(resolvePackLimits({ imagePixels }).ok).toBe(false);
    },
  );

  it("rejects unknown keys, symbols, exotic objects, proxies, and accessors without invocation", () => {
    let accessed = false;
    const getter = Object.defineProperty({}, "imagePixels", {
      enumerable: true,
      get() {
        accessed = true;
        return 1;
      },
    });
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          accessed = true;
          return [];
        },
      },
    );
    for (const input of [
      null,
      [],
      new Date(),
      { unknown: 1 },
      { [Symbol()]: 1 },
      getter,
      proxy,
    ]) {
      expect(resolvePackLimits(input as Partial<PackLimits>).ok).toBe(false);
    }
    expect(accessed).toBe(false);
  });
});
