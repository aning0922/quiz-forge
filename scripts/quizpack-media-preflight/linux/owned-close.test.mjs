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

test("an early timer callback is rearmed to the same absolute budget", async () => {
  let now = 0;
  let id = 0;
  const timers = new Map();
  const timing = {
    now: () => now,
    setTimer(fn, delay) {
      const key = ++id;
      timers.set(key, { fn, delay });
      return key;
    },
    clearTimer(key) {
      timers.delete(key);
    },
  };
  const child = { once() {}, unref() {} };
  const observer = watchOwnedClose(child, timing);
  let result;
  const promise = observer.waitUntil(5000.8).then((v) => {
    result = v;
  });
  now = 5000.2;
  const current = [...timers.values()][0];
  timers.clear();
  current.fn();
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 1);
  assert.equal(result, undefined);
  now = 5001.2;
  const rearmed = [...timers.values()][0];
  timers.clear();
  rearmed.fn();
  await promise;
  assert.equal(result.closed, false);
  assert.equal(result.stopped, "unknown");
  assert.equal(timers.size, 0);
});
