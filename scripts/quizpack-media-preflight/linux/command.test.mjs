import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { unlink, rmdir } from "node:fs/promises";
import { command, CACHE, privateDir, readPrivate } from "./common.mjs";

test("local command close settles actual child stdio", async () => {
  const r = await command(process.execPath, [
    "-e",
    "process.stdout.write('synthetic')",
  ]);
  assert.equal(r.code, 0);
  assert.equal(r.settled, true);
  assert.equal(r.stdout.toString(), "synthetic");
});
test("output byte caps terminate a real local command", async () => {
  for (const stream of ["stdout", "stderr"]) {
    const r = await command(
      process.execPath,
      [
        "-e",
        `process.${stream}.write('x'.repeat(5000));setInterval(()=>{},1000)`,
      ],
      { stdoutLimit: 2048, stderrLimit: 4096 },
    );
    assert.equal(r.reason, "OUTPUT_INVALID");
    assert.equal(r.settled, true);
    assert.ok(r.stdout.length <= 2048);
  }
});
test("input backpressure is deadline bounded and repeated abort is idempotent", async () => {
  const r = await command(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { input: Buffer.alloc(8388608), deadline: performance.now() + 150 },
  );
  assert.equal(r.reason, "DEADLINE_EXCEEDED");
  assert.equal(r.settled, true);
  const a = new AbortController();
  setTimeout(() => {
    a.abort();
    a.abort();
  }, 150);
  const cancelled = await command(
    process.execPath,
    ["-e", "setInterval(()=>{},1000)"],
    { signal: a.signal },
  );
  assert.equal(cancelled.reason, "CANCELLED");
  assert.equal(cancelled.settled, true);
});
test("already interrupted command never invokes spawn", async () => {
  const a = new AbortController();
  a.abort();
  let spawned = false;
  const r = await command(process.execPath, ["-e", "process.exit(9)"], {
    signal: a.signal,
    onSpawn() {
      spawned = true;
    },
  });
  assert.equal(spawned, false);
  assert.equal(r.reason, "CANCELLED");
  assert.equal(r.settled, true);
});
test("a parent's exit is insufficient when descendant still owns stdio", async () => {
  const code =
    "const {spawn}=require('node:child_process');spawn(process.execPath,['-e','setTimeout(()=>{},1200)'],{stdio:['ignore','inherit','inherit']});process.exit(0)";
  const r = await command(process.execPath, ["-e", code], {
    deadline: performance.now() + 300,
    settleDeadline: performance.now() + 500,
  });
  assert.equal(r.settled, false);
  assert.equal(r.reason, "DEADLINE_EXCEEDED");
  // The synthetic descendant has a fixed natural exit. Observe all late events;
  // no claim that a killed/ESRCH parent proves its descendant was stopped.
  await new Promise((ok) => setTimeout(ok, 1300));
});

test("FIFO control objects reject without blocking before fstat", async () => {
  const root = resolve(CACHE, randomUUID(), "fifo");
  await privateDir(root);
  const path = resolve(root, "record.json");
  const made = await command("/usr/bin/mkfifo", ["-m", "600", path]);
  assert.equal(made.code, 0);
  const start = performance.now();
  try {
    await assert.rejects(readPrivate(path), /PRIVATE_FILE/);
    assert.ok(performance.now() - start < 1000);
  } finally {
    await unlink(path);
    await rmdir(root);
    await rmdir(resolve(root, ".."));
  }
});
test("absolute deadline still applies when the timer was delayed", async () => {
  const end = performance.now() + 100;
  const r = await command(
    process.execPath,
    ["-e", "process.stdout.write('synthetic')"],
    {
      deadline: end,
      onSpawn() {
        while (performance.now() < end + 100) {
          /* synthetic parent event-loop stall */
        }
      },
    },
  );
  assert.equal(r.reason, "DEADLINE_EXCEEDED");
  assert.equal(r.settled, true);
});
