import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  chmod,
  writeFile,
  symlink,
  link,
  rm,
  realpath,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import {
  isQianzaiMusicTestRequest,
  qianzaiMusicRangeResponse,
  readPinnedQianzaiMusicFile,
} from "./music-store";
import { QIANZAI_MUSIC } from "./music-manifest";
const owned: string[] = [];
afterEach(async () => {
  for (const p of owned.splice(0)) await rm(p, { recursive: true });
});
const config = {
  purpose: "test",
  instanceId: "00486f17f741bd6d6535429e6552d161",
  origin: "http://127.0.0.1:63238",
};
const ids = { trackId: QIANZAI_MUSIC.id, version: QIANZAI_MUSIC.version };
const request = (headers: Record<string, string> = {}) =>
  new Request(config.origin + QIANZAI_MUSIC.url, {
    headers: { "sec-fetch-site": "same-origin", ...headers },
  });
it("admits only the one managed test origin, identity and fixed track version", () => {
  expect(isQianzaiMusicTestRequest(request(), config, ids)).toBe(true);
  expect(request().headers.get("origin")).toBeNull();
  for (const header of [
    { origin: "https://other.example" },
    { referer: "https://other.example/path" },
    { host: "other.example" },
    { referer: "invalid" },
  ])
    expect(isQianzaiMusicTestRequest(request(header), config, ids)).toBe(false);
  for (const changed of [
    { ...config, purpose: "demo" },
    { ...config, purpose: "ci" },
    { ...config, instanceId: "a".repeat(32) },
    { ...config, origin: "http://127.0.0.1:3100" },
  ])
    expect(isQianzaiMusicTestRequest(request(), changed, ids)).toBe(false);
  expect(
    isQianzaiMusicTestRequest(
      request({ "sec-fetch-site": "cross-site" }),
      config,
      ids,
    ),
  ).toBe(false);
  expect(
    isQianzaiMusicTestRequest(
      new Request(config.origin + QIANZAI_MUSIC.url),
      config,
      ids,
    ),
  ).toBe(false);
  expect(
    isQianzaiMusicTestRequest(request(), config, { ...ids, version: "other" }),
  ).toBe(false);
  expect(
    isQianzaiMusicTestRequest(request(), config, { ...ids, trackId: "other" }),
  ).toBe(false);
});
it("verifies finite full bytes and MP4 signature before a range is served", async () => {
  const root = await mkdtemp(
    path.join(await realpath(os.tmpdir()), "qztx-audio-unit-"),
  );
  owned.push(root);
  await chmod(root, 0o700);
  const bytes = Buffer.from([
      0, 0, 0, 16, 102, 116, 121, 112, 77, 52, 65, 32, 0, 0, 0, 0,
    ]),
    pin = {
      file: "synthetic.m4a",
      bytes: bytes.length,
      sha256: createHash("sha256").update(bytes).digest("hex"),
    };
  await writeFile(path.join(root, pin.file), bytes, { mode: 0o600 });
  expect(
    await readPinnedQianzaiMusicFile(root, new AbortController().signal, pin),
  ).toEqual(new Uint8Array(bytes));
  expect(
    await readPinnedQianzaiMusicFile(root, new AbortController().signal, {
      ...pin,
      sha256: "a".repeat(64),
    }),
  ).toBeNull();
  await chmod(path.join(root, pin.file), 0o644);
  expect(
    await readPinnedQianzaiMusicFile(root, new AbortController().signal, pin),
  ).toBeNull();
  await chmod(path.join(root, pin.file), 0o600);
  await symlink(path.join(root, pin.file), path.join(root, "linked.m4a"));
  expect(
    await readPinnedQianzaiMusicFile(root, new AbortController().signal, {
      ...pin,
      file: "linked.m4a",
    }),
  ).toBeNull();
  await link(path.join(root, pin.file), path.join(root, "hard.m4a"));
  expect(
    await readPinnedQianzaiMusicFile(root, new AbortController().signal, pin),
  ).toBeNull();
});
it("serves exact full/single bounded ranges and rejects invalid ranges", async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const full = qianzaiMusicRangeResponse(request(), bytes);
  expect(full.status).toBe(200);
  expect(full.headers.get("cache-control")).toBe("no-store");
  expect(full.headers.get("content-type")).toBe("audio/mp4");
  for (const [range, expected] of [
    ["bytes=0-1", [1, 2]],
    ["bytes=2-", [3, 4]],
    ["bytes=-1", [4]],
    ["bytes=0-999", [1, 2, 3, 4]],
  ] as const) {
    const r = qianzaiMusicRangeResponse(request({ range }), bytes);
    expect(r.status).toBe(206);
    expect([...new Uint8Array(await r.arrayBuffer())]).toEqual(expected);
  }
  for (const range of [
    "bytes=4-",
    "bytes=2-1",
    "bytes=-0",
    "bytes=0-1,2-3",
    "bytes=-",
    "other=0-1",
  ])
    expect(qianzaiMusicRangeResponse(request({ range }), bytes).status).toBe(
      416,
    );
});

it("supports same-origin HEAD without Origin and returns verified byte headers without a body", async () => {
  const req = new Request(config.origin + QIANZAI_MUSIC.url, {
    method: "HEAD",
    headers: { "sec-fetch-site": "same-origin" },
  });
  expect(isQianzaiMusicTestRequest(req, config, ids)).toBe(true);
  const response = qianzaiMusicRangeResponse(req, new Uint8Array([1, 2, 3]));
  expect(response.status).toBe(200);
  expect(response.headers.get("content-length")).toBe("3");
  expect((await response.arrayBuffer()).byteLength).toBe(0);
});
