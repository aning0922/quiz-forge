/** Stage only a shared export art layer and Li Qingzhao name art for a local demo. */
import {
  readFile,
  writeFile,
  mkdir,
  copyFile,
  realpath,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { canonicalP1Json } from "../src/features/quizpack/v1/canonical";
import {
  quizPackContentV3Schema,
  privateTestResourceV3Schema,
} from "../src/features/quizpack/content/v3";
import { prepareContentV3 } from "../src/features/quizpack/content/v3-scoring-adapter";
import serifV8 from "../public/assets/fonts/qianzai-v8/manifest.json";
import previous from "../src/features/quizpack/content/qianzai-local-liqingzhao-online-fixture.json";
const [source, images, out] = process.argv.slice(2);
if (
  process.argv.length !== 5 ||
  ![source, images, out].every((v) => v && path.isAbsolute(v)) ||
  !path.resolve(out!).startsWith(path.join(process.cwd(), ".cache/"))
)
  throw Error("EXPLICIT_PRIVATE_PATHS_REQUIRED");
if ((await realpath(path.dirname(out!))) !== path.dirname(out!))
  throw Error("OUTPUT_SYMLINK_REJECTED");
const sha = (b: Uint8Array | string) =>
  createHash("sha256").update(b).digest("hex");
const read = async (p: string) => JSON.parse(await readFile(p, "utf8"));
const old = quizPackContentV3Schema.parse(
  await read(path.join(source!, "content.json")),
);
if (sha(canonicalP1Json(old)) !== previous.canonicalContentSha256)
  throw Error("BASE_SOURCE_CHANGED");
const content = structuredClone(old),
  b = content.bindings;
const role = b.slots.characters.find((c) => c.resultRef.id === "li-qingzhao")!;
const oldName = b.resources.find((r) => r.id === role.nameArt.id)!;
if (b.slots.neutral.reportBorder !== null) throw Error("BASE_BORDER_CHANGED");
const inputs = [
  {
    id: "qztx-parity-li-qingzhao-name",
    file: "name-ink-v1.png",
    slot: "character.nameArt",
    text: "李清照原型风格透明墨色书法候选",
  },
  {
    id: "qztx-parity-common-border",
    file: "common-paper-landscape.png",
    slot: "reportBorder",
    text: "按原型重制的无字无人山水宣纸共用背景候选",
  },
];
const staged = await Promise.all(
  inputs.map(async (i) => {
    const file = path.join(images!, i.file),
      bytes = await readFile(file),
      meta = await sharp(bytes).metadata();
    if (
      meta.format !== "png" ||
      !meta.width ||
      !meta.height ||
      (meta.pages && meta.pages !== 1)
    )
      throw Error("PNG_INVALID");
    if (i.slot === "character.nameArt") {
      const { data, info } = await sharp(bytes)
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true });
      let transparent = 0,
        opaque = 0;
      for (let n = 3; n < data.length; n += info.channels) {
        if (data[n] === 0) transparent++;
        if (data[n]! > 128) opaque++;
      }
      if (
        !meta.hasAlpha ||
        transparent < info.width * info.height * 0.15 ||
        opaque < info.width * info.height * 0.02
      )
        throw Error("NAME_ALPHA_INVALID");
    }
    const resource = privateTestResourceV3Schema.parse({
      ...oldName,
      id: i.id,
      path: `assets/${i.id}.png`,
      sha256: sha(bytes),
      bytes: bytes.length,
      width: meta.width,
      height: meta.height,
      source: {
        kind: "ai-generated-candidate",
        attribution: i.text,
        evidence: "作者要求按原型还原；本轮在线imagegen编辑；仅本机候选",
      },
    });
    return { ...i, file, resource };
  }),
);
const name = staged[0]!.resource,
  border = staged[1]!.resource;
const ref = (r: typeof oldName) => ({
  productId: r.productId,
  id: r.id,
  version: r.version,
});
role.nameArt = ref(name);
b.slots.neutral.reportBorder = ref(border);
b.resources = b.resources.map((r) => (r.id === oldName.id ? name : r));
b.resources.push(border);
b.resourceVersion = "1.5.0";
for (const [id, l] of Object.entries(b.layouts)) {
  l.resourceRefs = l.resourceRefs.map((r) =>
    r.id === oldName.id ? ref(name) : r,
  );
  if (id === "report" || id === "poster") l.resourceRefs.push(ref(border));
}
b.visualPresentation.resourceDescriptions =
  b.visualPresentation.resourceDescriptions.map((d) =>
    d.resourceRef.id === oldName.id
      ? { ...d, resourceRef: ref(name), alt: "李清照墨色书法姓名候选" }
      : d,
  );
