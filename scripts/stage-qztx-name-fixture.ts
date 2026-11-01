/** Stage five immutable name assets for a local visual demo. No QuizPack or DB admission. */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import path from "node:path";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { canonicalP1Json } from "../src/features/quizpack/v1/canonical";
import {
  quizPackContentV3Schema,
  privateTestResourceV3Schema,
} from "../src/features/quizpack/content/v3";
import { prepareContentV3 } from "../src/features/quizpack/content/v3-scoring-adapter";
import previous from "../src/features/quizpack/content/qianzai-local-art-fixture.json";
const [source, names, out] = process.argv.slice(2);
if (
  ![source, names, out].every((v) => v && path.isAbsolute(v)) ||
  !path.resolve(out!).startsWith(path.join(process.cwd(), ".cache/"))
)
  throw Error("EXPLICIT_PRIVATE_PATHS_REQUIRED");
const sha = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const read = async (p: string) => JSON.parse(await readFile(p, "utf8"));
const old = quizPackContentV3Schema.parse(
  await read(path.join(source!, "content.json")),
);
if (sha(canonicalP1Json(old)) !== previous.canonicalContentSha256)
  throw Error("BASE_SOURCE_CHANGED");
const content = structuredClone(old),
  b = content.bindings;
const replacements = new Map<
  string,
  ReturnType<typeof privateTestResourceV3Schema.parse>
>();
// Refuse an existing output before copying any bytes.
await mkdir(out!, { mode: 0o700 });
await mkdir(path.join(out!, "assets"), { mode: 0o700 });
for (const role of b.slots.characters) {
  const existing = b.resources.find((r) => r.id === role.nameArt.id)!;
  const file = path.join(names!, role.resultRef.id + ".png"),
    bytes = await readFile(file),
    meta = await sharp(bytes).metadata();
  if (
    meta.format !== "png" ||
    !meta.width ||
    !meta.height ||
    !meta.hasAlpha ||
    (meta.pages && meta.pages !== 1)
  )
    throw Error("NAME_ART_INVALID");
  const id = `qztx-anchor-${role.resultRef.id}-name`;
  const r = privateTestResourceV3Schema.parse({
    ...existing,
    id,
    path: `assets/${id}.png`,
    sha256: sha(bytes),
    bytes: bytes.length,
    width: meta.width,
    height: meta.height,
    source: {
      kind: "program-font-sample",
      attribution: "本轮固定字形尺度姓名PNG",
      evidence: "同一书法字体、同一单字尺度、固定透明画布；候选待作者体验",
    },
  });
  replacements.set(existing.id, r);
  role.nameArt = { productId: r.productId, id: r.id, version: r.version };
  await copyFile(file, path.join(out!, r.path), constants.COPYFILE_EXCL);
}
const replaceRef = (r: { productId: string; id: string; version: string }) => {
  const next = replacements.get(r.id);
  return next
    ? { productId: next.productId, id: next.id, version: next.version }
    : r;
};
b.resources = b.resources.map((r) => replacements.get(r.id) ?? r);
for (const layout of Object.values(b.layouts))
  layout.resourceRefs = layout.resourceRefs.map(replaceRef);
b.visualPresentation.resourceDescriptions =
  b.visualPresentation.resourceDescriptions.map((d) => ({
    ...d,
    resourceRef: replaceRef(d.resourceRef),
  }));
b.resourceVersion = "1.2.0";
const checked = quizPackContentV3Schema.parse(content),
  prepared = prepareContentV3(checked);
if (!prepared.ok) throw Error(JSON.stringify(prepared));
const restored = structuredClone(checked),
  reverse = new Map([...replacements].map(([id, r]) => [r.id, id]));
restored.bindings.resourceVersion = old.bindings.resourceVersion;
restored.bindings.resources = old.bindings.resources;
for (const role of restored.bindings.slots.characters) {
  const id = reverse.get(role.nameArt.id);
  if (id) role.nameArt.id = id;
}
for (const layout of Object.values(restored.bindings.layouts))
  for (const r of layout.resourceRefs) {
    const id = reverse.get(r.id);
    if (id) r.id = id;
  }
for (const d of restored.bindings.visualPresentation.resourceDescriptions) {
  const id = reverse.get(d.resourceRef.id);
  if (id) d.resourceRef.id = id;
}
if (canonicalP1Json(restored) !== canonicalP1Json(old))
  throw Error("NON_NAME_CHANGE");
for (const r of b.resources)
  if (!reverse.has(r.id)) {
    const bytes = await readFile(path.join(source!, r.path));
    if (bytes.length !== r.bytes || sha(bytes) !== r.sha256)
      throw Error("BASE_ASSET_CHANGED");
    await copyFile(
      path.join(source!, r.path),
      path.join(out!, r.path),
      constants.COPYFILE_EXCL,
    );
  }
const runtime = await read(path.join(source!, "runtime-inputs.json"));
for (const bind of runtime.resources) {
  if (bind.slot !== "character.nameArt") continue;
  const r = replacements.get(bind.asset.resourceRef.id);
  if (!r) throw Error("NAME_BINDING_MISSING");
  const {
    productId,
    id,
    version,
    sha256,
    bytes,
    width,
    height,
    mediaType,
    purpose,
    approval,
  } = r;
  bind.asset = {
    resourceRef: { productId, id, version },
    sha256,
    bytes,
    width,
    height,
    mediaType,
    purpose,
    approval,
  };
}
const fixture = {
  schemaVersion: "qianzai.local-name-fixture.v1",
  scope: "local-demo-only-no-quizpack-or-database-admission",
  canonicalContentSha256: sha(canonicalP1Json(checked)),
  baseContentSha256: previous.canonicalContentSha256,
  resources: [...replacements.values()].map(
    ({
      id,
      productId,
      version,
      sha256,
      bytes,
      width,
      height,
      mediaType,
      purpose,
    }) => ({
      id,
      productId,
      version,
      sha256,
      bytes,
      width,
      height,
      mediaType,
      purpose,
    }),
  ),
};
for (const [f, v] of [
  ["content.json", checked],
  ["fixture.json", fixture],
  ["runtime-inputs.json", runtime],
  [
    "semantic-proof.json",
    {
      scope: fixture.scope,
      baseContentSha256: previous.canonicalContentSha256,
      canonicalContentSha256: fixture.canonicalContentSha256,
      changedOnly: [
        "five name resource declarations",
        "five character.nameArt refs",
        "matching layout/description refs",
        "resourceVersion",
      ],
      unchangedRestoredContentSha256: sha(canonicalP1Json(restored)),
    },
  ],
] as const)
  await writeFile(path.join(out!, f), JSON.stringify(v, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
console.log(JSON.stringify(fixture));
