import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";
import { qianzaiRuntimeInputsSchema } from "../src/features/theme/qianzai-tongxin/runtime-inputs";

const args = process.argv.slice(2);
if (
  args.length !== 6 ||
  args[0] !== "--art-map" ||
  args[2] !== "--font-manifest" ||
  args[4] !== "--out"
)
  throw Error("EXPLICIT_RUNTIME_INPUTS_REQUIRED");
const out = resolve(args[5]!);
if (!out.startsWith(resolve(process.cwd(), ".cache") + "/"))
  throw Error("PRIVATE_CANDIDATE_REQUIRED");
const map = z
  .array(
    z.strictObject({
      key: z.string(),
      proposedId: z.string(),
      version: z.string(),
      layer: z.enum(["clean", "prototype-scene-base", "prototype-option-skin"]),
      mediaType: z.string(),
      bytes: z.number(),
      sha256: z.string(),
      width: z.number(),
      height: z.number(),
    }),
  )
  .length(14)
  .parse(JSON.parse(await readFile(args[1]!, "utf8")));
const manifest = JSON.parse(await readFile(args[3]!, "utf8"));
const font = Object.fromEntries(
  [
    "id",
    "version",
    "family",
    "weight",
    "file",
    "fileSha256",
    "bytes",
    "coverage",
    "coverageSha256",
    "licenseFile",
    "licenseSha256",
  ].map((k) => [k, manifest[k]]),
);
if (font.id !== "qianzai-tongxin-serif" || font.version !== "1.2.0")
  throw Error("QIANZAI_V3_FONT_REQUIRED");
const roles = {
  scene: "background",
  question: "questionPaper",
  option: "optionIdle",
  chosen: "optionSelected",
} as const;
const seen = new Set<string>();
const resources = map.map((row) => {
  if (seen.has(row.key)) throw Error("DUPLICATE_ART_KEY");
  seen.add(row.key);
  const match = /^(scene|question|option|chosen)([0-2])$/.exec(row.key);
  const slot =
    row.key === "cover"
      ? "cover"
      : row.key === "gender"
        ? "preferenceScene"
        : match
          ? `acts.${match[2]}.${roles[match[1] as keyof typeof roles]}`
          : null;
  const layer =
    row.key === "cover" || row.key === "gender" || match?.[1] === "scene"
      ? "prototype-scene-base"
      : match?.[1] === "question"
        ? "clean"
        : "prototype-option-skin";
  if (!slot || row.layer !== layer) throw Error("ART_ROLE_MISMATCH");
  return {
    asset: {
      resourceRef: {
        productId: "qianzai-tongxin",
        id: row.proposedId,
        version: row.version,
      },
      mediaType: row.mediaType,
      bytes: row.bytes,
      sha256: row.sha256,
      width: row.width,
      height: row.height,
      purpose: row.key === "cover" ? "cover" : "decoration",
      approval: "approved",
    },
    slot,
    layer,
  };
});
const input = qianzaiRuntimeInputsSchema.parse({
  schemaVersion: "qianzai-runtime-inputs.v1",
  font,
  resources,
});
await writeFile(out, JSON.stringify(input, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
