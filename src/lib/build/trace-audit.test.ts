import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { auditBuildTraces } from "./trace-audit";

async function fixture(run: (root: string, owned: string) => Promise<void>) {
  // Only this unique directory is owned; no fixture uses the real P2A instance.
  const parent = path.join(process.cwd(), ".cache", "build-trace-tests");
  await mkdir(parent, { recursive: true });
  const owned = await mkdtemp(path.join(parent, "audit-"));
  const root = path.join(owned, "project");
  try {
    await mkdir(path.join(root, ".next", "server"), { recursive: true });
    await run(root, owned);
  } finally {
    await rm(owned, { recursive: true, force: true });
  }
}

async function trace(root: string, input: unknown) {
  await writeFile(
    path.join(root, ".next", "server", "page.js.nft.json"),
    JSON.stringify(input),
  );
}

async function file(target: string) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, "synthetic fixture");
}

describe("production build trace boundary", () => {
  it.each([
    ".cache/p2a/synthetic/runtime.json",
    ".cache/uploads/synthetic.bin",
    ".env",
    ".env.example",
    ".git/config",
    "test-results/result.json",
    "playwright-report/index.html",
  ])("rejects normalized private paths: %s", async (privateFile) => {
    await fixture(async (root) => {
      await trace(root, {
        version: 1,
        files: [`../../src/../${privateFile}`],
      });
      expect(await auditBuildTraces(root)).toMatchObject({
        code: "BUILD_TRACE_PRIVATE_PATH",
        traceCount: 1,
        violationCount: 1,
      });
    });
  });

  it("allows ordinary dependencies and shared pnpm directory aliases", async () => {
    await fixture(async (root, owned) => {
      const shared = path.join(owned, "shared", ".pnpm", "dep", "index.js");
      await file(shared);
      await mkdir(path.join(root, "node_modules"));
      await symlink(
        path.dirname(shared),
        path.join(root, "node_modules", "dep"),
      );
      await trace(root, {
        version: 1,
        files: ["../../node_modules/dep/index.js", "../../node_modules/dep"],
        fileHashes: ["synthetic-hash", "synthetic-link-hash"],
        symlinks: [[1, "../../../shared/.pnpm/dep"]],
      });
      expect(await auditBuildTraces(root)).toMatchObject({
        code: "BUILD_TRACE_OK",
        traceCount: 1,
        violationCount: 0,
      });
    });
  });

  it.each([true, false])(
    "rejects an indirect alias into private storage, leaf exists=%s",
    async (exists) => {
      await fixture(async (root) => {
        const privateDirectory = path.join(root, ".cache", "synthetic");
        await mkdir(privateDirectory, { recursive: true });
        if (exists) await file(path.join(privateDirectory, "runtime.json"));
        await mkdir(path.join(root, "resources"));
        await symlink(privateDirectory, path.join(root, "resources", "inner"));
        await symlink("inner", path.join(root, "resources", "outer"));
        await trace(root, {
          version: 1,
          files: ["../../resources/outer/runtime.json"],
        });
        expect(await auditBuildTraces(root)).toMatchObject({
          code: "BUILD_TRACE_PRIVATE_PATH",
          violationCount: 1,
        });
      });
    },
  );

  it("resolves parent traversal after a directory symlink", async () => {
    await fixture(async (root) => {
      const privateDirectory = path.join(root, ".cache", "synthetic", "child");
      await mkdir(privateDirectory, { recursive: true });
      await file(path.join(privateDirectory, "..", "runtime.json"));
      await mkdir(path.join(root, "resources"));
      await symlink(privateDirectory, path.join(root, "resources", "alias"));
      await trace(root, {
        version: 1,
        files: ["../../resources/alias/../runtime.json"],
      });
      expect((await auditBuildTraces(root)).code).toBe(
        "BUILD_TRACE_PRIVATE_PATH",
      );
    });
  });

  it.each([false, true])(
    "rejects dangling private links without NFT metadata, indirect=%s",
    async (indirect) => {
      await fixture(async (root) => {
        await mkdir(path.join(root, "resources"));
        const alias = path.join(root, "resources", "alias");
        await symlink(path.join(root, ".cache", "missing.json"), alias);
        if (indirect)
          await symlink("alias", path.join(root, "resources", "outer"));
        await trace(root, {
          version: 1,
          files: [indirect ? "../../resources/outer" : "../../resources/alias"],
        });
        expect((await auditBuildTraces(root)).code).toBe(
          "BUILD_TRACE_PRIVATE_PATH",
        );
      });
    },
  );

  it("rejects a dangling private directory ancestor", async () => {
    await fixture(async (root) => {
      await mkdir(path.join(root, "resources"));
      await symlink(
        path.join(root, ".cache", "missing-directory"),
        path.join(root, "resources", "alias"),
      );
      await trace(root, {
        version: 1,
        files: ["../../resources/alias/child.json"],
      });
      expect((await auditBuildTraces(root)).code).toBe(
        "BUILD_TRACE_PRIVATE_PATH",
      );
    });
  });

  it("allows ordinary missing leaves and dangling shared dependency links", async () => {
    await fixture(async (root, owned) => {
      await mkdir(path.join(root, "node_modules"));
      await symlink(
        path.join(owned, "shared", ".pnpm", "missing-dependency.js"),
        path.join(root, "node_modules", "dependency"),
      );
      await trace(root, {
        version: 1,
        files: ["../../src/missing.js", "../../node_modules/dependency"],
      });
      expect((await auditBuildTraces(root)).code).toBe("BUILD_TRACE_OK");
    });
  });

  it("retains the logical base of an aliased trace file", async () => {
    await fixture(async (root) => {
      const source = path.join(root, "safe-data", "trace.nft.json");
      await mkdir(path.dirname(source));
      await writeFile(
        source,
        JSON.stringify({
          version: 1,
          files: ["../../.cache/synthetic.json"],
        }),
      );
      await symlink(
        source,
        path.join(root, ".next", "server", "page.nft.json"),
      );
      expect((await auditBuildTraces(root)).code).toBe(
        "BUILD_TRACE_PRIVATE_PATH",
      );
    });
  });

  it("audits each logical directory alias instead of deduplicating its target", async () => {
    await fixture(async (root, owned) => {
      const shared = path.join(owned, "shared-traces");
      await mkdir(shared);
      await writeFile(
        path.join(shared, "page.nft.json"),
        JSON.stringify({
          version: 1,
          files: ["../../../.cache/synthetic.json"],
        }),
      );
      await mkdir(path.join(root, ".next", "nested"));
      // The shallow alias has a safe lexical base; the deeper alias reaches
      // this fixture's private root. Both point to exactly the same directory.
      await symlink(shared, path.join(root, ".next", "a-shallow"));
      await symlink(shared, path.join(root, ".next", "nested", "b-deep"));
      expect(await auditBuildTraces(root)).toMatchObject({
        code: "BUILD_TRACE_PRIVATE_PATH",
        traceCount: 2,
      });
    });
  });

  it("rejects directory alias cycles instead of silently omitting their traces", async () => {
    await fixture(async (root) => {
      await trace(root, { version: 1, files: [] });
      await symlink("..", path.join(root, ".next", "server", "cycle"));
      expect((await auditBuildTraces(root)).code).toBe(
        "BUILD_TRACE_DISCOVERY_FAILED",
      );
    });
  });

  it("rejects private targets declared by NFT metadata even without a live link", async () => {
    await fixture(async (root) => {
      await trace(root, {
        version: 1,
        files: ["../../resources/alias"],
        symlinks: [[0, "../../.cache/synthetic"]],
      });
      expect(await auditBuildTraces(root)).toMatchObject({
        code: "BUILD_TRACE_PRIVATE_PATH",
        violationCount: 1,
      });
    });
  });

  it("checks named additional roots and cross-root symlink targets", async () => {
    await fixture(async (root) => {
      await trace(root, {
        version: 1,
        files: ["../../resources/alias"],
        symlinks: [[0, "../.cache/synthetic/runtime.json", 0]],
        additionalRoots: [
          { name: "assets", path: "../../resources", files: [], symlinks: [] },
        ],
      });
      expect(await auditBuildTraces(root)).toMatchObject({
        code: "BUILD_TRACE_PRIVATE_PATH",
        violationCount: 1,
      });
    });
  });

  it("allows shared additional roots with both cross-root target forms", async () => {
    await fixture(async (root, owned) => {
      await file(path.join(owned, "shared", "dependency.js"));
      await trace(root, {
        version: 1,
        files: ["../../resources/alias"],
        symlinks: [[0, "dependency.js", 0]],
        additionalRoots: [
          {
            name: "shared-dependencies",
            path: "../../../shared",
            files: ["alias"],
            fileHashes: ["synthetic-hash"],
            symlinks: [[0, "../../src/entry.js", -1]],
          },
        ],
      });
      expect((await auditBuildTraces(root)).code).toBe("BUILD_TRACE_OK");
    });
  });

  it("checks private additional root locations even when their file list is empty", async () => {
    await fixture(async (root) => {
      await trace(root, {
        version: 1,
        files: [],
        symlinks: [],
        additionalRoots: [
          { name: "state", path: "../../.cache", files: [], symlinks: [] },
        ],
      });
      expect((await auditBuildTraces(root)).code).toBe(
        "BUILD_TRACE_PRIVATE_PATH",
      );
    });
  });

  it("does not read private storage through a build directory alias", async () => {
    await fixture(async (root) => {
      await mkdir(path.join(root, ".cache", "synthetic"), { recursive: true });
      await symlink(
        path.join(root, ".cache", "synthetic"),
        path.join(root, ".next", "alias"),
      );
      expect((await auditBuildTraces(root)).code).toBe(
        "BUILD_TRACE_PRIVATE_PATH",
      );
    });
  });

  it("fails when there are no traces or no build directory", async () => {
    await fixture(async (root) => {
      expect((await auditBuildTraces(root)).code).toBe("BUILD_TRACE_NOT_FOUND");
      await rm(path.join(root, ".next"), { recursive: true });
      expect((await auditBuildTraces(root)).code).toBe("BUILD_TRACE_NOT_FOUND");
    });
  });

  it.each([
    null,
    { version: 1 },
    { version: 2, files: [] },
    { version: 1, files: [null] },
    { version: 1, files: [], symlinks: null },
    { version: 1, files: [], additionalRoots: null },
    { version: 1, files: ["/absolute/file"] },
    { version: 1, files: [], fileHashes: ["wrong-length"] },
    { version: 1, files: [], symlinks: [[0, "../../.cache"]] },
    { version: 1, files: ["file"], symlinks: [[0, "target", 0]] },
    { version: 1, files: [], symlinks: [], additionalRoots: {} },
    {
      version: 1,
      files: [],
      symlinks: [],
      additionalRoots: [{ name: "root", path: "../../resources", files: [] }],
    },
  ])("fails closed on malformed trace structure: %j", async (input) => {
    await fixture(async (root) => {
      await trace(root, input);
      expect((await auditBuildTraces(root)).code).toBe("BUILD_TRACE_MALFORMED");
    });
  });

  it("fails on invalid JSON and unknown path-bearing extensions", async () => {
    await fixture(async (root) => {
      await writeFile(path.join(root, ".next", "bad.nft.json"), "{");
      expect((await auditBuildTraces(root)).code).toBe("BUILD_TRACE_MALFORMED");
      await rm(path.join(root, ".next", "bad.nft.json"));
      await trace(root, { version: 1, files: [], futureRoots: [] });
      expect((await auditBuildTraces(root)).code).toBe(
        "BUILD_TRACE_UNSUPPORTED_SCHEMA",
      );
    });
  });

  it("returns only fixed codes and counts, with nonzero CLI status on failure", async () => {
    await fixture(async (root) => {
      const cli = path.join(process.cwd(), "scripts", "check-build-traces.ts");
      const tsx = path.join(
        process.cwd(),
        "node_modules",
        "tsx",
        "dist",
        "cli.mjs",
      );
      const run = () =>
        spawnSync(process.execPath, [tsx, cli], {
          cwd: root,
          encoding: "utf8",
        });
      const missing = run();
      expect(missing.status).toBe(1);
      expect(missing.stderr).toBe("");
      expect(JSON.parse(missing.stdout)).toEqual({
        code: "BUILD_TRACE_NOT_FOUND",
        traceCount: 0,
        pathCount: expect.any(Number),
        violationCount: 0,
      });
      await trace(root, { version: 1, files: ["../../.env.synthetic-secret"] });
      const unsafe = run();
      expect(unsafe.status).toBe(1);
      expect(unsafe.stderr).toBe("");
      expect(unsafe.stdout).not.toContain(root);
      expect(unsafe.stdout).not.toContain("synthetic-secret");
      await trace(root, { version: 1, files: ["../../src/safe.js"] });
      const safe = run();
      expect(safe.status).toBe(0);
      expect(JSON.parse(safe.stdout).code).toBe("BUILD_TRACE_OK");
    });
  });
});
