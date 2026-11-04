import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { canonicalOrdinaryJson } from "../src/lib/json/canonical";
import { collectQztxImplementationClosure } from "./qztx-implementation-closure";

export const QZTX_HISTORICAL_BINDING_PATH =
  "src/features/product/internal-play/implementation-data/qianzai-historical-readers.json";
const canonical = (value: unknown) =>
  canonicalOrdinaryJson(value, { maxBytes: 1_048_576, maxDepth: 32 });

/** Finite read-only adapters; this binding is never loaded by a write resolver. */
export async function collectQztxHistoricalReaderBinding(cwd: string) {
  const fonts = new Set<string>();
  const originalRenderers = [];
  for (const profile of ["v13", "v14", "v15"] as const) {
    const readJson = async (file: string) =>
      JSON.parse(await readFile(path.join(cwd, file), "utf8"));
    const prefix = `src/features/theme/qianzai-tongxin/historical-${profile}/`;
    const inputs = await readJson(prefix + "runtime-inputs.json");
    const editorial = await readJson(prefix + "editorial-fonts.json");
    for (const font of [inputs.font, editorial.brush, editorial.literary]) {
      for (const field of ["file", "coverage", "licenseFile"] as const) {
        assert.match(
          font[field],
          /^\/assets\/fonts\/[a-zA-Z0-9_/-]+\.(woff2|txt)$/,
        );
        fonts.add("public" + font[field]);
      }
    }
    const entry = await readJson(
      `src/features/product/internal-play/implementation-data/consumer-qianzai-historical-${profile}.json`,
    );
    const { kind, id, version } = entry.descriptor;
    originalRenderers.push({
      kind,
      id,
      version,
      entrySha256: entry.entrySha256,
    });
  }
  const closure = await collectQztxImplementationClosure(
    cwd,
    [
      {
        path: "src/features/product/internal-play/historical-client-v2.ts",
        exports: ["resolveHistoricalReportRuntimeV2"],
        runtime: "browser",
      },
    ],
    [...fonts].sort(),
  );
  const payload = {
    schemaVersion: "quizforge.qianzai-historical-readers.v1",
    access: "verified-report-read-only",
    originalRenderers,
    closure,
  };
  return {
    ...payload,
    sha256: createHash("sha256").update(canonical(payload)).digest("hex"),
  };
}

export async function verifyQztxHistoricalReaderBinding(cwd: string) {
  const expected = JSON.parse(
    await readFile(path.join(cwd, QZTX_HISTORICAL_BINDING_PATH), "utf8"),
  );
  const actual = await collectQztxHistoricalReaderBinding(cwd);
  assert.equal(
    canonical(expected),
    canonical(actual),
    "QZTX_HISTORICAL_READER_CLOSURE_CHANGED",
  );
  return {
    profiles: actual.originalRenderers.length,
    files: actual.closure.files.length,
    sha256: actual.sha256,
    access: actual.access,
  };
}
