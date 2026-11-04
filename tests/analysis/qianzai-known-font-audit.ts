/** Fixed textual corpus audit only; never generates/registers fonts or reads answers. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { qianzaiKnownRoleText } from "../../src/features/report/qianzai-tongxin/known-role-data";
import { qianzaiSupportedThemeReadingText } from "../../src/features/report/qianzai-tongxin/supported-theme-reading";
import { QIANZAI_RUNTIME_INPUTS } from "../../src/features/theme/qianzai-tongxin/runtime-inputs";
import { QIANZAI_EDITORIAL_FONTS } from "../../src/features/theme/qianzai-tongxin/editorial-fonts";
const output = process.argv[2];
assert.ok(
  output && path.isAbsolute(output),
  "explicit absolute output required",
);
const corpus = [
  ...qianzaiKnownRoleText(),
  ...qianzaiSupportedThemeReadingText(),
  "与人物的呼应",
  "放回具体条件看",
  "带进日常的一小步",
  "选择里的线索",
  " ",
].join("\n");
const required = [
  ...new Set(Array.from(corpus).filter((c) => c !== "\n" && c !== "\r")),
].sort((a, b) => a.codePointAt(0)! - b.codePointAt(0)!);
assert(required.includes(" "));
const records = [];
for (const descriptor of [
  QIANZAI_RUNTIME_INPUTS.font!,
  QIANZAI_EDITORIAL_FONTS.literary,
]) {
  const coverage = await readFile(
    path.join(process.cwd(), "public", descriptor.coverage),
  );
  assert.equal(
    createHash("sha256").update(coverage).digest("hex"),
    descriptor.coverageSha256,
  );
  const present = new Set(Array.from(coverage.toString("utf8")));
  const missing = required.filter((c) => !present.has(c));
  records.push({
    id: descriptor.id,
    version: descriptor.version,
    coverageSha256: descriptor.coverageSha256,
    requiredCodepoints: required.length,
    missing: missing.map((c) => ({
      character: c,
      codepoint:
        "U+" + c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0"),
    })),
  });
}
const report = {
  scope:
    "fixed new editorial/evidence-reading corpus against retained Serif/Literary coverage only; not final document or brush coverage acceptance",
  spaceIncluded: true,
  fontFilesChanged: false,
  registrationChanged: false,
  brush: "deferred until exact new composition/brush strings are fixed",
  records,
};
await writeFile(output, JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(JSON.stringify(report, null, 2));