b.visualPresentation.resourceDescriptions.push({
  resourceRef: ref(border),
  alt: "共用无字山水纸景背景候选",
});
const checked = quizPackContentV3Schema.parse(content);
const prepared = prepareContentV3(checked);
if (!prepared.ok) throw Error(JSON.stringify(prepared));
const restored = structuredClone(checked);
restored.bindings.resourceVersion = old.bindings.resourceVersion;
restored.bindings.resources = old.bindings.resources;
restored.bindings.slots.neutral.reportBorder = null;
for (const c of restored.bindings.slots.characters)
  if (c.nameArt.id === name.id) c.nameArt = ref(oldName);
for (const l of Object.values(restored.bindings.layouts))
  l.resourceRefs = l.resourceRefs
    .filter((r) => r.id !== border.id)
    .map((r) => (r.id === name.id ? ref(oldName) : r));
restored.bindings.visualPresentation.resourceDescriptions =
  old.bindings.visualPresentation.resourceDescriptions;
if (canonicalP1Json(restored) !== canonicalP1Json(old))
  throw Error("NON_ART_CHANGE");
const runtime = await read(path.join(source!, "runtime-inputs.json"));
runtime.font = Object.fromEntries(
  Object.keys(runtime.font).map((key) => [
    key,
    serifV8[key as keyof typeof serifV8],
  ]),
);
const fact = (r: typeof oldName) => ({
  resourceRef: ref(r),
  sha256: r.sha256,
  bytes: r.bytes,
  width: r.width,
  height: r.height,
  mediaType: r.mediaType,
  purpose: r.purpose,
  approval: r.approval,
});
let changed = 0;
for (const bind of runtime.resources)
  if (bind.asset.resourceRef.id === oldName.id) {
    if (bind.slot !== "character.nameArt")
      throw Error("UNEXPECTED_NAME_BINDING");
    bind.asset = fact(name);
    changed++;
  }
if (changed !== 1) throw Error("ONE_NAME_BINDING_REQUIRED");
runtime.resources.push({
  slot: "reportBorder",
  layer: "clean",
  asset: fact(border),
});
const fixture = {
  schemaVersion: "qianzai.local-export-parity-fixture.v1",
  scope: "local-demo-only-no-quizpack-or-database-admission",
  canonicalContentSha256: sha(canonicalP1Json(checked)),
  baseContentSha256: previous.canonicalContentSha256,
  resources: staged.map(({ resource: r }) => ({
    productId: r.productId,
    id: r.id,
    version: r.version,
    sha256: r.sha256,
    bytes: r.bytes,
    width: r.width,
    height: r.height,
    mediaType: r.mediaType,
    purpose: r.purpose,
  })),
};
await mkdir(out!, { mode: 0o700 });
await mkdir(path.join(out!, "assets"), { mode: 0o700 });
for (const r of old.bindings.resources) {
  const bytes = await readFile(path.join(source!, r.path));
  if (bytes.length !== r.bytes || sha(bytes) !== r.sha256)
    throw Error("BASE_ASSET_CHANGED");
  if (r.id !== oldName.id)
    await copyFile(
      path.join(source!, r.path),
      path.join(out!, r.path),
      constants.COPYFILE_EXCL,
    );
}
for (const x of staged)
  await copyFile(
    x.file,
    path.join(out!, x.resource.path),
    constants.COPYFILE_EXCL,
  );
const proof = {
  scope: fixture.scope,
  baseContentSha256: previous.canonicalContentSha256,
  canonicalContentSha256: fixture.canonicalContentSha256,
  unchangedRestoredContentSha256: sha(canonicalP1Json(restored)),
  changedOnly: [
    "li-qingzhao nameArt resource and matching refs",
    "neutral.reportBorder resource and report/poster refs",
    "resourceVersion",
  ],
  unchangedResources: old.bindings.resources.length - 1,
};
for (const [file, value] of [
  ["content.json", checked],
  ["fixture.json", fixture],
  ["runtime-inputs.json", runtime],
  ["semantic-proof.json", proof],
] as const)
  await writeFile(
    path.join(out!, file),
    JSON.stringify(value, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
console.log(JSON.stringify(fixture));
