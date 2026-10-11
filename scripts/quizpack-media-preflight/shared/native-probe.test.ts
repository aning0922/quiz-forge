import { test } from "node:test";
import assert from "node:assert/strict";
import { openSync, closeSync, constants } from "node:fs";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, chmod, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { parseProbeOutput, parseFdDiagnostic } from "./probe-protocol";

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
    const noExtraFD = run("fd");
    if (noExtraFD.mode === "fd" && !noExtraFD.noInheritedFileOrSocket) {
      const diagnostic = spawnSync(binary, ["fd-diagnostic"], {
        env: { NODE_ENV: "production" },
        timeout: 5000,
        maxBuffer: 2048,
      });
      assert.equal(diagnostic.status, 0, "fixed FD diagnostic failed");
      const safe = parseFdDiagnostic(diagnostic.stdout);
      assert.ok(safe);
      process.stdout.write(
        `${JSON.stringify({ syntheticFdDiagnostic: safe })}\n`,
      );
    }
    assert.deepEqual(noExtraFD, {
      schema: "posix-probe.v1",
      mode: "fd",
      scanComplete: true,
      noInheritedFileOrSocket: true,
    });
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
      const injected = spawnSync(binary, ["fd"], {
        stdio,
        env: { NODE_ENV: "production" },
        timeout: 5000,
        maxBuffer: 2048,
      });
      assert.equal(injected.status, 0, "synthetic FD300 probe failed");
      const diagnostic = spawnSync(binary, ["fd-diagnostic"], {
        stdio,
        env: { NODE_ENV: "production" },
        timeout: 5000,
        maxBuffer: 2048,
      });
      assert.equal(diagnostic.status, 0, "FD300 diagnostic failed");
      const safe = parseFdDiagnostic(diagnostic.stdout);
      assert.ok(safe);
      assert.equal(safe.scanComplete, true);
      assert.equal(safe.extraCount, 1);
      assert.equal(safe.descriptors[0]?.type, "regular");
      assert.equal(safe.descriptors[0]?.readMode, true);
      assert.equal(safe.descriptors[0]?.writeMode, false);
      assert.equal(safe.descriptors[0]?.above255, true);
      assert.deepEqual(parseProbeOutput(injected.stdout), {
        schema: "posix-probe.v1",
        mode: "fd",
        scanComplete: true,
        noInheritedFileOrSocket: false,
      });
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
