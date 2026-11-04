/** Fixed new-edition font input closure. Real candidate scoring/composition with
 * a synthetic display envelope only; no persisted report, runtime admission or IO. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { canonicalP1Json } from "../../src/features/quizpack/v1/canonical";
import { quizPackContentV3Schema } from "../../src/features/quizpack/content/v3";
import { prepareContentV3 } from "../../src/features/quizpack/content/v3-scoring-adapter";
import { projectQianzaiConsumerResult } from "../../src/features/theme/qianzai-tongxin/projection";
import { qianzaiPresentationFixture } from "../../src/features/report/qianzai-tongxin/result-presentation.test-support";
import { deriveQianzaiResultPresentation } from "../../src/features/report/qianzai-tongxin/result-presentation";
import { qianzaiSnapshotDocument } from "../../src/features/report/qianzai-tongxin/presentation";
import {
  qianzaiExportText,
  qianzaiExportBrushText,
} from "../../src/features/report/qianzai-tongxin/layout";
import { qianzaiKnownRoleText } from "../../src/features/report/qianzai-tongxin/known-role-data";
import {
  qianzaiKnownBrushText,
  qianzaiConsumerCopyText,
} from "../../src/features/report/qianzai-tongxin/consumer-copy";
import { qianzaiSupportedThemeReadingText } from "../../src/features/report/qianzai-tongxin/supported-theme-reading";
import { QIANZAI_CLASSICAL_EDITION } from "../../src/features/report/qianzai-tongxin/classical-edition";
import { QIANZAI_KNOWN_PRESENTATION_SOURCE_SHA256 } from "../../src/features/report/qianzai-tongxin/known-presentation-source";
import { CONSUMER_REEXCHANGE_COPY } from "../../src/lib/consumer-contract/policy-display";
import { QIANZAI_RUNTIME_INPUTS } from "../../src/features/theme/qianzai-tongxin/historical-v14/runtime-inputs";
import { QIANZAI_EDITORIAL_FONTS } from "../../src/features/theme/qianzai-tongxin/historical-v14/editorial-fonts";

const [sourceFile, outputDirectory] = process.argv.slice(2);
assert(sourceFile && outputDirectory && process.argv.length === 4);
assert(path.isAbsolute(sourceFile));
assert.equal(await realpath(sourceFile), sourceFile);
const out = path.resolve(outputDirectory);
assert(out.startsWith(process.cwd() + "/.cache/"));
assert.equal(await realpath(path.dirname(out)), path.dirname(out));
const sha = (data: string | Uint8Array) =>
  createHash("sha256").update(data).digest("hex");
const content = quizPackContentV3Schema.parse(
  JSON.parse(await readFile(sourceFile, "utf8")),
);
assert.equal(
  sha(canonicalP1Json(content)),
  QIANZAI_KNOWN_PRESENTATION_SOURCE_SHA256,
);
const prepared = prepareContentV3(content);
assert(prepared.ok);
const bodyTexts: string[] = [],
  brushTexts: string[] = [...qianzaiKnownBrushText()];
const documents = [];
const shell = await qianzaiPresentationFixture();
for (const witness of content.bindings.witnesses.entries) {
  const result = projectQianzaiConsumerResult(prepared.value, {
    schemaVersion: "quiz-scoring-input.v2",
    answers: witness.answers,
    matchingContext: {
      schemaVersion: "quiz-matching-context.v1",
      preference: witness.preference,
      policyRef: content.core.scoringDefinition.matchingPolicy.ref,
    },
  });
  assert(result.ok);
  assert.deepEqual(
    result.value.display.selectedResultRef,
    witness.expectedResultRef,
  );
  const view = {
    ...shell.view,
    renderer: { ...shell.view.renderer, version: "1.5.0" },
    display: result.value.display,
  };
  const presentation = deriveQianzaiResultPresentation(view, {
    renderer: view.renderer,
    profileVersion: QIANZAI_CLASSICAL_EDITION.presentationVersion,
    canonicalContentSha256: QIANZAI_KNOWN_PRESENTATION_SOURCE_SHA256,
  });
  assert(presentation, "EXACT_NEW_PRESENTATION_REQUIRED");
  const doc = qianzaiSnapshotDocument(
    view.display.body,
    undefined,
    presentation,
  );
  assert.equal(doc.consumerCopyVersion, QIANZAI_CLASSICAL_EDITION.copyVersion);
  assert.equal(doc.sections.length, 6);
  for (const kind of ["poster", "full-report"] as const) {
    bodyTexts.push(...qianzaiExportText(view.display.body, kind, presentation));
    brushTexts.push(
      ...qianzaiExportBrushText(view.display.body, kind, presentation),
    );
  }
  documents.push({
    roleId: witness.expectedResultRef.id,
    bodySha256: view.display.bodySha256,
    name: doc.name,
    volumes: doc.sections.length,
    consumerCopyVersion: doc.consumerCopyVersion,
    assets: view.display.assets.length,
  });
}
assert.equal(documents.length, 10);
const uiFiles = [
  "src/features/theme/qianzai-tongxin/views.tsx",
  "src/features/theme/qianzai-tongxin/experience.tsx",
  "src/features/theme/qianzai-tongxin/report.tsx",
  "src/features/theme/qianzai-tongxin/share-panel.tsx",
  "src/features/theme/qianzai-tongxin/runtime.tsx",
  "src/features/theme/consumer-v1/host.tsx",
  "src/features/theme/consumer-v2/components.tsx",
  "src/features/theme/consumer-v2/experience.tsx",
  "src/features/theme/consumer-v2/controller.ts",
  "src/features/theme/consumer-current/session.tsx",
];
const ui: string[] = [];
const uiInputs = [];
for (const file of uiFiles) {
  const bytes = await readFile(file);
  uiInputs.push({ path: file, sha256: sha(bytes) });
  const source = ts.createSourceFile(
    file,
    bytes.toString(),
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const visit = (node: ts.Node) => {
    if (
      ts.isStringLiteralLike(node) ||
      ts.isJsxText(node) ||
      node.kind === ts.SyntaxKind.TemplateHead ||
      node.kind === ts.SyntaxKind.TemplateMiddle ||
      node.kind === ts.SyntaxKind.TemplateTail
    ) {
      const value = (node as ts.StringLiteral).text;
      if (value && /\p{Script=Han}/u.test(value))
        ui.push(ts.isJsxText(node) ? value.replace(/\s+/g, " ").trim() : value);
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
}
const collect = (value: unknown): string[] =>
  typeof value === "string"
    ? [value]
    : Array.isArray(value)
      ? value.flatMap(collect)
      : value && typeof value === "object"
        ? Object.values(value).flatMap(collect)
        : [];
const fixedBody = [
  ...qianzaiKnownRoleText(),
  ...qianzaiConsumerCopyText(),
  ...qianzaiSupportedThemeReadingText(),
  ...Object.values(CONSUMER_REEXCHANGE_COPY),
  ...ui,
  ...bodyTexts,
  ...collect({
    title: content.core.title,
    questions: content.core.questions,
    dimensions: content.core.dimensions,
    results: content.core.results,
    templates: content.bindings.reportTemplates.map((t) => ({
      volumes: t.volumes.map((v) => ({
        title: v.title,
        fallbackText: v.fallbackText,
      })),
      claims: t.claims.map((c) => ({
        text: c.text,
        evidence: c.evidence.map((e) => e.scope),
        counterevidence: c.counterevidence.map((e) => e.scope),
      })),
    })),
  }),
  " ",
];
const descriptors = {
  serif: QIANZAI_RUNTIME_INPUTS.font!,
  literary: QIANZAI_EDITORIAL_FONTS.literary,
  brush: QIANZAI_EDITORIAL_FONTS.brush,
};
await mkdir(out, { mode: 0o700 });
const records = [];
for (const [kind, descriptor] of Object.entries(descriptors)) {
  const retained = await readFile(
    path.join(process.cwd(), "public", descriptor.coverage),
  );
  assert.equal(sha(retained), descriptor.coverageSha256);
  const texts =
    kind === "brush"
      ? [retained.toString(), ...brushTexts, " "]
      : [retained.toString(), ...fixedBody];
  const chars = [
    ...new Set(
      Array.from(texts.join("\n")).filter(
        (c) => c !== "\n" && c !== "\r" && c !== "\t",
      ),
    ),
  ].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
  assert(chars.includes(" "));
  const text = chars.join("") + "\n";
  await writeFile(path.join(out, kind + "-characters.txt"), text, {
    flag: "wx",
    mode: 0o600,
  });
  records.push({
    kind,
    codepoints: chars.length,
    charactersSha256: sha(text),
    spaceIncluded: true,
    retainedCoverageSha256: descriptor.coverageSha256,
    scope:
      kind === "brush"
        ? "retained brush coverage plus all possible new decorative/card/biography headings and final verse; excludes biography body/metadata/source notes"
        : "declared body/literary fixed corpus superset, UI/source text, all known role prose and possible qualified reading",
  });
}
const receipt = {
  status: "PASS_FIXED_FONT_CORPUS_ONLY",
  sourceSha256: QIANZAI_KNOWN_PRESENTATION_SOURCE_SHA256,
  syntheticRendererEnvelope: true,
  persistedReports: false,
  documents,
  uiInputs,
  records,
  subsetGenerated: false,
  sourceAdmission: "NOT_RUN",
};
await writeFile(
  path.join(out, "receipt.json"),
  JSON.stringify(receipt, null, 2) + "\n",
  { flag: "wx", mode: 0o600 },
);
console.log(
  JSON.stringify({
    status: receipt.status,
    documents: documents.length,
    records,
    subsetGenerated: false,
  }),
);
