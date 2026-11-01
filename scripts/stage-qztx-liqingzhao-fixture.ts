/** One local Li Qingzhao visual sample. No QuizPack import or DB source admission. */
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
import previous from "../src/features/quizpack/content/qianzai-local-centered-name-fixture.json";

const [source, images, out] = process.argv.slice(2);
if (
  process.argv.length !== 5 ||
  ![source, images, out].every((v) => v && path.isAbsolute(v)) ||
  !path.resolve(out!).startsWith(path.join(process.cwd(), ".cache/"))
)
  throw Error("EXPLICIT_PRIVATE_PATHS_REQUIRED");
if ((await realpath(path.dirname(out!))) !== path.dirname(out!))
  throw Error("OUTPUT_SYMLINK_REJECTED");
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
const role = b.slots.characters.find((r) => r.resultRef.id === "li-qingzhao")!;
const oldId = role.reveal.id;
if (role.report.id !== oldId || role.poster.id !== oldId)
  throw Error("BASE_PORTRAIT_BINDINGS_CHANGED");
const existing = b.resources.find((r) => r.id === oldId)!;
const slots = ["reveal", "report", "poster"] as const;
const staged = await Promise.all(
  slots.map(async (slot) => {
    const file = path.join(
      images!,
      slot === "reveal" ? "reveal-b.png" : `${slot}.png`,
    );
    const bytes = await readFile(file),
      meta = await sharp(bytes).metadata();
    if (
      meta.format !== "png" ||
      !meta.width ||
      !meta.height ||
      (meta.pages && meta.pages !== 1)
    )
      throw Error("SAMPLE_PNG_INVALID");
    const id = `qztx-online-li-qingzhao-${slot}`;
    const resource = privateTestResourceV3Schema.parse({
      ...existing,
      id,
      path: `assets/${id}.png`,
      sha256: sha(bytes),
      bytes: bytes.length,
      width: meta.width,
      height: meta.height,
      source: {
        kind: "ai-generated-candidate",
        attribution: "本轮作者授权的线上生图李清照样板",
        evidence:
          slot === "reveal"
            ? "作者授权线上生图；主控选择B母图；资源与正文仍为候选"
            : `作者授权线上生图；李清照独立${slot === "report" ? "报告方图" : "海报图"}候选`,
      },
    });
    return { slot, file, resource };
  }),
);
const ref = (r: typeof existing) => ({
  productId: r.productId,
  id: r.id,
  version: r.version,
});
const next = Object.fromEntries(staged.map((s) => [s.slot, s.resource]));
for (const slot of slots) role[slot] = ref(next[slot]!);
b.resources = b.resources.flatMap((r) =>
  r.id === oldId ? staged.map((s) => s.resource) : [r],
);
const layoutSlot = {
  result: "reveal",
  report: "report",
  poster: "poster",
} as const;
for (const [id, layout] of Object.entries(b.layouts))
  layout.resourceRefs = layout.resourceRefs.map((r) => {
    if (r.id !== oldId) return r;
    const slot = layoutSlot[id as keyof typeof layoutSlot];
    if (!slot) throw Error("UNEXPECTED_PORTRAIT_LAYOUT");
    return ref(next[slot]!);
  });
b.visualPresentation.resourceDescriptions =
  b.visualPresentation.resourceDescriptions.flatMap((d) =>
    d.resourceRef.id === oldId
      ? staged.map((s) => ({
          ...d,
          resourceRef: ref(s.resource),
          alt: `李清照线上${s.slot}图候选`,
        }))
      : [d],
  );
b.resourceVersion = "1.4.0";
const checked = quizPackContentV3Schema.parse(content),
  prepared = prepareContentV3(checked);
if (!prepared.ok) throw Error(JSON.stringify(prepared));
// Undo precisely these three visual substitutions. Any other content change fails.
const restored = structuredClone(checked),
  newIds = new Set(staged.map((s) => s.resource.id));
restored.bindings.resourceVersion = old.bindings.resourceVersion;
restored.bindings.resources = old.bindings.resources;
restored.bindings.visualPresentation.resourceDescriptions =
  old.bindings.visualPresentation.resourceDescriptions;
for (const r of restored.bindings.slots.characters)
  for (const slot of slots) if (newIds.has(r[slot].id)) r[slot] = ref(existing);
for (const layout of Object.values(restored.bindings.layouts))
  layout.resourceRefs = layout.resourceRefs.map((r) =>
    newIds.has(r.id) ? ref(existing) : r,
  );
if (canonicalP1Json(restored) !== canonicalP1Json(old))
  throw Error("NON_SAMPLE_CONTENT_CHANGE");
const runtime = await read(path.join(source!, "runtime-inputs.json"));
let changedBindings = 0;
for (const bind of runtime.resources) {
  if (bind.asset.resourceRef.id !== oldId) continue;
  const slot = slots.find((s) => bind.slot === `character.${s}`);
  if (!slot) throw Error("UNEXPECTED_PORTRAIT_RUNTIME_BINDING");
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
  } = next[slot]!;
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
  changedBindings++;
}
if (changedBindings !== 3) throw Error("THREE_RUNTIME_BINDINGS_REQUIRED");
const fixture = {
  schemaVersion: "qianzai.local-liqingzhao-online-fixture.v1",
  scope: "local-demo-only-no-quizpack-or-database-admission",
  canonicalContentSha256: sha(canonicalP1Json(checked)),
  baseContentSha256: previous.canonicalContentSha256,
  resources: staged.map(
    ({
      resource: {
        productId,
        id,
        version,
        sha256,
        bytes,
        width,
        height,
        mediaType,
        purpose,
      },
    }) => ({
      productId,
      id,
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
// All inputs are ready; refuse an existing output before writing any material.
await mkdir(out!, { mode: 0o700 });
await mkdir(path.join(out!, "assets"), { mode: 0o700 });
for (const r of old.bindings.resources) {
  const bytes = await readFile(path.join(source!, r.path));
  if (bytes.length !== r.bytes || sha(bytes) !== r.sha256)
    throw Error("BASE_ASSET_CHANGED");
  if (r.id !== oldId)
    await copyFile(
      path.join(source!, r.path),
      path.join(out!, r.path),
      constants.COPYFILE_EXCL,
    );
}
for (const s of staged)
  await copyFile(
    s.file,
    path.join(out!, s.resource.path),
    constants.COPYFILE_EXCL,
  );
for (const [file, value] of [
  ["content.json", checked],
  ["runtime-inputs.json", runtime],
  ["fixture.json", fixture],
  [
    "semantic-proof.json",
    {
      scope: fixture.scope,
      baseContentSha256: previous.canonicalContentSha256,
      canonicalContentSha256: fixture.canonicalContentSha256,
      unchangedRestoredContentSha256: sha(canonicalP1Json(restored)),
      changedOnly: [
        "li-qingzhao reveal/report/poster resources and refs",
        "matching layout/description/runtime refs",
        "resourceVersion",
      ],
      unchangedAssetCount: old.bindings.resources.length - 1,
    },
  ],
] as const)
  await writeFile(
    path.join(out!, file),
    JSON.stringify(value, null, 2) + "\n",
    { flag: "wx", mode: 0o600 },
  );
console.log(JSON.stringify(fixture));
