import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { readImplementationLock } from "./internal-implementation-lock";
import { implementationClosureV2Schema } from "../src/features/product/internal-versions/implementation-schema-v2";
import engineBaseline from "../src/features/product/internal-versions/implementation-data/engine-archetype-v1-security.json";
import browserBaseline from "../src/features/product/internal-play/implementation-data/consumer-folio-cabinet-v1-2.json";

type Entry = {
  path: string;
  exports: string[];
  runtime: "server" | "browser";
};
const sha = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
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
const externalRoot = (name: string) =>
  name.startsWith("@")
    ? name.split("/").slice(0, 2).join("/")
    : name.split("/")[0]!;

/** Local maintainer tool. Reuses the existing pinned build dependencies, never downloads or runs input code. */
export async function collectQztxImplementationClosure(
  cwd: string,
  entries: Entry[],
  fixedFontFiles: readonly string[] = [],
) {
  cwd = await realpath(cwd);
  const browser = entries.some((e) => e.runtime === "browser");
  const baseline = structuredClone(
    (browser ? browserBaseline : engineBaseline).descriptor.closure,
  );
  if (browser) {
    // QZTX uses the repository's already installed icon package. Pin its exact
    // importer and both lock spans; this does not admit arbitrary new roots.
    baseline.dependencies.roots.push({
      name: "lucide-react",
      version: "1.55.0",
      lockSnapshot: "lucide-react@1.55.0(@types/react@19.3.0)(react@19.3.0)",
      section: "dependencies",
      importerSha256:
        "1ab4fc45cf9be5882f5e37b9f326470e0cc940fd2dba6695c036640402fd77a9",
    });
    baseline.dependencies.lockRecords.push(
      {
        section: "packages",
        key: "lucide-react@1.55.0",
        bytes: 322,
        sha256:
          "a7117dfd67569925c519dcf27a2dbe5e063d4cd65d50652ca896f5b12ad0c6c4",
      },
      {
        section: "snapshots",
        key: "lucide-react@1.55.0(@types/react@19.3.0)(react@19.3.0)",
        bytes: 152,
        sha256:
          "962402742ad255481c57b56a0f18d66d45fba6d2503ecad6e5cb7a4ac7596212",
      },
    );
    baseline.dependencies.roots.sort((a, b) =>
      a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
    );
    baseline.dependencies.lockRecords.sort((a, b) => {
      const x = `${a.section}:${a.key}`,
        y = `${b.section}:${b.key}`;
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }
  const sources = new Map<string, Buffer>();
  const builtins = new Set<string>();
  const external = new Set<string>();
  const read = async (file: string) => {
    const absolute = resolve(cwd, file);
    if (
      !absolute.startsWith(cwd + "/") ||
      (await realpath(absolute)) !== absolute
    )
      throw Error("IMPLEMENTATION_SOURCE_PATH");
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2_097_152)
      throw Error("IMPLEMENTATION_SOURCE_FILE");
    return readFile(absolute);
  };
  const packageJson = JSON.parse((await read("package.json")).toString("utf8"));
  const config = ts.parseJsonConfigFileContent(
    JSON.parse((await read("tsconfig.json")).toString("utf8")),
    ts.sys,
    cwd,
  );
  if (config.errors.length) throw Error("IMPLEMENTATION_TSCONFIG_INVALID");
  const lock = readImplementationLock(
    (await read("pnpm-lock.yaml")).toString("utf8"),
  );
  if (sha(lock.settings()) !== baseline.dependencies.settingsSha256)
    throw Error("IMPLEMENTATION_BUILD_SETTINGS_CHANGED");
  for (const root of baseline.dependencies.roots) {
    const section = root.section as "dependencies" | "devDependencies";
    const installed = JSON.parse(
      await readFile(
        resolve(cwd, "node_modules", root.name, "package.json"),
        "utf8",
      ),
    );
    if (
      packageJson[section]?.[root.name] !== root.version ||
      installed.name !== root.name ||
      installed.version !== root.version ||
      sha(lock.importer(section, root.name)) !== root.importerSha256
    )
      throw Error("IMPLEMENTATION_PIN_CHANGED");
  }
  for (const record of baseline.dependencies.lockRecords) {
    const bytes = lock.record(
      record.section as "packages" | "snapshots",
      record.key,
    );
    if (
      Buffer.byteLength(bytes) !== record.bytes ||
      sha(bytes) !== record.sha256
    )
      throw Error("IMPLEMENTATION_LOCK_CHANGED");
  }
  if (
    baseline.runtimePolicy.node !== packageJson.engines.node ||
    baseline.runtimePolicy.packageManager !== packageJson.packageManager
  )
    throw Error("IMPLEMENTATION_RUNTIME_CHANGED");

  const visit = async (file: string): Promise<void> => {
    if (sources.has(file)) return;
    if (
      (!file.startsWith("src/") && !file.startsWith("public/assets/fonts/")) ||
      sources.size >= 512
    )
      throw Error("IMPLEMENTATION_SOURCE_SCOPE");
    const bytes = await read(file);
    sources.set(file, bytes);
    if (/\.(?:ts|tsx)$/.test(file)) {
      const absolute = resolve(cwd, file);
      const ast = ts.createSourceFile(
        absolute,
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
      const requiredExports =
        entries.find((e) => e.path === file)?.exports ?? [];
      const declared = new Set<string>();
      for (const node of ast.statements) {
        if (
          ts.canHaveModifiers(node) &&
          ts
            .getModifiers(node)
            ?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)
        ) {
          if (
            (ts.isFunctionDeclaration(node) || ts.isClassDeclaration(node)) &&
            node.name
          )
            declared.add(node.name.text);
          if (ts.isVariableStatement(node))
            for (const d of node.declarationList.declarations)
              if (ts.isIdentifier(d.name)) declared.add(d.name.text);
        }
        if (
          ts.isExportDeclaration(node) &&
          !node.isTypeOnly &&
          node.exportClause &&
          ts.isNamedExports(node.exportClause)
        )
          for (const e of node.exportClause.elements)
            if (!e.isTypeOnly) declared.add(e.name.text);
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
            absolute,
            config.options,
            ts.sys,
          ).resolvedModule?.resolvedFileName;
          if (!target && spec.endsWith(".css"))
            target = resolve(dirname(absolute), spec);
          if (!target) throw Error("IMPLEMENTATION_IMPORT_UNRESOLVED");
          await visit(relative(cwd, target));
        } else external.add(externalRoot(spec));
      }
      if (requiredExports.some((name) => !declared.has(name)))
        throw Error("IMPLEMENTATION_EXPORT_MISSING");
      if (file.endsWith(".tsx")) external.add("react");
    }
    if (file.endsWith(".css")) {
      const css = bytes.toString("utf8");
      for (const match of css.matchAll(/@import\s+["']([^"']+)["']/g))
        external.add(match[1]!);
      for (const match of css.matchAll(/url\(\s*["']?([^\s"')]+)["']?\s*\)/g)) {
        if (!match[1]!.startsWith("/assets/fonts/"))
          throw Error("IMPLEMENTATION_CSS_ASSET_SCOPE");
        await visit("public" + match[1]);
      }
    }
  };
  for (const entry of entries) await visit(entry.path);
  for (const file of fixedFontFiles) {
    if (
      !file.startsWith("public/assets/fonts/") ||
      !/\.(?:woff2|txt)$/.test(file)
    )
      throw Error("IMPLEMENTATION_FONT_SCOPE");
    await visit(file);
  }
  const pinned = new Set(baseline.dependencies.roots.map((r) => r.name));
  const unpinned = [...external].filter((name) => !pinned.has(name));
  if (unpinned.length)
    throw Error(
      `IMPLEMENTATION_NEW_DEPENDENCY_REQUIRES_PIN:${unpinned.join(",")}`,
    );
  const fact = (file: string, bytes: Buffer) => ({
    path: file,
    bytes: bytes.length,
    sha256: sha(bytes),
  });
  return implementationClosureV2Schema.parse({
    entrypoints: entries,
    files: [...sources]
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([file, bytes]) => fact(file, bytes)),
    buildInputs: await Promise.all(
      baseline.buildInputs.map(async (f) => fact(f.path, await read(f.path))),
    ),
    dependencies: { ...baseline.dependencies, builtins: [...builtins].sort() },
    runtimePolicy: baseline.runtimePolicy,
  });
}
