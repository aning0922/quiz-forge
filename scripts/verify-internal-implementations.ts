import { readFile, lstat } from "node:fs/promises";
import { resolve, relative, dirname, join } from "node:path";
import { createHash } from "node:crypto";
import ts from "typescript";
import { canonicalOrdinaryJson } from "../src/lib/json/canonical";
import {
  IMPLEMENTATION_DESCRIPTORS,
  implementationIdentity,
  rendererImplementationAvailable,
  engineImplementationAvailable,
} from "../src/features/product/internal-versions/implementation-catalog";
import type { ImplementationEntry } from "../src/features/product/internal-versions/implementation-schema";
import type { ConsumerImplementationEntry } from "../src/features/product/internal-play/implementation-schema";
import {
  verifyInternalImplementationEntryV2,
  type InternalImplementationEntryV2,
} from "../src/features/product/internal-versions/implementation-schema-v2";
import {
  verifyConsumerImplementationEntryV2,
  type ConsumerImplementationEntryV2,
} from "../src/features/product/internal-play/implementation-schema-v2";
import { readImplementationLock } from "./internal-implementation-lock";
export type TrustedImplementationEntry =
  | ImplementationEntry
  | ConsumerImplementationEntry
  | InternalImplementationEntryV2
  | ConsumerImplementationEntryV2;
const sha = (value: string | Buffer) =>
  createHash("sha256").update(value).digest("hex");
const canonical = (value: unknown, maxBytes = 131072) =>
  canonicalOrdinaryJson(value, { maxBytes, maxDepth: 32 });
const runtimeImport = (node: ts.ImportDeclaration | ts.ExportDeclaration) => {
  if (ts.isImportDeclaration(node)) {
    const clause = node.importClause;
    if (clause?.isTypeOnly) return false;
    if (
      clause &&
      !clause.name &&
      clause.namedBindings &&
      ts.isNamedImports(clause.namedBindings) &&
      clause.namedBindings.elements.every((e) => e.isTypeOnly)
    )
      return false;
  } else if (
    node.isTypeOnly ||
    (node.exportClause &&
      ts.isNamedExports(node.exportClause) &&
      node.exportClause.elements.every((e) => e.isTypeOnly))
  )
    return false;
  return true;
};
const packageName = (specifier: string) =>
  specifier.startsWith("@")
    ? specifier.split("/").slice(0, 2).join("/")
    : specifier.split("/")[0]!;
/** Read-only build gate. The override is a local failure-injection seam, never a package/runtime option. */
export async function verifyInternalImplementations(
  cwd: string,
  overrideRead?: (path: string) => Promise<Buffer>,
) {
  return verifyTrustedImplementationEntries(
    cwd,
    [
      ...IMPLEMENTATION_DESCRIPTORS.renderers,
      ...IMPLEMENTATION_DESCRIPTORS.engines,
    ],
    (entry) => {
      if (entry.descriptor.kind === "consumer-renderer") return false;
      const identity = implementationIdentity(entry as ImplementationEntry);
      return identity.kind === "renderer"
        ? rendererImplementationAvailable(identity)
        : engineImplementationAvailable(identity);
    },
    overrideRead,
  );
}

