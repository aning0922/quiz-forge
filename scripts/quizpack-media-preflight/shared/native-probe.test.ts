import { test } from "node:test";
import assert from "node:assert/strict";
import { openSync, closeSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, chmod, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import {
  parseProbeOutput,
  parseFdDiagnostic,
  parseFdControl,
} from "./probe-protocol";

test("real POSIX probe compiles and baseline thread/process/FD protocol is truthful", async () => {
  const base = resolve(".cache/quizpack-media-preflight/shared");
  await mkdir(base, { recursive: true, mode: 0o700 });
  const own = await mkdtemp(`${base}/native-`);
  await chmod(own, 0o700);
  try {
    const binary = `${own}/probe`;
    const build = spawnSync(
      "/usr/bin/cc",
      [
        "-std=c11",
        "-Wall",
        "-Wextra",
        "-Werror",
        "-pthread",
        resolve("scripts/quizpack-media-preflight/shared/posix-probe.c"),
        "-o",
        binary,
      ],
      { stdio: "ignore", timeout: 10000 },
    );
    assert.equal(build.status, 0, "synthetic native build failed");
    await chmod(binary, 0o700);
    const run = (mode: string, extra: string[] = []) => {
      const child = spawnSync(binary, [mode, ...extra], {
        env: { NODE_ENV: "production" },
        timeout: 5000,
        maxBuffer: 2048,
      });
      assert.equal(child.status, 0, "synthetic native probe failed");
      const result = parseProbeOutput(child.stdout);
      assert.ok(result);
      return result;
    };
    assert.deepEqual(run("process"), {
      schema: "posix-probe.v1",
      mode: "process",
      threadAllowed: true,
      forkDenied: false,
      spawnDenied: false,
    });
    const baseline = spawnSync(binary, ["fd-control"], {
      env: { NODE_ENV: "production" },
      timeout: 5000,
      maxBuffer: 2048,
    });
    assert.equal(baseline.status, 0, "synthetic FD control failed");
    const control = parseFdControl(baseline.stdout);
    assert.ok(control);
    assert.equal(control.scanComplete, true);
    assert.equal(control.noInheritedFileOrSocket, control.extraCount === 0);
    if (control.extraCount > 0) {
      const diagnostic = spawnSync(binary, ["fd-diagnostic"], {
        env: { NODE_ENV: "production" },
        timeout: 5000,
        maxBuffer: 2048,
      });
      assert.equal(diagnostic.status, 0, "fixed FD diagnostic failed");
      const safe = parseFdDiagnostic(diagnostic.stdout);
      assert.ok(safe);
      assert.equal(safe.scanComplete, true);
      // These are distinct invocations, not an atomic snapshot. Only control
      // correlates its boolean and count; the separate diagnostic is descriptive.
      process.stdout.write(
        `${JSON.stringify({ syntheticFdControl: control, separateFdDiagnostic: safe })}\n`,
      );
    }
    const highPath = `${own}/high-fd`;
    await writeFile(highPath, "synthetic", { mode: 0o600, flag: "wx" });
    const high = openSync(highPath, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stdio: ("pipe" | "ignore" | number)[] = Array.from(
        { length: 301 },
        () => "ignore",
      );
      stdio[0] = "pipe";
      stdio[1] = "pipe";
      stdio[2] = "pipe";
      stdio[300] = high;
      const injected = spawnSync(binary, ["fd-control"], {
        stdio,
        env: { NODE_ENV: "production" },
        timeout: 5000,
        maxBuffer: 2048,
      });
      assert.equal(injected.status, 0, "synthetic FD300 control failed");
      const captured = parseFdControl(injected.stdout);
      assert.ok(captured);
      assert.equal(captured.scanComplete, true);
      assert.equal(captured.fd300Matched, true);
      assert.ok(captured.extraCount >= 1);
      assert.equal(captured.noInheritedFileOrSocket, false);
      // Read/write FD300 must not satisfy the read-only injected attribute.
      const writable = openSync(
        highPath,
        constants.O_RDWR | constants.O_NOFOLLOW,
      );
      try {
        stdio[300] = writable;
        const wrongMode = spawnSync(binary, ["fd-control"], {
          stdio,
          env: { NODE_ENV: "production" },
          timeout: 5000,
          maxBuffer: 2048,
        });
        assert.equal(
          wrongMode.status,
          0,
          "synthetic FD300 mode control failed",
        );
        const wrong = parseFdControl(wrongMode.stdout);
        assert.ok(wrong);
        assert.equal(wrong.scanComplete, true);
        assert.equal(wrong.fd300Matched, false);
        assert.ok(wrong.extraCount >= 1);
        assert.equal(wrong.noInheritedFileOrSocket, false);
      } finally {
        closeSync(writable);
      }
    } finally {
      closeSync(high);
    }
    const files = `${own}/files`;
    await mkdir(files, { mode: 0o700 });
    await writeFile(`${files}/sentinel`, "synthetic", {
      mode: 0o600,
      flag: "wx",
    });
    const result = run("files", [files]);
    assert.equal(result.mode, "files");
    if (result.mode === "files")
      assert.ok(
        Object.entries(result)
          .filter(([, v]) => typeof v === "boolean")
          .every(([, v]) => v === false),
      );
  } finally {
    await rm(own, { recursive: true });
  }
});

test("same-scan FD control rejects inconsistent safety and unbounded protocol fields", () => {
  const good = {
    schema: "posix-fd-control.v1",
    scanComplete: true,
    noInheritedFileOrSocket: true,
    extraCount: 0,
    fd300Matched: false,
  };
  const parse = (value: unknown) =>
    parseFdControl(Buffer.from(JSON.stringify(value)));
  assert.deepEqual(parse(good), good);
  assert.ok(
    parse({ ...good, scanComplete: false, noInheritedFileOrSocket: false }),
  );
  assert.ok(
    parse({
      ...good,
      noInheritedFileOrSocket: false,
      extraCount: 3,
      fd300Matched: true,
    }),
  );
  for (const invalid of [
    { ...good, extraCount: 1 },
    { ...good, noInheritedFileOrSocket: false },
    { ...good, scanComplete: false },
    { ...good, fd300Matched: true },
    { ...good, extraCount: -1 },
    { ...good, extraCount: 0.5 },
    { ...good, extraCount: 65537 },
    { ...good, scanComplete: "true" },
    { ...good, fd300Matched: 1 },
    { ...good, schema: "unknown" },
    { ...good, path: "synthetic" },
    { ...good, contents: "synthetic" },
  ])
    assert.equal(parse(invalid), null);
  const bytes = Buffer.from(JSON.stringify(good));
  assert.equal(parseFdControl(Buffer.concat([bytes, Buffer.from("\n")])), null);
  assert.equal(
    parseFdControl(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes])),
    null,
  );
  assert.equal(parseFdControl(Buffer.from([255])), null);
  assert.equal(parseFdControl(Buffer.alloc(2049)), null);
});
