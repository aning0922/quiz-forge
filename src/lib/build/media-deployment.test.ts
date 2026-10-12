import {
  chmod,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  realpath,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { writeFileSync, readdirSync, existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  buildMediaDeployment,
  verifyMediaDeployment,
  type MediaDeploymentManifest,
  type MediaDeploymentRoots,
} from "./media-deployment";

const manifestPath = (root: string) =>
  path.join(root, ".cache/quizpack-media-runtime/deployment.json");
const context = () => ({ deadlineMonotonicMs: performance.now() + 10000 });
async function put(root: string, name: string, content = "synthetic") {
  const target = path.join(root, name);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await writeFile(target, content, { mode: 0o600 });
}
async function fixture(
  run: (bound: MediaDeploymentRoots, owned: string) => Promise<void>,
) {
  const parent = path.resolve(".cache/media-deployment-tests");
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const owned = await mkdtemp(path.join(parent, "deployment-"));
  const root = path.join(owned, "project");
  try {
    await mkdir(root, { mode: 0o700 });
    for (const directory of [
      "src/features/quizpack/v1",
      "src/features/quizpack/server/media",
      "src/features/quizpack/server/validation",
    ]) {
      await put(root, directory + "/entry.ts");
      await put(root, directory + "/excluded.test.ts");
      await put(root, directory + "/excluded.d.ts");
    }
    for (const name of [
      "src/lib/foundation-json.ts",
      "src/lib/build/media-deployment.ts",
      "pnpm-lock.yaml",
      "next.config.ts",
    ])
      await put(root, name);
    await put(
      root,
      "package.json",
      JSON.stringify({
        dependencies: { zod: "4.6.5", "buffer-crc32": "1.0.0" },
      }),
    );
    for (const [name, version] of [
      ["zod", "4.6.5"],
      ["buffer-crc32", "1.0.0"],
    ]) {
      const rel = `node_modules/.pnpm/${name}@${version}/node_modules/${name}`;
      await put(
        root,
        rel + "/package.json",
        JSON.stringify({ name, version, exports: { ".": "./index.cjs" } }),
      );
      await put(root, rel + "/index.cjs", "module.exports = {};");
      await symlink(
        `.pnpm/${name}@${version}/node_modules/${name}`,
        path.join(root, "node_modules", name!),
      );
    }
    for (const name of [
      "routes-manifest.json",
      "build-manifest.json",
      "prerender-manifest.json",
      "required-server-files.json",
      "package.json",
      "server/app-paths-manifest.json",
    ])
      await put(root, ".next/" + name, "{}");
    await put(root, ".next/BUILD_ID", "synthetic-build");
    await put(root, ".next/server/probe.js", "module.exports = {};");
    await run(
      {
        checkoutRoot: await realpath(root),
        deploymentRoot: await realpath(path.join(root, ".next")),
      },
      owned,
    );
  } finally {
    await rm(owned, { recursive: true, force: true });
  }
}
async function build(bound: MediaDeploymentRoots) {
  const result = await buildMediaDeployment(bound, context());
  expect(result.ok).toBe(true);
  expect(result.committed).toBe(true);
  return result;
}
async function manifest(bound: MediaDeploymentRoots) {
  return JSON.parse(
    await readFile(manifestPath(bound.checkoutRoot), "utf8"),
  ) as MediaDeploymentManifest;
}
async function replaceManifest(bound: MediaDeploymentRoots, value: unknown) {
  await writeFile(manifestPath(bound.checkoutRoot), JSON.stringify(value));
}

describe("trusted media deployment binding", () => {
  it("binds code, both installed dependencies and completed artifacts; verify is read-only", async () => {
    await fixture(async (bound) => {
      const built = await build(bound);
      const data = await manifest(bound);
      expect(data.schema).toBe("quizpack-media-deployment.v1");
      expect(new Set(data.sourceFiles.map((f) => f.role))).toEqual(
        new Set(["source", "zod", "buffer-crc32"]),
      );
      expect(data.sourceFiles.some((f) => /\.(test|d)\.ts$/.test(f.path))).toBe(
        false,
      );
      expect(data.dependencyRoots.zod).toContain("node_modules/.pnpm/zod@");
      expect(data.artifactFiles.some((f) => f.path === "BUILD_ID")).toBe(true);
      expect(
        [...data.sourceFiles, ...data.artifactFiles].some((f) =>
          f.path.includes("deployment.json"),
        ),
      ).toBe(false);
      const before = await lstat(manifestPath(bound.checkoutRoot), {
        bigint: true,
      });
      const beforeBytes = await readFile(manifestPath(bound.checkoutRoot));
      const verified = await verifyMediaDeployment(bound, context());
      expect(verified.ok).toBe(true);
      if (built.ok && verified.ok)
        expect(verified.summary).toEqual(built.summary);
      expect(verified.committed).toBe(false);
      expect(await readFile(manifestPath(bound.checkoutRoot))).toEqual(
        beforeBytes,
      );
      expect(
        (await lstat(manifestPath(bound.checkoutRoot), { bigint: true }))
          .mtimeNs,
      ).toBe(before.mtimeNs);
      expect(Number(before.mode & BigInt(0o777))).toBe(0o600);
      expect(
        (await lstat(path.dirname(manifestPath(bound.checkoutRoot)))).mode &
          0o777,
      ).toBe(0o700);
    });
  });

  it.each([
    "src/features/quizpack/v1/entry.ts",
    ".next/server/probe.js",
    "node_modules/.pnpm/zod@4.6.5/node_modules/zod/index.cjs",
    "node_modules/.pnpm/buffer-crc32@1.0.0/node_modules/buffer-crc32/index.cjs",
  ])("rejects changed actual bytes: %s", async (file) => {
    await fixture(async (bound) => {
      await build(bound);
      const saved = await readFile(manifestPath(bound.checkoutRoot));
      await put(bound.checkoutRoot, file, "changed synthetic bytes");
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        committed: false,
        code: "MANIFEST_MISMATCH",
      });
      expect(await readFile(manifestPath(bound.checkoutRoot))).toEqual(saved);
    });
  });

  it.each(["entry", "internal"])(
    "binds nonstandard executable dependency files: %s",
    async (kind) => {
      await fixture(async (bound) => {
        const rel = "node_modules/.pnpm/zod@4.6.5/node_modules/zod";
        await put(
          bound.checkoutRoot,
          rel + "/value.txt",
          "module.exports = 1;",
        );
        await put(
          bound.checkoutRoot,
          rel + "/package.json",
          JSON.stringify({
            name: "zod",
            version: "4.6.5",
            exports: { ".": kind === "entry" ? "./value.txt" : "./index.cjs" },
          }),
        );
        await put(
          bound.checkoutRoot,
          rel + "/index.cjs",
          "module.exports = require('./value.txt');",
        );
        const require = createRequire(
          path.join(bound.checkoutRoot, "package.json"),
        );
        expect(require("zod")).toBe(1);
        await build(bound);
        const data = await manifest(bound);
        expect(
          data.sourceFiles.some((file) => file.path === rel + "/value.txt"),
        ).toBe(true);
        await put(
          bound.checkoutRoot,
          rel + "/value.txt",
          "module.exports = 2;",
        );
        delete require.cache[require.resolve("zod")];
        delete require.cache[path.join(bound.checkoutRoot, rel, "value.txt")];
        expect(require("zod")).toBe(2);
        expect(await verifyMediaDeployment(bound, context())).toMatchObject({
          ok: false,
          committed: false,
          code: "MANIFEST_MISMATCH",
        });
      });
    },
  );

  it.each([
    "src/features/quizpack/server/media/extra.ts",
    ".next/server/extra.js",
    "node_modules/.pnpm/zod@4.6.5/node_modules/zod/extra.js",
    "node_modules/.pnpm/buffer-crc32@1.0.0/node_modules/buffer-crc32/extra.mjs",
  ])(
    "rejects an added file instead of only checking old manifest entries: %s",
    async (file) => {
      await fixture(async (bound) => {
        await build(bound);
        await put(bound.checkoutRoot, file);
        expect(await verifyMediaDeployment(bound, context())).toMatchObject({
          ok: false,
          code: "MANIFEST_MISMATCH",
        });
      });
    },
  );

  it("rejects deleted source/artifact files and missing completed builds", async () => {
    await fixture(async (bound) => {
      await build(bound);
      await unlink(
        path.join(
          bound.checkoutRoot,
          "src/features/quizpack/server/validation/entry.ts",
        ),
      );
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "MANIFEST_MISMATCH",
      });
      await rm(bound.deploymentRoot, { recursive: true });
      expect(await buildMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        committed: false,
        code: "BUILD_INCOMPLETE",
      });
    });
  });

  it("missing manifest is read-only and never prepares runtime storage", async () => {
    await fixture(async (bound) => {
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        committed: false,
        code: "MANIFEST_MISSING",
      });
      await expect(
        lstat(path.join(bound.checkoutRoot, ".cache")),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it.each(["src/features/quizpack/v1/entry.ts", ".next/server/probe.js"])(
    "rejects an indirect symlink without reading its target: %s",
    async (file) => {
      await fixture(async (bound, owned) => {
        await build(bound);
        await put(owned, "outside/target.ts");
        await unlink(path.join(bound.checkoutRoot, file));
        await symlink(
          path.join(owned, "outside/target.ts"),
          path.join(bound.checkoutRoot, file),
        );
        expect(await verifyMediaDeployment(bound, context())).toMatchObject({
          ok: false,
          code: "FILE_UNSAFE",
        });
      });
    },
  );

  it("rejects a directory alias and a dependency package-root escape", async () => {
    await fixture(async (bound, owned) => {
      await build(bound);
      await mkdir(path.join(owned, "outside"), { mode: 0o700 });
      const group = path.join(
        bound.checkoutRoot,
        "src/features/quizpack/server/validation",
      );
      await rm(group, { recursive: true });
      await symlink(path.join(owned, "outside"), group);
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "FILE_UNSAFE",
      });
      await unlink(group);
      await mkdir(group, { mode: 0o700 });
      const dependency = path.join(bound.checkoutRoot, "node_modules/zod");
      await unlink(dependency);
      await symlink(path.join(owned, "outside"), dependency);
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "DEPENDENCY_INVALID",
      });
    });
  });

  it("rechecks the dependency resolution mapping even when package bytes match", async () => {
    await fixture(async (bound) => {
      await build(bound);
      const replacement = "node_modules/.pnpm/zod@4.6.5-copy/node_modules/zod";
      await put(
        bound.checkoutRoot,
        replacement + "/index.cjs",
        "module.exports = {};",
      );
      await put(
        bound.checkoutRoot,
        replacement + "/package.json",
        JSON.stringify({
          name: "zod",
          version: "4.6.5",
          exports: { ".": "./index.cjs" },
        }),
      );
      await unlink(path.join(bound.checkoutRoot, "node_modules/zod"));
      await symlink(
        ".pnpm/zod@4.6.5-copy/node_modules/zod",
        path.join(bound.checkoutRoot, "node_modules/zod"),
      );
      expect((await verifyMediaDeployment(bound, context())).ok).toBe(false);
    });
  });

  it("rejects oversize regular files before reading their contents", async () => {
    await fixture(async (bound) => {
      await build(bound);
      const file = await open(
        path.join(bound.checkoutRoot, "src/features/quizpack/v1/entry.ts"),
        "r+",
      );
      try {
        await file.truncate(16 * 1024 * 1024 + 1);
      } finally {
        await file.close();
      }
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "LIMIT_EXCEEDED",
      });
    });
  });

  it.each([
    "../escape.js",
    "server/.cache/deployment.json",
    "server/../../deployment.json",
  ])("rejects manifest path escape/self-cycle: %s", async (file) => {
    await fixture(async (bound) => {
      await build(bound);
      const data = await manifest(bound);
      data.artifactFiles[0]!.path = file;
      await replaceManifest(bound, data);
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "MANIFEST_INVALID",
      });
    });
  });

  it("rejects strict-schema additions, changed roots, malformed UTF-8 and manifest caps", async () => {
    await fixture(async (bound) => {
      await build(bound);
      const data = await manifest(bound);
      await replaceManifest(bound, { ...data, extra: "synthetic" });
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "MANIFEST_INVALID",
      });
      await replaceManifest(bound, {
        ...data,
        checkoutRoot: bound.checkoutRoot + "/other",
      });
      expect((await verifyMediaDeployment(bound, context())).ok).toBe(false);
      await writeFile(manifestPath(bound.checkoutRoot), Buffer.from([255]));
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "MANIFEST_INVALID",
      });
      const file = await open(manifestPath(bound.checkoutRoot), "r+");
      try {
        await file.truncate(2 * 1024 * 1024 + 1);
      } finally {
        await file.close();
      }
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "LIMIT_EXCEEDED",
      });
    });
  });

  it("rejects declared aggregate/count bounds without allocating large actual files", async () => {
    await fixture(async (bound) => {
      await build(bound);
      const data = await manifest(bound);
      const source = data.sourceFiles.find((f) => f.role === "source")!;
      await replaceManifest(bound, {
        ...data,
        sourceFiles: Array.from({ length: 9 }, (_, i) => ({
          ...source,
          path: `src/features/quizpack/v1/large-${i}.ts`,
          bytes: 16 * 1024 * 1024,
        })),
      });
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "LIMIT_EXCEEDED",
      });
      await replaceManifest(bound, {
        ...data,
        sourceFiles: Array.from({ length: 4097 }, (_, i) => ({
          ...source,
          path: `src/features/quizpack/v1/unit-${i}.ts`,
        })),
      });
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "LIMIT_EXCEEDED",
      });
    });
  });

  it("does not repair existing unsafe runtime-directory or manifest permissions", async () => {
    await fixture(async (bound) => {
      await build(bound);
      const file = manifestPath(bound.checkoutRoot);
      await chmod(file, 0o644);
      const before = await readFile(file);
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "FILE_UNSAFE",
      });
      expect(await buildMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        committed: false,
        code: "FILE_UNSAFE",
      });
      expect((await lstat(file)).mode & 0o777).toBe(0o644);
      expect(await readFile(file)).toEqual(before);
      await chmod(file, 0o600);
      await chmod(path.dirname(file), 0o755);
      expect(await buildMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        committed: false,
        code: "FILE_UNSAFE",
      });
      expect((await lstat(path.dirname(file))).mode & 0o777).toBe(0o755);
    });
  });

  it("closes cancellation/deadline/checkpoint failures and removes uncommitted temporaries", async () => {
    await fixture(async (bound) => {
      const abort = new AbortController();
      abort.abort();
      expect(
        await buildMediaDeployment(bound, {
          ...context(),
          signal: abort.signal,
        }),
      ).toMatchObject({ ok: false, committed: false, code: "CANCELLED" });
      expect(
        await buildMediaDeployment(bound, {
          deadlineMonotonicMs: performance.now() - 1,
        }),
      ).toMatchObject({
        ok: false,
        committed: false,
        code: "DEADLINE_EXCEEDED",
      });
      expect(
        await buildMediaDeployment(bound, {
          ...context(),
          checkpoint() {
            throw new Error("synthetic unsaved diagnostic");
          },
        }),
      ).toEqual({ ok: false, committed: false, code: "CHECKPOINT_FAILED" });
      expect(
        await buildMediaDeployment(bound, { deadlineMonotonicMs: Infinity }),
      ).toMatchObject({ ok: false, code: "CONTEXT_INVALID" });
      await build(bound);
      let calls = 0;
      expect(
        (
          await verifyMediaDeployment(bound, {
            ...context(),
            checkpoint() {
              calls++;
            },
          })
        ).ok,
      ).toBe(true);
      let observed = 0;
      const deadline = performance.now() + 1000;
      const late = await verifyMediaDeployment(bound, {
        deadlineMonotonicMs: deadline,
        checkpoint() {
          if (++observed === calls)
            while (performance.now() <= deadline) {
              /* final-checkpoint expiry */
            }
        },
      });
      expect(late).toMatchObject({
        ok: false,
        committed: false,
        code: "DEADLINE_EXCEEDED",
      });
      expect(
        await readdir(path.dirname(manifestPath(bound.checkoutRoot))),
      ).toEqual(["deployment.json"]);
    });
  });

  it("reports a committed manifest truthfully when the final checkpoint fails", async () => {
    let calls = 0;
    await fixture(async (bound) => {
      expect(
        (
          await buildMediaDeployment(bound, {
            ...context(),
            checkpoint() {
              calls++;
            },
          })
        ).ok,
      ).toBe(true);
    });
    await fixture(async (bound) => {
      let observed = 0;
      const result = await buildMediaDeployment(bound, {
        ...context(),
        checkpoint() {
          if (++observed === calls)
            throw new Error("synthetic after-commit failure");
        },
      });
      expect(result).toEqual({
        ok: false,
        committed: true,
        code: "CHECKPOINT_FAILED",
      });
      expect((await verifyMediaDeployment(bound, context())).ok).toBe(true);
      expect(
        await readdir(path.dirname(manifestPath(bound.checkoutRoot))),
      ).toEqual(["deployment.json"]);
    });
  });

  it("detects a file changed between its before/after inode and size observations", async () => {
    await fixture(async (bound) => {
      const file = path.join(bound.checkoutRoot, "src/lib/foundation-json.ts");
      let writes = 0;
      const result = await buildMediaDeployment(bound, {
        ...context(),
        checkpoint() {
          writeFileSync(file, ++writes % 2 ? "x" : "xx");
        },
      });
      expect(result).toEqual({
        ok: false,
        committed: false,
        code: "FILE_CHANGED",
      });
      await expect(
        lstat(manifestPath(bound.checkoutRoot)),
      ).rejects.toMatchObject({ code: "ENOENT" });
    });
  });

  it("settles a temporary writer and deletes its uncommitted file on cancellation", async () => {
    await fixture(async (bound) => {
      const leaf = path.dirname(manifestPath(bound.checkoutRoot));
      const result = await buildMediaDeployment(bound, {
        ...context(),
        checkpoint() {
          if (
            existsSync(leaf) &&
            readdirSync(leaf).some((name) => name.endsWith(".tmp"))
          )
            throw new Error("synthetic temporary-write interruption");
        },
      });
      expect(result).toEqual({
        ok: false,
        committed: false,
        code: "CHECKPOINT_FAILED",
      });
      expect(await readdir(leaf)).toEqual([]);
    });
  });

  it("rejects depth/path budgets and unknown executable artifact formats", async () => {
    await fixture(async (bound) => {
      await put(bound.checkoutRoot, ".next/server/unknown.wasm");
      expect(await buildMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        committed: false,
        code: "FILE_UNSAFE",
      });
      await unlink(path.join(bound.deploymentRoot, "server/unknown.wasm"));
      const deep =
        "src/features/quizpack/v1/" + "nested/".repeat(14) + "entry.ts";
      await put(bound.checkoutRoot, deep);
      expect(await buildMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "FILE_UNSAFE",
      });
    });
  });
});
