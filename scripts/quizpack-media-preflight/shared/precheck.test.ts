import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { precheckImage } from "./precheck";
import { parseWorkerOutput } from "./output";
import { parseProbeOutput } from "./probe-protocol";
import { MEDIA_LIMITS } from "./contracts";
const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function declaration(bytes = png) {
  return {
    path: "assets/synthetic.png",
    mediaType: "image/png" as const,
    bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    width: 2,
    height: 2,
  };
}
test("snapshot isolates both bytes and declaration before async mutation", async () => {
  const input = Buffer.from(png);
  const d = declaration(input);
  const result = precheckImage(input, d);
  assert.equal(result.ok, true);
  await Promise.resolve();
  input.fill(0);
  d.width = 99;
  if (result.ok) {
    assert.deepEqual(result.bytes, png);
    assert.equal(result.expected.width, 2);
    assert.ok(Object.isFrozen(result.expected));
  }
});
test("strict input rejects unknown fields, unsafe numbers, nonbytes, shared memory and thrown getters", () => {
  for (const d of [
    { ...declaration(), extra: true },
    { ...declaration(), width: NaN },
    { ...declaration(), bytes: Infinity },
    { ...declaration(), height: 0 },
    { ...declaration(), width: Number.MAX_SAFE_INTEGER + 1 },
    { ...declaration(), path: "../sentinel.png" },
  ])
    assert.equal(precheckImage(png, d).ok, false);
  assert.equal(precheckImage("bytes", declaration()).ok, false);
  assert.equal(
    precheckImage(new Uint8Array(new SharedArrayBuffer(8)), declaration()).ok,
    false,
  );
  assert.equal(
    precheckImage(png, {
      get path() {
        throw new Error("synthetic");
      },
    }).ok,
    false,
  );
});
test("actual and declared byte limits, pixel and dimension exact/+1", () => {
  const max = Buffer.alloc(MEDIA_LIMITS.bytes);
  png.copy(max);
  assert.equal(precheckImage(max, declaration(max)).ok, true);
  const over = Buffer.alloc(MEDIA_LIMITS.bytes + 1);
  png.copy(over);
  assert.deepEqual(precheckImage(over, declaration(over)), {
    ok: false,
    code: "INPUT_LIMIT",
  });
  assert.equal(
    precheckImage(png, { ...declaration(), width: 4000, height: 4000 }).ok,
    true,
  );
  assert.equal(
    precheckImage(png, { ...declaration(), width: 4000, height: 4001 }).ok,
    false,
  );
  assert.equal(
    precheckImage(png, { ...declaration(), width: 8192, height: 1 }).ok,
    true,
  );
  assert.equal(
    precheckImage(png, { ...declaration(), width: 8193, height: 1 }).ok,
    false,
  );
});
test("integrity/magic/extension fail closed", () => {
  for (const d of [
    { ...declaration(), bytes: 7 },
    { ...declaration(), sha256: "0".repeat(64) },
    { ...declaration(), path: "assets/synthetic.jpg" },
  ])
    assert.equal(precheckImage(png, d).ok, false);
  const fake = Buffer.from("not-image");
  assert.equal(precheckImage(fake, declaration(fake)).ok, false);
});
test("PNG animation chunks and WebP animation flags are rejected without decoding", () => {
  for (const chunk of ["acTL", "fcTL", "fdAT"]) {
    const b = Buffer.concat([
      png,
      Buffer.alloc(4),
      Buffer.from(chunk),
      Buffer.alloc(4),
    ]);
    assert.deepEqual(precheckImage(b, declaration(b)), {
      ok: false,
      code: "DECODE_REJECTED",
    });
  }
  for (const chunk of ["ANIM", "ANMF", "VP8X"]) {
    const b = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.alloc(4),
      Buffer.from("WEBP"),
      Buffer.from(chunk),
      Buffer.from([1, 0, 0, 0, 2, 0]),
    ]);
    const d = {
      ...declaration(b),
      path: "assets/synthetic.webp",
      mediaType: "image/webp",
    };
    assert.deepEqual(precheckImage(b, d), {
      ok: false,
      code: "DECODE_REJECTED",
    });
  }
});
test("truncated chunk arithmetic is bounded and left to complete decoder", () => {
  const b = Buffer.concat([
    png,
    Buffer.from([255, 255, 255, 255]),
    Buffer.from("IDAT"),
    Buffer.alloc(4),
  ]);
  assert.equal(precheckImage(b, declaration(b)).ok, true);
});
test("worker protocol refuses extra/duplicate keys, multiple JSON, invalid UTF8, +1 output and dimensions", () => {
  const facts = {
    ok: true,
    mediaType: "image/png",
    width: 2,
    height: 2,
    frames: 1,
    mediaDecoded: true,
  };
  const good = JSON.stringify(facts);
  assert.equal(parseWorkerOutput(Buffer.from(good), declaration()).ok, true);
  for (const s of [
    good + good,
    good + "\n",
    JSON.stringify({ ...facts, extra: 1 }),
    good.replace('"width":2', '"width":1,"width":2'),
    JSON.stringify({ ...facts, width: 3 }),
    JSON.stringify({ ...facts, frames: 2 }),
  ])
    assert.equal(parseWorkerOutput(Buffer.from(s), declaration()).ok, false);
  assert.equal(parseWorkerOutput(Buffer.from([255]), declaration()).ok, false);
  assert.equal(parseWorkerOutput(Buffer.alloc(2049), declaration()).ok, false);
  assert.deepEqual(
    parseWorkerOutput(
      Buffer.from('{"ok":false,"code":"MEDIA_DECODE_FAILED"}'),
      declaration(),
    ),
    { ok: false, code: "DECODE_REJECTED" },
  );
});
test("probe protocol has a fixed mode-dependent field set and no diagnostics", () => {
  const good =
    '{"schema":"posix-probe.v1","mode":"fd","scanComplete":true,"noInheritedFileOrSocket":true}';
  assert.ok(parseProbeOutput(Buffer.from(good)));
  for (const s of [
    good + "\n",
    good + good,
    good.replace("true", '"true"'),
    good.replace('"mode":"fd"', '"mode":"unknown"'),
    good.replace('"noInheritedFileOrSocket":true', '"path":"synthetic"'),
  ])
    assert.equal(parseProbeOutput(Buffer.from(s)), null);
});

