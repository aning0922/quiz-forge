import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, chmod, writeFile, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { parseProbeOutput } from "./probe-protocol";

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
    assert.deepEqual(run("fd"), {
      schema: "posix-probe.v1",
      mode: "fd",
      noInheritedFileOrSocket: true,
    });
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
