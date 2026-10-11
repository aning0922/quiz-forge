import { test } from "node:test";
import assert from "node:assert/strict";
import { supportedOSInfo } from "./policy";
import { parseMacOutput, parseNativeIdentity } from "./protocol";
test("OS support requires exact product/build, no prefix acceptance", () => {
  assert.equal(
    supportedOSInfo("ProductVersion:\t26.6.2\nBuildVersion:\t25G83\n"),
    true,
  );
  for (const info of [
    "ProductVersion:\t26.6.20\nBuildVersion:\t25G83\n",
    "ProductVersion:\t26.6.2\nBuildVersion:\t25G83x\n",
    "ProductVersion:\t26.6.2\nBuildVersion:\t25G82\n",
  ])
    assert.equal(supportedOSInfo(info), false);
});
test("private native protocols reject extra/duplicate fields, BOM and malformed identity", () => {
  const good = Buffer.from(
    '{"schema":"mac-probe.v1","mode":"vfork","denied":true}',
  );
  assert.ok(parseMacOutput(good));
  for (const b of [
    Buffer.concat([Buffer.from([239, 187, 191]), good]),
    Buffer.from(
      good.toString().replace('"denied":true', '"denied":false,"denied":true'),
    ),
    Buffer.from(
      good
        .toString()
        .replace('"denied":true', '"denied":true,"path":"synthetic"'),
    ),
    Buffer.alloc(2049),
  ])
    assert.equal(parseMacOutput(b), null);
  assert.ok(
    parseNativeIdentity(
      Buffer.from('{"schema":"mac-identity.v1","present":false}'),
    ),
  );
  assert.equal(
    parseNativeIdentity(
      Buffer.from('{"schema":"mac-identity.v1","present":true}'),
    ),
    null,
  );
});