test("BOM is rejected by both canonical protocols", () => {
  const bom = Buffer.from([0xef, 0xbb, 0xbf]);
  const facts = Buffer.from(
    '{"ok":true,"mediaType":"image/png","width":2,"height":2,"frames":1,"mediaDecoded":true}',
  );
  assert.equal(
    parseWorkerOutput(Buffer.concat([bom, facts]), declaration()).ok,
    false,
  );
  const probe = Buffer.from(
    '{"schema":"posix-probe.v1","mode":"fd","scanComplete":true,"noInheritedFileOrSocket":true}',
  );
  assert.equal(parseProbeOutput(Buffer.concat([bom, probe])), null);
});

test("network result distinguishes socket denial, operation denial and skipped listen", () => {
  const value = {
    schema: "posix-probe.v1",
    mode: "network",
    connect: "socket-denied",
    bind: "operation-denied",
    listen: "prerequisite-denied",
    unix: "socket-denied",
  };
  assert.deepEqual(parseProbeOutput(Buffer.from(JSON.stringify(value))), value);
  assert.equal(
    parseProbeOutput(Buffer.from(JSON.stringify({ ...value, connect: true }))),
    null,
  );
  assert.equal(
    parseProbeOutput(
      Buffer.from(JSON.stringify({ ...value, listen: "inferred-denied" })),
    ),
    null,
  );
});
