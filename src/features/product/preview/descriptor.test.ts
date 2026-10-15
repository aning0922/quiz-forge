import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { expect, it } from "vitest";
import { PREVIEW_GENERATED_FONT } from "./font.generated";
import { PREVIEW_FONT, PREVIEW_FONT_ASSET } from "./descriptor";
const sha = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
it("binds generated browser constants to the actual font, coverage and licensed source manifest", async () => {
  const root = "public/assets/fonts/preview-v1-1";
  const manifest = JSON.parse(
    await readFile(path.join(root, "manifest.json"), "utf8"),
  );
  for (const key of Object.keys(PREVIEW_GENERATED_FONT))
    expect(
      PREVIEW_GENERATED_FONT[key as keyof typeof PREVIEW_GENERATED_FONT],
    ).toEqual(manifest[key]);
  const font = await readFile(path.join(root, "serif-600.woff2")),
    coverage = await readFile(path.join(root, "characters.txt")),
    license = await readFile(path.join(root, "OFL.txt"));
  expect(font.length).toBe(PREVIEW_FONT_ASSET.bytes);
  expect(sha(font)).toBe(PREVIEW_FONT.fileSha256);
  expect(sha(coverage)).toBe(PREVIEW_FONT.coverageSha256);
  expect(sha(license)).toBe(manifest.licenseSha256);
  expect(PREVIEW_FONT.version).toBe("1.0.1");
  expect(PREVIEW_FONT_ASSET.file).toBe(
    "/assets/fonts/preview-v1-1/serif-600.woff2",
  );
  for (const c of "守序织传周归邀护歇登稍繁绑航营")
    expect(coverage.toString("utf8")).toContain(c);
  expect(new Set(coverage.toString("utf8").trimEnd()).size).toBe(1105);
});

it("keeps the page font URL aligned with the export binding", async () => {
  const css = await readFile(
    "src/features/theme/preview/preview.module.css",
    "utf8",
  );
  expect(css).toContain(`url("${PREVIEW_FONT_ASSET.file}")`);
  expect(css).not.toContain("/assets/fonts/preview-v1/serif-600.woff2");
});
