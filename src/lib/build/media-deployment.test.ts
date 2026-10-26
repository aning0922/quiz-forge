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
  rename,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { writeFileSync, readdirSync, existsSync, lstatSync } from "node:fs";
import type { Dir } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import {
  buildMediaDeployment,
  hardenMediaDeploymentArtifacts,
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
      "src/features/quizpack/package",
      "src/features/quizpack/content",
      "src/features/quizpack/server/media",
      "src/features/quizpack/server/validation",
    ]) {
      await put(root, directory + "/entry.ts");
      await put(root, directory + "/excluded.test.ts");
      await put(root, directory + "/excluded.d.ts");
    }
    for (const name of [
      "src/lib/foundation-json.ts",
      "src/lib/assessment-contract/primitives.ts",
      "src/lib/assessment-contract/scoring-v1.ts",
      "src/lib/json/canonical.ts",
      "src/features/quizpack/content/reference-graph.ts",
      "src/features/quizpack/package/compatibility.ts",
      "src/lib/build/media-deployment.ts",
      "pnpm-lock.yaml",
      "tsconfig.json",
      "next.config.ts",
    ])
      await put(root, name);
    await put(
      root,
      "package.json",
      JSON.stringify({
        dependencies: {
          zod: "4.6.5",
          "buffer-crc32": "1.0.0",
          sharp: "0.35.5",
        },
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
    const platform = `${process.platform}-${process.arch}`;
    const names = [
      "sharp",
      "@img/colour",
      "detect-libc",
      "semver",
      `@img/sharp-${platform}`,
      `@img/sharp-libvips-${platform}`,
    ];
    const sharpRoot = path.join(
      root,
      "node_modules/.pnpm/sharp@0.35.5/node_modules/sharp",
    );
    for (const name of names) {
      const version = name === "sharp" ? "0.35.5" : "1.0.0";
      const rel = `node_modules/.pnpm/${name.replace("/", "+")}@${version}/node_modules/${name}`;
      await put(
        root,
        rel + "/package.json",
        JSON.stringify({ name, version, exports: { ".": "./index.cjs" } }),
      );
      await put(root, rel + "/index.cjs", "module.exports = {};");
      const entry =
        name === "sharp"
          ? path.join(root, "node_modules/sharp")
          : path.join(path.dirname(sharpRoot), name);
      await mkdir(path.dirname(entry), { recursive: true, mode: 0o700 });
      await symlink(
        path.relative(path.dirname(entry), path.join(root, rel)),
        entry,
      );
    }
    const nativeName = names[4]!;
    const libName = names[5]!;
    const nativeRel = `node_modules/.pnpm/${nativeName.replace("/", "+")}@1.0.0/node_modules/${nativeName}`;
    const libRel = `node_modules/.pnpm/${libName.replace("/", "+")}@1.0.0/node_modules/${libName}`;
    const nativeFile = `lib/sharp-${platform}-0.35.5.node`;
    const libFile =
      platform === "darwin-arm64"
        ? "lib/libvips-cpp.8.18.7.dylib"
        : "lib/libvips-cpp.so.8.18.7";
    await put(
      root,
      nativeRel + "/package.json",
      JSON.stringify({
        name: nativeName,
        version: "1.0.0",
        exports: { "./sharp.node": "./index.cjs" },
      }),
    );
    await put(
      root,
      nativeRel + "/index.cjs",
      `try { require.resolve('${libName}/binary'); } catch {}\nmodule.exports = require('./${nativeFile}');`,
    );
    await put(
      root,
      nativeRel + "/" + nativeFile,
      "synthetic-native-not-loaded",
    );
    await put(
      root,
      libRel + "/package.json",
      JSON.stringify({
        name: libName,
        version: "1.0.0",
        exports: { "./binary": "./" + libFile },
      }),
    );
    await put(root, libRel + "/" + libFile, "synthetic-library-not-loaded");
    const nativeEdge = path.join(
      path.dirname(path.join(root, nativeRel)),
      `sharp-libvips-${platform}`,
    );
    await symlink(
      path.relative(path.dirname(nativeEdge), path.join(root, libRel)),
      nativeEdge,
    );
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

async function addArgon2(bound: MediaDeploymentRoots) {
  const declaration = JSON.parse(
    await readFile(path.join(bound.checkoutRoot, "package.json"), "utf8"),
  );
  declaration.dependencies.argon2 = "0.44.0";
  await put(bound.checkoutRoot, "package.json", JSON.stringify(declaration));
  const packages = [
    { name: "argon2", version: "0.44.0", main: "argon2.cjs" },
    { name: "@phc/format", version: "1.0.0", main: "index.js" },
    { name: "node-gyp-build", version: "4.8.4", main: "index.js" },
  ];
  const roots: Record<string, string> = {};
  const argon = "node_modules/.pnpm/argon2@0.44.0/node_modules/argon2";
  for (const p of packages) {
    const rel = `node_modules/.pnpm/${p.name.replace("/", "+")}@${p.version}/node_modules/${p.name}`;
    roots[p.name] = rel;
    await put(
      bound.checkoutRoot,
      rel + "/package.json",
      JSON.stringify({
        ...p,
        dependencies:
          p.name === "argon2"
            ? {
                "@phc/format": "^1.0.0",
                "node-gyp-build": "^4.8.4",
                "cross-env": "^10.0.0",
                "node-addon-api": "^8.5.0",
              }
            : {},
      }),
    );
    // Neither runtime JS nor the synthetic native can be executed by binding.
    await put(
      bound.checkoutRoot,
      rel + "/" + p.main,
      "throw Error('SYNTHETIC_RUNTIME_MUST_NOT_EXECUTE');",
    );
    const edge =
      p.name === "argon2"
        ? "node_modules/argon2"
        : path.join(path.dirname(argon), p.name);
    await mkdir(path.dirname(path.join(bound.checkoutRoot, edge)), {
      recursive: true,
      mode: 0o700,
    });
    await symlink(
      path.relative(
        path.dirname(path.join(bound.checkoutRoot, edge)),
        path.join(bound.checkoutRoot, rel),
      ),
      path.join(bound.checkoutRoot, edge),
    );
  }
  await put(
    bound.checkoutRoot,
    roots["node-gyp-build"] + "/node-gyp-build.js",
    "throw Error('SYNTHETIC_LOADER_MUST_NOT_EXECUTE');",
  );
  const native =
    argon +
    (process.platform === "darwin"
      ? "/prebuilds/darwin-arm64/argon2.armv8.glibc.node"
      : "/prebuilds/linux-x64/argon2.glibc.node");
  await put(bound.checkoutRoot, native, "synthetic-native-not-loaded");
  return { roots, native, argon };
}
async function addAlias(
  bound: MediaDeploymentRoots,
  kind: "sharp" | "argon2",
  suffix = "0123456789abcdef",
  target?: string,
) {
  const link = path.join(
    bound.deploymentRoot,
    "node_modules",
    kind + "-" + suffix,
  );
  await mkdir(path.dirname(link), { recursive: true, mode: 0o700 });
  const actual =
    target ??
    (await realpath(path.join(bound.checkoutRoot, "node_modules", kind)));
  await symlink(path.relative(path.dirname(link), actual), link);
  return link;
}

describe("trusted media deployment binding", () => {
  it.each([false, true])(
    "binds Linux Argon2 glibc only and rejects an Alpine host marker: %s",
    async (alpine) => {
      const platform = Object.getOwnPropertyDescriptor(process, "platform")!,
        arch = Object.getOwnPropertyDescriptor(process, "arch")!;
      const report = vi.spyOn(process.report, "getReport").mockReturnValue({
        header: { glibcVersionRuntime: "2.39" },
      } as unknown as ReturnType<typeof process.report.getReport>);
      try {
        Object.defineProperty(process, "platform", {
          ...platform,
          value: "linux",
        });
        Object.defineProperty(process, "arch", { ...arch, value: "x64" });
        await fixture(async (bound) => {
          const runtime = await addArgon2(bound);
          await put(
            bound.checkoutRoot,
            path.dirname(runtime.native) + "/argon2.musl.node",
            "synthetic-musl-not-loaded",
          );
          if (!alpine) {
            await build(bound);
            const data = await manifest(bound);
            expect(data.argon2Runtime?.platform).toBe("linux-x64");
            expect(data.argon2Runtime?.native.path).toBe(runtime.native);
            expect((await verifyMediaDeployment(bound, context())).ok).toBe(
              true,
            );
          } else {
            const actual =
              await vi.importActual<typeof import("node:fs/promises")>(
                "node:fs/promises",
              );
            vi.resetModules();
            vi.doMock("node:fs/promises", () => ({
              ...actual,
              lstat: async (...args: Parameters<typeof actual.lstat>) => {
                if (String(args[0]) === "/etc/alpine-release")
                  args[0] = path.join(bound.checkoutRoot, "package.json");
                return actual.lstat(...args);
              },
            }));
            try {
              const fresh = await import("./media-deployment");
              expect(
                await fresh.hardenMediaDeploymentArtifacts(bound, context()),
              ).toMatchObject({
                ok: false,
                code: "DEPENDENCY_INVALID",
                summary: { changedFiles: 0, changedDirectories: 0 },
              });
            } finally {
              vi.doUnmock("node:fs/promises");
              vi.resetModules();
            }
          }
        });
      } finally {
        report.mockRestore();
        Object.defineProperty(process, "platform", platform);
        Object.defineProperty(process, "arch", arch);
      }
    },
  );
  it("detects Argon2 closure changes during artifact hardening", async () => {
    await fixture(async (bound) => {
      const runtime = await addArgon2(bound);
      const artifact = path.join(bound.deploymentRoot, "server/probe.js");
      await chmod(artifact, 0o664);
      let changed = false;
      const result = await hardenMediaDeploymentArtifacts(bound, {
        ...context(),
        checkpoint() {
          if (!changed && (lstatSync(artifact).mode & 0o777) === 0o600) {
            changed = true;
            writeFileSync(
              path.join(
                bound.checkoutRoot,
                runtime.roots["@phc/format"]!,
                "index.js",
              ),
              "changed during artifact hardening",
            );
          }
        },
      });
      expect(changed).toBe(true);
      expect(result).toMatchObject({ ok: false, code: "FILE_CHANGED" });
    });
  });
  it("binds both fixed aliases and Argon2 runtime/native bytes without loading or chmod on dependencies", async () => {
    await fixture(async (bound) => {
      const runtime = await addArgon2(bound);
      await addAlias(bound, "sharp");
      await addAlias(bound, "argon2");
      const native = path.join(bound.checkoutRoot, runtime.native);
      await chmod(native, 0o644);
      const before = await lstat(native, { bigint: true });
      expect((await hardenMediaDeploymentArtifacts(bound, context())).ok).toBe(
        true,
      );
      const after = await lstat(native, { bigint: true });
      expect({
        mode: after.mode,
        ino: after.ino,
        ctime: after.ctimeNs,
      }).toEqual({ mode: before.mode, ino: before.ino, ctime: before.ctimeNs });
      await build(bound);
      const data = await manifest(bound);
      expect(data.artifactAliases.map((a) => a.path)).toEqual([
        "node_modules/argon2-0123456789abcdef",
        "node_modules/sharp-0123456789abcdef",
      ]);
      expect(data.argon2Runtime?.packageRoots.map((p) => p.name)).toEqual([
        "argon2",
        "@phc/format",
        "node-gyp-build",
      ]);
      const registered = data.sourceFiles.filter(
        (f) => f.role === "argon2-runtime",
      );
      expect(
        registered.some(
          (f) =>
            f.path.includes("cross-env") || f.path.includes("node-addon-api"),
        ),
      ).toBe(false);
      const nativeEntry = registered.find((f) => f.path === runtime.native)!;
      expect(data.argon2Runtime?.native).toEqual({
        path: nativeEntry.path,
        bytes: nativeEntry.bytes,
        sha256: nativeEntry.sha256,
      });
      expect((await verifyMediaDeployment(bound, context())).ok).toBe(true);
    });
  });
  it("rejects an Argon2 package-internal symlink before artifact chmod", async () => {
    await fixture(async (bound, owned) => {
      const runtime = await addArgon2(bound);
      await put(owned, "outside-private-bytes", "outside");
      await symlink(
        path.join(owned, "outside-private-bytes"),
        path.join(bound.checkoutRoot, runtime.argon, "unexpected-data"),
      );
      const file = path.join(bound.deploymentRoot, "server/probe.js");
      await chmod(file, 0o664);
      expect(
        await hardenMediaDeploymentArtifacts(bound, context()),
      ).toMatchObject({
        ok: false,
        code: "FILE_UNSAFE",
        summary: { changedFiles: 0, changedDirectories: 0 },
      });
      expect((await lstat(file)).mode & 0o777).toBe(0o664);
    });
  });
  it.each(["duplicate", "unknown", "target", "native", "entry", "extra"])(
    "strictly parses Argon2 manifest closure and aliases: %s",
    async (kind) => {
      await fixture(async (bound) => {
        await addArgon2(bound);
        await addAlias(bound, "argon2");
        await build(bound);
        const data = await manifest(bound);
        if (kind === "duplicate")
          data.artifactAliases.push({
            ...data.artifactAliases[0]!,
            path: "node_modules/argon2-fedcba9876543210",
          });
        if (kind === "unknown")
          data.artifactAliases[0]!.path = "node_modules/other-0123456789abcdef";
        if (kind === "target")
          data.artifactAliases[0]!.targetRoot =
            data.sharpRuntime.packageRoots[0]!.root;
        if (kind === "native")
          data.argon2Runtime!.native.path = "/outside/native.node";
        if (kind === "entry")
          data.argon2Runtime!.packageRoots[1]!.entry =
            data.argon2Runtime!.packageRoots[0]!.entry;
        if (kind === "extra")
          Object.assign(data.argon2Runtime!, { undeclared: true });
        await replaceManifest(bound, data);
        expect(await verifyMediaDeployment(bound, context())).toMatchObject({
          ok: false,
          code: "MANIFEST_INVALID",
        });
      });
    },
  );
  it.each([
    "unknown",
    "duplicate",
    "wrong-root",
    "indirect",
    "outside",
    "directory",
  ])("rejects Argon2 alias preflight before chmod: %s", async (kind) => {
    await fixture(async (bound, owned) => {
      await addArgon2(bound);
      const file = path.join(bound.deploymentRoot, "server/probe.js");
      await chmod(file, 0o664);
      if (kind === "duplicate") {
        await addAlias(bound, "argon2");
        await addAlias(bound, "argon2", "fedcba9876543210");
      } else if (kind === "directory")
        await mkdir(
          path.join(
            bound.deploymentRoot,
            "node_modules/argon2-0123456789abcdef",
          ),
          { recursive: true, mode: 0o700 },
        );
      else if (kind === "unknown") {
        const alias = await addAlias(bound, "argon2");
        await rename(
          alias,
          path.join(path.dirname(alias), "other-0123456789abcdef"),
        );
      } else {
        let target = await realpath(
          path.join(bound.checkoutRoot, "node_modules/argon2"),
        );
        if (kind === "wrong-root")
          target = await realpath(
            path.join(bound.checkoutRoot, "node_modules/sharp"),
          );
        if (kind === "outside") {
          target = path.join(owned, "outside");
          await mkdir(target, { mode: 0o700 });
        }
        if (kind === "indirect") {
          const link = path.join(bound.checkoutRoot, "indirect-argon");
          await symlink(target, link);
          target = link;
        }
        await addAlias(bound, "argon2", "0123456789abcdef", target);
      }
      expect(
        await hardenMediaDeploymentArtifacts(bound, context()),
      ).toMatchObject({
        ok: false,
        code: "FILE_UNSAFE",
        summary: { changedFiles: 0, changedDirectories: 0 },
      });
      expect((await lstat(file)).mode & 0o777).toBe(0o664);
    });
  });
  it.each(["argon2", "@phc/format", "node-gyp-build", "native"])(
    "detects sealed Argon2 closure byte changes: %s",
    async (name) => {
      await fixture(async (bound) => {
        const runtime = await addArgon2(bound);
        await addAlias(bound, "argon2");
        await build(bound);
        const file =
          name === "native"
            ? runtime.native
            : runtime.roots[name] +
              (name === "argon2" ? "/argon2.cjs" : "/index.js");
        await put(bound.checkoutRoot, file, "changed runtime bytes");
        expect(await verifyMediaDeployment(bound, context())).toMatchObject({
          ok: false,
          code: "MANIFEST_MISMATCH",
        });
      });
    },
  );
  it.each(["missing", "added", "text-changed"])(
    "rechecks the sealed Argon2 alias set: %s",
    async (kind) => {
      await fixture(async (bound) => {
        await addArgon2(bound);
        let alias: string | undefined;
        if (kind !== "added") alias = await addAlias(bound, "argon2");
        await build(bound);
        if (alias) await unlink(alias);
        if (kind === "text-changed") {
          const target = await realpath(
            path.join(bound.checkoutRoot, "node_modules/argon2"),
          );
          await symlink(target, alias!);
        }
        if (kind === "added") await addAlias(bound, "argon2");
        expect(await verifyMediaDeployment(bound, context())).toMatchObject({
          ok: false,
          code: "MANIFEST_MISMATCH",
        });
      });
    },
  );
  it.each(["version", "entry", "edge", "indirect-edge"])(
    "locks Argon2 package identity, entry and direct dependency edge: %s",
    async (kind) => {
      await fixture(async (bound, owned) => {
        const runtime = await addArgon2(bound);
        const file = path.join(bound.deploymentRoot, "server/probe.js");
        await chmod(file, 0o664);
        if (kind === "version" || kind === "entry") {
          const metadata = JSON.parse(
            await readFile(
              path.join(
                bound.checkoutRoot,
                runtime.roots["@phc/format"] + "/package.json",
              ),
              "utf8",
            ),
          );
          if (kind === "version") metadata.version = "1.0.1";
          else metadata.main = "elsewhere.js";
          await put(
            bound.checkoutRoot,
            runtime.roots["@phc/format"] + "/package.json",
            JSON.stringify(metadata),
          );
        } else {
          const edge = path.join(
            bound.checkoutRoot,
            path.dirname(runtime.argon),
            "@phc/format",
          );
          await unlink(edge);
          let target = path.join(owned, "unmanaged");
          await mkdir(target, { mode: 0o700 });
          if (kind === "indirect-edge") {
            const targetLink = path.join(owned, "indirect-edge");
            await symlink(
              path.join(bound.checkoutRoot, runtime.roots["@phc/format"]!),
              targetLink,
            );
            target = targetLink;
          }
          await symlink(target, edge);
        }
        expect(
          await hardenMediaDeploymentArtifacts(bound, context()),
        ).toMatchObject({
          ok: false,
          code: "DEPENDENCY_INVALID",
          summary: { changedFiles: 0, changedDirectories: 0 },
        });
        expect((await lstat(file)).mode & 0o777).toBe(0o664);
      });
    },
  );
  it.each([
    "ARGON2_PREBUILD",
    "PREBUILDS_ONLY",
    "npm_config_arch",
    "npm_config_platform",
    "LIBC",
    "ARM_VERSION",
    "ELECTRON_RUN_AS_NODE",
  ])("rejects Argon2 loader environment selection: %s", async (name) => {
    await fixture(async (bound, owned) => {
      await addArgon2(bound);
      const file = path.join(bound.deploymentRoot, "server/probe.js");
      await chmod(file, 0o664);
      const previous = process.env[name];
      process.env[name] = path.join(owned, "outside-loader-selection");
      try {
        expect(
          await hardenMediaDeploymentArtifacts(bound, context()),
        ).toMatchObject({
          ok: false,
          code: "DEPENDENCY_INVALID",
          summary: { changedFiles: 0, changedDirectories: 0 },
        });
      } finally {
        if (previous === undefined) delete process.env[name];
        else process.env[name] = previous;
      }
      expect((await lstat(file)).mode & 0o777).toBe(0o664);
    });
  });
  it.each([
    "Release",
    "Debug",
    "missing-native",
    "exec-fallback",
    "extra-native",
    "native-link",
  ])("rejects unregistered Argon2 native selection: %s", async (kind) => {
    await fixture(async (bound, owned) => {
      const runtime = await addArgon2(bound);
      let descriptor: PropertyDescriptor | undefined;
      if (kind === "Release" || kind === "Debug")
        await put(
          bound.checkoutRoot,
          runtime.argon + "/build/" + kind + "/other.node",
          "synthetic-priority-addon",
        );
      if (kind === "extra-native")
        await put(
          bound.checkoutRoot,
          path.dirname(runtime.native) + "/other.node",
          "synthetic-unknown-addon",
        );
      if (
        kind === "missing-native" ||
        kind === "exec-fallback" ||
        kind === "native-link"
      )
        await unlink(path.join(bound.checkoutRoot, runtime.native));
      if (kind === "native-link") {
        await put(owned, "outside.node", "synthetic-outside-addon");
        await symlink(
          path.join(owned, "outside.node"),
          path.join(bound.checkoutRoot, runtime.native),
        );
      }
      if (kind === "exec-fallback") {
        const execRoot = path.join(owned, "nearby-exec");
        await put(
          execRoot,
          runtime.native.split("/prebuilds/")[1]!.replace(/^/, "prebuilds/"),
          "synthetic-nearby-addon",
        );
        descriptor = Object.getOwnPropertyDescriptor(process, "execPath")!;
        Object.defineProperty(process, "execPath", {
          ...descriptor,
          value: path.join(execRoot, "node"),
        });
      }
      try {
        expect(
          await hardenMediaDeploymentArtifacts(bound, context()),
        ).toMatchObject({
          ok: false,
          code: kind === "native-link" ? "FILE_UNSAFE" : "DEPENDENCY_INVALID",
          summary: { changedFiles: 0, changedDirectories: 0 },
        });
      } finally {
        if (descriptor) Object.defineProperty(process, "execPath", descriptor);
      }
    });
  });
  it.each([
    "redirected",
    "missing-edge",
    "missing-library",
    "missing-native",
    "changed-entry",
  ])(
    "checks the actual native libvips edge and first loader candidate: %s",
    async (kind) => {
      await fixture(async (bound) => {
        const platform = `${process.platform}-${process.arch}`;
        const sharpRoot = await realpath(
          path.join(bound.checkoutRoot, "node_modules/sharp"),
        );
        const nativeRoot = await realpath(
          path.join(path.dirname(sharpRoot), `@img/sharp-${platform}`),
        );
        const libRoot = await realpath(
          path.join(path.dirname(sharpRoot), `@img/sharp-libvips-${platform}`),
        );
        const edge = path.join(
          path.dirname(nativeRoot),
          `sharp-libvips-${platform}`,
        );
        const library =
          platform === "darwin-arm64"
            ? "lib/libvips-cpp.8.18.7.dylib"
            : "lib/libvips-cpp.so.8.18.7";
        await build(bound);
        if (kind === "redirected") {
          const shadow = `node_modules/.pnpm/shadow@1.0.0/node_modules/@img/sharp-libvips-${platform}`;
          await put(
            bound.checkoutRoot,
            shadow + "/package.json",
            JSON.stringify({
              name: `@img/sharp-libvips-${platform}`,
              version: "1.0.0",
              exports: { "./binary": "./" + library },
            }),
          );
          await put(
            bound.checkoutRoot,
            shadow + "/" + library,
            "different-library",
          );
          await unlink(edge);
          await symlink(path.join(bound.checkoutRoot, shadow), edge);
        } else if (kind === "missing-edge") await unlink(edge);
        else if (kind === "missing-library")
          await unlink(path.join(libRoot, library));
        else if (kind === "missing-native")
          await unlink(
            path.join(nativeRoot, `lib/sharp-${platform}-0.35.5.node`),
          );
        else
          await writeFile(
            path.join(nativeRoot, "index.cjs"),
            "module.exports = require('unbound-fallback');",
          );
        expect((await verifyMediaDeployment(bound, context())).ok).toBe(false);
      });
    },
  );
  it("closes the actual alias directory when lstat fails immediately after opendir", async () => {
    await fixture(async (bound) => {
      const target = path.join(bound.deploymentRoot, "node_modules");
      await mkdir(target, { mode: 0o700 });
      const actual =
        await vi.importActual<typeof import("node:fs/promises")>(
          "node:fs/promises",
        );
      let captured: Dir | undefined;
      vi.resetModules();
      vi.doMock("node:fs/promises", () => ({
        ...actual,
        opendir: async (...args: Parameters<typeof actual.opendir>) => {
          const dir = await actual.opendir(...args);
          if (String(args[0]) === target) captured = dir;
          return dir;
        },
        lstat: async (...args: Parameters<typeof actual.lstat>) => {
          if (captured && String(args[0]) === target)
            throw Object.assign(new Error("SYNTHETIC_METADATA_FAILURE"), {
              code: "EIO",
            });
          return actual.lstat(...args);
        },
      }));
      try {
        const fresh = await import("./media-deployment");
        expect(
          await fresh.buildMediaDeployment(bound, context()),
        ).toMatchObject({ ok: false, code: "IO_FAILED" });
        expect(captured).toBeDefined();
        await expect(
          Promise.resolve().then(() => captured!.read()),
        ).rejects.toMatchObject({
          code: "ERR_DIR_CLOSED",
        });
      } finally {
        if (captured) await captured.close().catch(() => undefined);
        vi.doUnmock("node:fs/promises");
        vi.resetModules();
      }
    });
  });
  it("reads hardlinked package bytes without changing store permissions and rejects later byte changes", async () => {
    await fixture(async (bound, owned) => {
      const installed = path.join(
        bound.checkoutRoot,
        "node_modules/.pnpm/zod@4.6.5/node_modules/zod/index.cjs",
      );
      const storeFile = path.join(owned, "synthetic-store-file");
      const { link } = await import("node:fs/promises");
      await link(installed, storeFile);
      const before = await lstat(storeFile);
      expect(before.nlink).toBe(2);
      await build(bound);
      expect((await verifyMediaDeployment(bound, context())).ok).toBe(true);
      expect((await lstat(storeFile)).mode).toBe(before.mode);
      await writeFile(storeFile, "module.exports = 2;");
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "MANIFEST_MISMATCH",
      });
      expect((await lstat(storeFile)).mode).toBe(before.mode);
    });
  });
  it.each([undefined, false, "musl", "2.39-invalid", "9".repeat(33), "2.39"])(
    "requires actual finite glibc evidence for Linux sharp: %s",
    async (version) => {
      const platform = Object.getOwnPropertyDescriptor(process, "platform")!;
      const arch = Object.getOwnPropertyDescriptor(process, "arch")!;
      const report = vi.spyOn(process.report, "getReport").mockReturnValue({
        header: { glibcVersionRuntime: version },
      } as unknown as ReturnType<typeof process.report.getReport>);
      try {
        Object.defineProperty(process, "platform", {
          ...platform,
          value: "linux",
        });
        Object.defineProperty(process, "arch", { ...arch, value: "x64" });
        await fixture(async (bound) => {
          const result = await buildMediaDeployment(bound, context());
          if (version === "2.39") expect(result.ok).toBe(true);
          else
            expect(result).toMatchObject({
              ok: false,
              code: "DEPENDENCY_INVALID",
            });
        });
      } finally {
        report.mockRestore();
        Object.defineProperty(process, "platform", platform);
        Object.defineProperty(process, "arch", arch);
      }
    },
  );
  it("binds the fixed sharp closure and a Next alias without chmod on dependency bytes", async () => {
    await fixture(async (bound) => {
      const target = await realpath(
        path.join(bound.checkoutRoot, "node_modules/sharp"),
      );
      const file = path.join(target, "index.cjs");
      await chmod(file, 0o644);
      const before = await lstat(file);
      const alias = path.join(
        bound.deploymentRoot,
        "node_modules/sharp-0123456789abcdef",
      );
      await mkdir(path.dirname(alias), { mode: 0o775 });
      await chmod(path.dirname(alias), 0o775);
      await symlink(target, alias);
      expect((await hardenMediaDeploymentArtifacts(bound, context())).ok).toBe(
        true,
      );
      expect((await lstat(file)).mode).toBe(before.mode);
      await build(bound);
      const data = await manifest(bound);
      expect(data.artifactAliases).toHaveLength(1);
      expect(data.sharpRuntime.packageRoots).toHaveLength(6);
      expect(
        data.sourceFiles.filter((f) => f.role === "sharp-runtime"),
      ).toHaveLength(14);
      expect((await verifyMediaDeployment(bound, context())).ok).toBe(true);
      await put(
        bound.checkoutRoot,
        path.relative(bound.checkoutRoot, file),
        "changed dependency",
      );
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "MANIFEST_MISMATCH",
      });
    });
  });
  it.each(["escaped", "unmanaged", "multiple", "ordinary-link", "chain"])(
    "rejects unsafe artifact alias preflight: %s",
    async (kind) => {
      await fixture(async (bound, owned) => {
        const target = await realpath(
          path.join(bound.checkoutRoot, "node_modules/sharp"),
        );
        const before = (await lstat(path.join(target, "index.cjs"))).mode;
        const file = path.join(bound.deploymentRoot, "server/probe.js");
        await chmod(file, 0o664);
        await mkdir(path.join(bound.deploymentRoot, "node_modules"), {
          mode: 0o700,
        });
        let aliasTarget = target;
        if (kind === "escaped") {
          await put(owned, "outside/package.json", "{}");
          aliasTarget = path.join(owned, "outside");
        }
        if (kind === "unmanaged") {
          await put(bound.checkoutRoot, "unmanaged/package.json", "{}");
          aliasTarget = path.join(bound.checkoutRoot, "unmanaged");
        }
        if (kind === "chain") {
          await symlink(
            target,
            path.join(bound.checkoutRoot, "indirect-alias"),
          );
          aliasTarget = path.join(bound.checkoutRoot, "indirect-alias");
        }
        await symlink(
          aliasTarget,
          path.join(
            bound.deploymentRoot,
            "node_modules",
            kind === "ordinary-link" ? "other" : "sharp-0123456789abcdef",
          ),
        );
        if (kind === "multiple")
          await symlink(
            target,
            path.join(
              bound.deploymentRoot,
              "node_modules/sharp-fedcba9876543210",
            ),
          );
        expect(
          await hardenMediaDeploymentArtifacts(bound, context()),
        ).toMatchObject({
          ok: false,
          code: "FILE_UNSAFE",
          summary: { changedFiles: 0, changedDirectories: 0 },
        });
        expect((await lstat(file)).mode & 0o777).toBe(0o664);
        expect((await lstat(path.join(target, "index.cjs"))).mode).toBe(before);
      });
    },
  );
  it.each(["missing", "text-changed", "added"])(
    "verification rechecks the exact alias set: %s",
    async (kind) => {
      await fixture(async (bound) => {
        const target = await realpath(
          path.join(bound.checkoutRoot, "node_modules/sharp"),
        );
        const alias = path.join(
          bound.deploymentRoot,
          "node_modules/sharp-0123456789abcdef",
        );
        await mkdir(path.dirname(alias), { mode: 0o700 });
        if (kind !== "added") await symlink(target, alias);
        await build(bound);
        if (kind !== "added") await unlink(alias);
        if (kind === "text-changed")
          await symlink(path.relative(path.dirname(alias), target), alias);
        if (kind === "added") await symlink(target, alias);
        expect(await verifyMediaDeployment(bound, context())).toMatchObject({
          ok: false,
          code: "MANIFEST_MISMATCH",
        });
      });
    },
  );
  it("allows a 17MiB sharp runtime file only, and rejects package links and unmanaged mappings", async () => {
    await fixture(async (bound) => {
      const target = await realpath(
        path.join(bound.checkoutRoot, "node_modules/sharp"),
      );
      const file = await open(
        path.join(target, "native-data.bin"),
        "wx",
        0o600,
      );
      try {
        await file.truncate(17 * 1024 * 1024);
      } finally {
        await file.close();
      }
      await build(bound);
      expect((await verifyMediaDeployment(bound, context())).ok).toBe(true);
      await symlink(
        path.join(target, "index.cjs"),
        path.join(target, "other-link"),
      );
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "FILE_UNSAFE",
      });
    });
    await fixture(async (bound) => {
      const entry = path.join(bound.checkoutRoot, "node_modules/sharp");
      await unlink(entry);
      await put(
        bound.checkoutRoot,
        "unmanaged/package.json",
        JSON.stringify({ name: "sharp", version: "0.35.5" }),
      );
      await symlink("../unmanaged", entry);
      expect(await buildMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "DEPENDENCY_INVALID",
      });
    });
  });
  it("offline hardening normalizes generated artifacts before binding; verify never repairs", async () => {
    await fixture(async (bound) => {
      const file = path.join(bound.deploymentRoot, "server/probe.js");
      const source = path.join(
        bound.checkoutRoot,
        "src/features/quizpack/v1/entry.ts",
      );
      const sourceBefore = (await lstat(source)).mode;
      const beforeBytes = await readFile(file);
      await chmod(file, 0o664);
      await chmod(path.join(bound.deploymentRoot, "server"), 0o775);
      await chmod(bound.deploymentRoot, 0o775);
      expect((await buildMediaDeployment(bound, context())).ok).toBe(false);
      const hardened = await hardenMediaDeploymentArtifacts(bound, context());
      expect(hardened.ok).toBe(true);
      expect(hardened.summary.changedFiles).toBe(1);
      expect(hardened.summary.changedDirectories).toBe(2);
      expect((await lstat(file)).mode & 0o777).toBe(0o600);
      expect((await lstat(bound.deploymentRoot)).mode & 0o777).toBe(0o700);
      expect(await readFile(file)).toEqual(beforeBytes);
      expect((await lstat(source)).mode).toBe(sourceBefore);
      await build(bound);
      await chmod(file, 0o664);
      expect(await verifyMediaDeployment(bound, context())).toMatchObject({
        ok: false,
        code: "FILE_UNSAFE",
      });
      expect((await lstat(file)).mode & 0o777).toBe(0o664);
    });
  });

  it("hardening preflight rejects aliases and hardlinks without touching outside permissions", async () => {
    await fixture(async (bound) => {
      const outside = path.join(
        bound.checkoutRoot,
        "src/features/quizpack/v1/entry.ts",
      );
      await chmod(outside, 0o664);
      const alias = path.join(bound.deploymentRoot, "server/alias.js");
      await symlink(outside, alias);
      const result = await hardenMediaDeploymentArtifacts(bound, context());
      expect(result).toMatchObject({
        ok: false,
        code: "FILE_UNSAFE",
        summary: { changedFiles: 0, changedDirectories: 0 },
      });
      expect((await lstat(outside)).mode & 0o777).toBe(0o664);
      await unlink(alias);
      const { link } = await import("node:fs/promises");
      await link(outside, alias);
      expect(
        await hardenMediaDeploymentArtifacts(bound, context()),
      ).toMatchObject({
        ok: false,
        code: "FILE_UNSAFE",
        summary: { changedFiles: 0, changedDirectories: 0 },
      });
      expect((await lstat(outside)).mode & 0o777).toBe(0o664);
    });
  });

  it("hardening has no arbitrary target and leaves dependencies/ancestors unchanged", async () => {
    await fixture(async (bound) => {
      const dependency = path.join(
        bound.checkoutRoot,
        "node_modules/.pnpm/zod@4.6.5/node_modules/zod/index.cjs",
      );
      await chmod(dependency, 0o664);
      const parentBefore = (await lstat(bound.checkoutRoot)).mode;
      expect((await hardenMediaDeploymentArtifacts(bound, context())).ok).toBe(
        true,
      );
      expect((await lstat(dependency)).mode & 0o777).toBe(0o664);
      expect((await lstat(bound.checkoutRoot)).mode).toBe(parentBefore);
      expect(
        await hardenMediaDeploymentArtifacts(
          { ...bound, deploymentRoot: path.join(bound.checkoutRoot, "src") },
          context(),
        ),
      ).toMatchObject({
        ok: false,
        code: "ROOTS_INVALID",
        summary: { changedFiles: 0, changedDirectories: 0 },
      });
      expect(
        await hardenMediaDeploymentArtifacts(bound, {
          deadlineMonotonicMs: performance.now() - 1,
        }),
      ).toMatchObject({
        ok: false,
        code: "DEADLINE_EXCEEDED",
        summary: { changedFiles: 0, changedDirectories: 0 },
      });
    });
  });
  it("binds code, both installed dependencies and completed artifacts; verify is read-only", async () => {
    await fixture(async (bound) => {
      const built = await build(bound);
      const data = await manifest(bound);
      expect(data.schema).toBe("quizpack-media-deployment.v1");
      expect(new Set(data.sourceFiles.map((f) => f.role))).toEqual(
        new Set(["source", "zod", "buffer-crc32", "sharp-runtime"]),
      );
      expect(data.sourceFiles.some((f) => /\.(test|d)\.ts$/.test(f.path))).toBe(
        false,
      );
      expect(data.dependencyRoots.zod).toContain("node_modules/.pnpm/zod@");
      expect(data.artifactFiles.some((f) => f.path === "BUILD_ID")).toBe(true);
      for (const required of [
        "src/lib/assessment-contract/primitives.ts",
        "src/lib/assessment-contract/scoring-v1.ts",
        "src/lib/json/canonical.ts",
        "src/features/quizpack/content/reference-graph.ts",
        "src/features/quizpack/package/compatibility.ts",
        "tsconfig.json",
      ])
        expect(
          data.sourceFiles.some(
            (file) => file.path === required && file.role === "source",
          ),
        ).toBe(true);
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
    "src/lib/assessment-contract/primitives.ts",
    "src/lib/assessment-contract/scoring-v1.ts",
    "src/lib/json/canonical.ts",
    "src/features/quizpack/content/reference-graph.ts",
    "src/features/quizpack/package/compatibility.ts",
    "tsconfig.json",
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
