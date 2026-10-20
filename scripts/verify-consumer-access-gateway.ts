import { readFile, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import ts from "typescript";
import { z } from "zod";
import {
  CONSUMER_PROTOCOLS_V1,
  consumerRendererIdentitySchema,
} from "../src/lib/consumer-contract/v1/identities";
import { verifyConsumerImplementationEntry } from "../src/features/product/internal-play/implementation-schema";

const bindingSchema = z.strictObject({
  renderer: consumerRendererIdentitySchema,
  protocol: z.literal(CONSUMER_PROTOCOLS_V1.access),
  sourcePath: z.literal("src/features/theme/consumer-v1-1/access.tsx"),
  exportName: z.literal("ConsumerAccessV1_1"),
});
const identityKey = (v: z.infer<typeof consumerRendererIdentitySchema>) =>
  JSON.stringify([v.kind, v.id, v.version, v.entrySha256]);

/**
 * Read-only gate for trusted build inputs, never supplied URL/Key/DB metadata.
 * Verify the pure binding and the actual static JSX wiring without evaluating
 * client components, CSS, or browser-only modules in the build-gate process.
 */
export async function verifyConsumerAccessGateway(
  cwd: string,
  binding: unknown,
  catalog: readonly unknown[],
  compiledIdentities: readonly unknown[],
  overrideRead?: (path: string) => Promise<Buffer>,
) {
  const selected = bindingSchema.parse(binding);
  if (
    selected.renderer.id !== "consumer-folio-cabinet" ||
    selected.renderer.version !== "1.0.1"
  )
    throw Error("CONSUMER_GATEWAY_VERSION_MISMATCH");
  const wanted = identityKey(selected.renderer);
  const available = compiledIdentities.map((v) =>
    identityKey(consumerRendererIdentitySchema.parse(v)),
  );
  const entries = await Promise.all(
    catalog.map(verifyConsumerImplementationEntry),
  );
  const exact = entries.filter(
    (entry) =>
      identityKey({
        ...entry.descriptor,
        entrySha256: entry.entrySha256,
      }) === wanted,
  );
  if (
    available.filter((key) => key === wanted).length !== 1 ||
    exact.length !== 1
  )
    throw Error("CONSUMER_GATEWAY_BINDING_MISMATCH");
  const descriptor = exact[0]!.descriptor;
  if (
    descriptor.protocols.access !== selected.protocol ||
    !descriptor.closure.entrypoints.some(
      (e) =>
        e.runtime === "browser" &&
        e.path === selected.sourcePath &&
        e.exports.includes(selected.exportName),
    ) ||
    !descriptor.closure.files.some((f) => f.path === selected.sourcePath)
  )
    throw Error("CONSUMER_GATEWAY_ENTRYPOINT_MISMATCH");

  async function verifyStaticRender(
    path: string,
    specifier: string,
    name: string,
    exportName: string,
    wrapper: boolean,
  ) {
    const absolute = resolve(cwd, path);
    const stat = await lstat(absolute);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32768)
      throw Error("CONSUMER_GATEWAY_SOURCE_INVALID");
    const bytes = overrideRead
      ? await overrideRead(path)
      : await readFile(absolute);
    if (bytes.length > 32768) throw Error("CONSUMER_GATEWAY_SOURCE_INVALID");
    const ast = ts.createSourceFile(
      path,
      bytes.toString("utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    const imports = ast.statements.filter(ts.isImportDeclaration);
    const matches = imports.filter((node) => {
      if (
        !ts.isStringLiteral(node.moduleSpecifier) ||
        node.moduleSpecifier.text !== specifier
      )
        return false;
      const clause = node.importClause;
      const bindings = clause?.namedBindings;
      return (
        !clause?.isTypeOnly &&
        bindings &&
        ts.isNamedImports(bindings) &&
        bindings.elements.some(
          (e) =>
            !e.isTypeOnly &&
            e.name.text === name &&
            (e.propertyName?.text ?? e.name.text) === exportName,
        )
      );
    });
    const functions = ast.statements.filter(ts.isFunctionDeclaration);
    const target = functions[0];
    const expectedFunction = wrapper ? "ConsumerAccessGateway" : "Page";
    const invalid = () => {
      throw Error("CONSUMER_GATEWAY_STATIC_WIRING_MISMATCH:" + path);
    };
    if (
      functions.length !== 1 ||
      !target ||
      target.name?.text !== expectedFunction ||
      target.parameters.length !== 0 ||
      !target.body ||
      !target.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ||
      target.modifiers.some((m) => m.kind === ts.SyntaxKind.DefaultKeyword) ===
        wrapper ||
      ast.statements.some(
        (node) => node !== target && !ts.isImportDeclaration(node),
      )
    )
      return invalid();
    const returns: ts.ReturnStatement[] = [];
    const renderTags: string[] = [];
    let dynamic = false;
    const inspect = (node: ts.Node) => {
      if (ts.isReturnStatement(node)) returns.push(node);
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node))
        renderTags.push(node.tagName.getText(ast));
      if (
        ts.isImportEqualsDeclaration(node) ||
        (ts.isCallExpression(node) &&
          (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
            (ts.isIdentifier(node.expression) &&
              node.expression.text === "require")))
      )
        dynamic = true;
      ts.forEachChild(node, inspect);
    };
    inspect(ast);
    // An occurrence in Boolean(...), a callback or a dead local variable is not
    // proof of rendering. Only the actual exported function's final return is
    // accepted. These intentionally thin modules have one reviewed shape.
    if (
      dynamic ||
      matches.length !== 1 ||
      returns.length !== 1 ||
      returns[0] !== target.body.statements.at(-1) ||
      renderTags.filter((tag) => tag === name).length !== 1 ||
      renderTags.some((tag) => tag !== name && tag !== "div")
    )
      return invalid();
    let returned = returns[0]!.expression;
    while (returned && ts.isParenthesizedExpression(returned))
      returned = returned.expression;
    const directChild = (node: ts.Node | undefined) =>
      !!node &&
      ts.isJsxSelfClosingElement(node) &&
      ts.isIdentifier(node.tagName) &&
      node.tagName.text === name &&
      node.attributes.properties.length === 0;
    const printer = ts.createPrinter({ removeComments: true });
    const print = (node: ts.Node, source = ast) =>
      printer.printNode(ts.EmitHint.Unspecified, node, source);
    if (!wrapper) {
      if (!directChild(returned) || target.body.statements.length !== 2)
        return invalid();
      // Preserve the reviewed page-source check and reject local shadowing or
      // alternate returns introduced before the direct gateway render.
      const guard = ts.createSourceFile(
        "guard.ts",
        "if (!(await consumerPageSourceAllowed())) notFound();",
        ts.ScriptTarget.Latest,
        true,
      );
      if (
        print(target.body.statements[0]!) !== print(guard.statements[0]!, guard)
      )
        return invalid();
      return;
    }
    const bindingImports = imports.filter(
      (node) =>
        ts.isStringLiteral(node.moduleSpecifier) &&
        node.moduleSpecifier.text === "./access-gateway-binding" &&
        !node.importClause?.isTypeOnly &&
        node.importClause?.namedBindings &&
        ts.isNamedImports(node.importClause.namedBindings) &&
        node.importClause.namedBindings.elements.length === 1 &&
        node.importClause.namedBindings.elements[0]!.name.text ===
          "CONSUMER_ACCESS_GATEWAY" &&
        !node.importClause.namedBindings.elements[0]!.propertyName &&
        !node.importClause.namedBindings.elements[0]!.isTypeOnly,
    );
    const declaration = ts.createSourceFile(
      "binding.ts",
      "const { renderer, protocol } = CONSUMER_ACCESS_GATEWAY;",
      ts.ScriptTarget.Latest,
      true,
    );
    if (
      bindingImports.length !== 1 ||
      target.body.statements.length !== 2 ||
      print(target.body.statements[0]!) !==
        print(declaration.statements[0]!, declaration) ||
      !returned ||
      !ts.isJsxElement(returned) ||
      returned.openingElement.tagName.getText(ast) !== "div" ||
      returned.closingElement.tagName.getText(ast) !== "div"
    )
      return invalid();
    const children = returned.children.filter(
      (node) => !ts.isJsxText(node) || node.text.trim() !== "",
    );
    if (children.length !== 1 || !directChild(children[0])) return invalid();
    const expectedAttributes = new Map([
      ["data-consumer-access-gateway", "renderer.id"],
      ["data-consumer-access-version", "renderer.version"],
      ["data-consumer-access-entry", "renderer.entrySha256"],
      ["data-consumer-access-protocol", "protocol"],
    ]);
    const attributes = returned.openingElement.attributes.properties;
    if (attributes.length !== expectedAttributes.size) return invalid();
    for (const attribute of attributes) {
      if (
        !ts.isJsxAttribute(attribute) ||
        !attribute.initializer ||
        !ts.isJsxExpression(attribute.initializer) ||
        !attribute.initializer.expression ||
        expectedAttributes.get(attribute.name.getText(ast)) !==
          print(attribute.initializer.expression)
      )
        return invalid();
      expectedAttributes.delete(attribute.name.getText(ast));
    }
    if (expectedAttributes.size !== 0) return invalid();
  }
  await verifyStaticRender(
    "src/features/product/internal-play/access-gateway.tsx",
    "@/features/theme/consumer-v1-1/access",
    selected.exportName,
    selected.exportName,
    true,
  );
  await verifyStaticRender(
    "src/app/(consumer)/access/page.tsx",
    "@/features/product/internal-play/access-gateway",
    "ConsumerAccessGateway",
    "ConsumerAccessGateway",
    false,
  );
  return {
    renderer: selected.renderer,
    protocol: selected.protocol,
    sourcePath: selected.sourcePath,
    exportName: selected.exportName,
  };
}
