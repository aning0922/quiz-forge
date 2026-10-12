import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { hashFile, hashTree, mediaSourceIdentity } from "./runtime-files";
import { fixedMediaRuntimeRoots } from "./runtime-location";
describe("fixed bounded runtime identity reads", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "quizforge-synthetic-runtime-"));
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));
  it("has no env/cwd fallback when compiler roots are unavailable", () => {
    const previous = process.env.QUIZFORGE_MEDIA_CHECKOUT_ROOT;
    try {
      process.env.QUIZFORGE_MEDIA_CHECKOUT_ROOT = "/synthetic";
      expect(() => fixedMediaRuntimeRoots()).toThrow("ISOLATION_UNAVAILABLE");
    } finally {
      if (previous === undefined)
        delete process.env.QUIZFORGE_MEDIA_CHECKOUT_ROOT;
      else process.env.QUIZFORGE_MEDIA_CHECKOUT_ROOT = previous;
    }
  });
  it("hashes complete wrapper bytes and rejects symlinks", () => {
    const file = join(root, "synthetic.js");
    writeFileSync(file, "synthetic workspace wrapper");
    const before = hashTree(root);
    writeFileSync(file, "synthetic other wrapper");
    expect(hashTree(root)).not.toBe(before);
    symlinkSync(file, join(root, "link"));
    expect(() => hashTree(root)).toThrow();
  });
  it("checks the same monotonic authority between bounded file chunks", () => {
    const file = join(root, "synthetic");
    writeFileSync(file, Buffer.alloc(256 * 1024));
    let count = 0;
    expect(() =>
      hashFile(file, () => {
        if (++count === 3) throw new Error("SYNTHETIC_STOP");
      }),
    ).toThrow("SYNTHETIC_STOP");
  });
  it("inventories only executable media sources and preserves full bytes", () => {
    const media = join(root, "src/features/quizpack/server/media");
    mkdirSync(media, { recursive: true });
    writeFileSync(join(media, "index.ts"), "synthetic");
    writeFileSync(join(media, "index.test.ts"), "synthetic test");
    expect(mediaSourceIdentity(root, () => {})).toEqual([
      { role: "index.ts", sha256: hashFile(join(media, "index.ts")) },
    ]);
  });
});
