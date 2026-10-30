import { afterEach, expect, it } from "vitest";
import { mkdtemp, writeFile, rm, symlink, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { readPlatformArt } from "./art-store";
import type { PlatformArt } from "./art-manifest";
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});
async function fixture() {
  const root = await realpath(
    await mkdtemp(path.join(tmpdir(), "qf-platform-art-")),
  );
  roots.push(root);
  const bytes = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==",
    "base64",
  );
  const art: PlatformArt = {
    id: "test",
    file: "test.png",
    mediaType: "image/png",
    bytes: bytes.length,
    width: 1,
    height: 1,
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
  await writeFile(path.join(root, art.file), bytes);
  return { root, art, bytes };
}
it("returns only the exact fixed bytes and declared PNG dimensions", async () => {
  const f = await fixture();
  expect(await readPlatformArt(f.art, f.root)).toEqual(new Uint8Array(f.bytes));
  expect(await readPlatformArt({ ...f.art, width: 2 }, f.root)).toBeNull();
  expect(
    await readPlatformArt({ ...f.art, sha256: "0".repeat(64) }, f.root),
  ).toBeNull();
  await writeFile(
    path.join(f.root, f.art.file),
    Buffer.concat([f.bytes, Buffer.from([0])]),
  );
  expect(await readPlatformArt(f.art, f.root)).toBeNull();
});
it("does not traverse paths or read through a linked root or file", async () => {
  const f = await fixture();
  expect(
    await readPlatformArt({ ...f.art, file: "../test.png" }, f.root),
  ).toBeNull();
  expect(await readPlatformArt(f.art, undefined)).toBeNull();
  await symlink(path.join(f.root, f.art.file), path.join(f.root, "link.png"));
  expect(
    await readPlatformArt({ ...f.art, file: "link.png" }, f.root),
  ).toBeNull();
  const other = await fixture();
  await symlink(f.root, path.join(other.root, "linked"));
  expect(
    await readPlatformArt(f.art, path.join(other.root, "linked")),
  ).toBeNull();
});