/** Build-time local catalogs only, never request/QuizPack descriptors or runtime registration. */
export async function verifyTrustedImplementationEntries(
  cwd: string,
  entries: readonly TrustedImplementationEntry[],
  isAvailable: (entry: TrustedImplementationEntry) => boolean,
  overrideRead?: (path: string) => Promise<Buffer>,
) {
  cwd = resolve(cwd);
  const cache = new Map<string, Buffer>();
  const read = async (file: string) => {
    if (cache.has(file)) return cache.get(file)!;
    const absolute = resolve(cwd, file);
    if (!absolute.startsWith(cwd + "/"))
      throw Error("IMPLEMENTATION_PATH_ESCAPE");
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2097152)
      throw Error("IMPLEMENTATION_FILE_INVALID");
    const bytes = overrideRead
      ? await overrideRead(file)
      : await readFile(absolute);
    if (bytes.length > 2097152) throw Error("IMPLEMENTATION_FILE_LIMIT");
    cache.set(file, bytes);
    return bytes;
  };
  const lock = readImplementationLock(
    (await read("pnpm-lock.yaml")).toString("utf8"),
  );
  const packageJson = JSON.parse((await read("package.json")).toString("utf8"));
  const config = ts.parseJsonConfigFileContent(
    JSON.parse((await read("tsconfig.json")).toString("utf8")),
    ts.sys,
    cwd,
  );
  if (config.errors.length) throw Error("IMPLEMENTATION_TSCONFIG_INVALID");
  const installedVersion = async (name: string) => {
    if (
      !/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*(?![\s\S])/.test(name)
    )
      throw Error("IMPLEMENTATION_PACKAGE_NAME_INVALID");
    const manifest = JSON.parse(
      await readFile(join(cwd, "node_modules", name, "package.json"), "utf8"),
    );
    if (manifest.name !== name)
      throw Error("IMPLEMENTATION_PACKAGE_NAME_MISMATCH");
    return manifest.version;
  };
  let available = 0,
    lockRecords = 0;
  const sourceFiles = new Set<string>();
  for (const entry of entries) {
    const descriptor = entry.descriptor;
    if (descriptor.schemaVersion === "quizforge.implementation-entry.v2")
      await verifyInternalImplementationEntryV2(entry);
    if (
      descriptor.schemaVersion === "quizforge.consumer-implementation-entry.v2"
    )
      await verifyConsumerImplementationEntryV2(entry);
    const maximum = descriptor.kind === "consumer-renderer" ? 262144 : 131072;
    if (
      sha(canonical(descriptor, maximum)) !== entry.entrySha256 ||
      sha(canonical(descriptor.closure, maximum)) !==
        descriptor.implementationSha256
    )
      throw Error("IMPLEMENTATION_DESCRIPTOR_DIGEST");
    if (!isAvailable(entry)) continue;
    available++;
    const names = new Set(
      descriptor.closure.dependencies.roots.map((r) => r.name),
    );
    const listed = new Set(descriptor.closure.files.map((f) => f.path));
    const builtins = new Set<string>();
    for (const f of [
      ...descriptor.closure.files,
      ...descriptor.closure.buildInputs,
    ]) {
      const isBuild = descriptor.closure.buildInputs.some(
        (b) => b.path === f.path,
      );
      if (
        isBuild
          ? !["tsconfig.json", "next.config.ts", "postcss.config.mjs"].includes(
              f.path,
            )
          : !f.path.startsWith("src/") &&
            !f.path.startsWith("public/assets/fonts/")
      )
        throw Error("IMPLEMENTATION_FILE_SCOPE");
      const bytes = await read(f.path);
      if (bytes.length !== f.bytes || sha(bytes) !== f.sha256)
        throw Error("IMPLEMENTATION_FILE_CHANGED:" + f.path);
      sourceFiles.add(f.path);
      if (isBuild) continue;
      if (/\.(?:ts|tsx)$/.test(f.path)) {
        const file = resolve(cwd, f.path),
          ast = ts.createSourceFile(
            file,
            bytes.toString("utf8"),
            ts.ScriptTarget.Latest,
            true,
          );
        const inspect = (node: ts.Node) => {
          if (
            ts.isImportEqualsDeclaration(node) ||
            (ts.isCallExpression(node) &&
              (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
                (ts.isIdentifier(node.expression) &&
                  node.expression.text === "require")))
          )
            throw Error("IMPLEMENTATION_DYNAMIC_IMPORT");
          ts.forEachChild(node, inspect);
        };
        inspect(ast);
        for (const node of ast.statements) {
          if (
            !(ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) ||
            !node.moduleSpecifier ||
            !ts.isStringLiteral(node.moduleSpecifier) ||
            !runtimeImport(node)
          )
            continue;
          const spec = node.moduleSpecifier.text;
          if (spec.startsWith("node:")) {
            builtins.add(spec);
            continue;
          }
          if (spec.startsWith(".") || spec.startsWith("@/")) {
            let target = ts.resolveModuleName(
              spec,
              file,
              config.options,
              ts.sys,
            ).resolvedModule?.resolvedFileName;
            if (!target && spec.endsWith(".css"))
              target = resolve(dirname(file), spec);
            if (!target || !listed.has(relative(cwd, target)))
              throw Error("IMPLEMENTATION_DEPENDENCY_OMITTED:" + spec);
          } else if (!names.has(packageName(spec)))
            throw Error("IMPLEMENTATION_EXTERNAL_OMITTED");
        }
        if (
          f.path.endsWith(".tsx") &&
          (!names.has("react") ||
            descriptor.closure.runtimePolicy.jsxImport !== "react/jsx-runtime")
        )
          throw Error("IMPLEMENTATION_JSX_OMITTED");
      }
      if (f.path.endsWith(".css")) {
        const css = bytes.toString("utf8");
        for (const match of css.matchAll(/@import\s+["']([^"']+)["']/g))
          if (!names.has(match[1]!))
            throw Error("IMPLEMENTATION_CSS_IMPORT_OMITTED");
        for (const match of css.matchAll(
          /url\(\s*["']?([^\s"')]+)["']?\s*\)/g,
        )) {
          const url = match[1]!;
          if (!url.startsWith("/assets/fonts/") || !listed.has("public" + url))
            throw Error("IMPLEMENTATION_CSS_ASSET_OMITTED");
        }
      }
    }
    if (
      [...builtins].sort().join() !==
      [...descriptor.closure.dependencies.builtins].sort().join()
    )
      throw Error("IMPLEMENTATION_BUILTINS_MISMATCH");
    if (sha(lock.settings()) !== descriptor.closure.dependencies.settingsSha256)
      throw Error("IMPLEMENTATION_LOCK_SETTINGS_CHANGED");
    for (const root of descriptor.closure.dependencies.roots) {
      if (
        packageJson[root.section]?.[root.name] !== root.version ||
        (await installedVersion(root.name)) !== root.version ||
        sha(lock.importer(root.section, root.name)) !== root.importerSha256
      )
        throw Error("IMPLEMENTATION_ROOT_DEPENDENCY_CHANGED");
      if (
        !descriptor.closure.dependencies.lockRecords.some(
          (r) => r.section === "snapshots" && r.key === root.lockSnapshot,
        )
      )
        throw Error("IMPLEMENTATION_ROOT_LOCK_OMITTED");
    }
    for (const record of descriptor.closure.dependencies.lockRecords) {
      if (record.key.includes("patch_hash"))
        throw Error("IMPLEMENTATION_PATCH_REQUIRES_EXPLICIT_PIN");
      const text = lock.record(record.section, record.key);
      if (
        Buffer.byteLength(text) !== record.bytes ||
        sha(text) !== record.sha256
      )
        throw Error("IMPLEMENTATION_LOCK_RECORD_CHANGED");
      lockRecords++;
    }
    if (
      descriptor.closure.runtimePolicy.node !== packageJson.engines?.node ||
      descriptor.closure.runtimePolicy.packageManager !==
        packageJson.packageManager
    )
      throw Error("IMPLEMENTATION_RUNTIME_POLICY_CHANGED");
    if (
      descriptor.kind === "renderer" ||
      descriptor.kind === "consumer-renderer"
    ) {
      const font = descriptor.font;
      if ("kind" in font) {
        if (
          (descriptor.schemaVersion !== "quizforge.implementation-entry.v2" &&
            descriptor.schemaVersion !==
              "quizforge.consumer-implementation-entry.v2") ||
          descriptor.presentationMode !== "structured-only" ||
          descriptor.exports.posterPng ||
          descriptor.exports.fullReportPng ||
          font.kind !== "system-structured" ||
          font.pngAvailable !== false
        )
          throw Error("IMPLEMENTATION_STRUCTURED_FONT_MISMATCH");
      } else {
        for (const [path, hash] of [
          [font.file, font.fileSha256],
          [font.coverage, font.coverageSha256],
          [font.licenseFile, font.licenseSha256],
        ])
          if (sha(await read("public" + path)) !== hash)
            throw Error("IMPLEMENTATION_FONT_CHANGED");
        if ((await read("public" + font.file)).length !== font.bytes)
          throw Error("IMPLEMENTATION_FONT_SIZE_CHANGED");
      }
    }
  }
  return {
    descriptors: entries.length,
    available,
    sourceFiles: sourceFiles.size,
    lockRecords,
  };
}
