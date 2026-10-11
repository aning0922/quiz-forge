import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { watchOwnedClose } from "./owned-close.mjs";
test("dead parent with a 6.5s descendant stdio holder stays unknown at the 5s budget", async () => {
  const code =
    "const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setTimeout(()=>{},6500)'],{stdio:['ignore','inherit','inherit']});process.stdout.write('ready');setInterval(()=>{},1000)";
  const child = spawn(process.execPath, ["-e", code], {
    stdio: ["ignore", "pipe", "pipe"],
    env: { PATH: "/usr/bin:/bin" },
  });
  const observer = watchOwnedClose(child);
  child.on("error", () => {});
  child.stderr.on("data", () => {});
  await new Promise((ok) => child.stdout.once("data", ok));
  const deadline = performance.now() + 5000;
  const start = performance.now();
  child.kill("SIGKILL");
  const result = await observer.waitUntil(deadline);
  assert.equal(result.closed, false);
  assert.equal(result.stopped, "unknown");
  assert.ok(performance.now() - start < 5500);
  // An independent test-fixture observation lets its fixed natural exit settle;
  // it cannot mutate the previously returned unknown/ownerClosed=false fact.
  const later = await observer.waitUntil(performance.now() + 2500);
  assert.equal(later.closed, true);
  assert.equal(result.closed, false);
});
