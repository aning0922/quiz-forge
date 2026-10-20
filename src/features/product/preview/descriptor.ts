import { PREVIEW_GENERATED_FONT as font } from "./font.generated";
export const PREVIEW_RENDERER = Object.freeze({
  id: "folio-cabinet-preview",
  version: "1.0.0",
});
export const PREVIEW_FONT = Object.freeze({
  id: font.id,
  version: font.version,
  fileSha256: font.fileSha256,
  coverageSha256: font.coverageSha256,
});
export const PREVIEW_FONT_ASSET = Object.freeze({
  ...PREVIEW_FONT,
  family: font.family,
  weight: font.weight,
  file: font.file,
  bytes: font.bytes,
  coverage: font.coverage,
  licenseFile: font.licenseFile,
});

export { DISPLAY_COMPONENT_IDS_V1 as PREVIEW_COMPONENT_IDS } from "@/lib/assessment-contract/display-limits-v1";
