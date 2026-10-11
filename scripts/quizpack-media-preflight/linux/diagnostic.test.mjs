import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySystemError } from "./diagnostic.mjs";
test("path/namespace prose is not syscall evidence and raw text never escapes", () => {
  for (const input of [
    "reopen exec fifo: open /synthetic/mount/private-canary: operation not permitted",
    "error opening exec fifo without mount namespace: permission denied",
  ]) {
    const c = classifySystemError(input);
    assert.equal(c.knownSyscall, null);
    assert.ok(["EPERM", "EACCES"].includes(c.errno));
    assert.equal(c.category, "oci-fifo-failed");
    assert.ok(!JSON.stringify(c).includes("private-canary"));
    assert.ok(!JSON.stringify(c).includes("/synthetic"));
  }
});
test("explicit filesystem syscall error stays a fixed textual classification", () => {
  const c = classifySystemError(
    "reopen exec fifo: fstatfs: operation not permitted",
  );
  assert.equal(c.knownSyscall, "fstatfs");
  assert.equal(c.errno, "EPERM");
  assert.equal(c.fifoOperation, "reopen");
});
