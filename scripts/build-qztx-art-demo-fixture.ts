/** Local visual fixture only. This does not build/import a QuizPack or grant a DB source. */
import { readFile, writeFile, mkdir, copyFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { canonicalP1Json } from "../src/features/quizpack/v1/canonical";
import { quizPackContentV3Schema } from "../src/features/quizpack/content/v3";
import { prepareContentV3 } from "../src/features/quizpack/content/v3-scoring-adapter";
const [source, art, names, out] = process.argv.slice(2);
if (![source, art, names, out].every((p) => p && path.isAbsolute(p)))
  throw Error("EXPLICIT_PATHS_REQUIRED");
if (!out!.startsWith(path.join(process.cwd(), ".cache/")))
  throw Error("PRIVATE_OUTPUT_REQUIRED");
const sha = (x: string | Uint8Array) =>
  createHash("sha256").update(x).digest("hex");
const read = async (p: string) => JSON.parse(await readFile(p, "utf8"));
const old = quizPackContentV3Schema.parse(
  await read(path.join(source!, "content.json")),
);
if (
  sha(canonicalP1Json(old)) !==
  "e81fad61f2258e44ba58fe84fda12fedccfb0d7517e97546010f4fa35cfbe767"
)
  throw Error("BASE_CHANGED");
const content = structuredClone(old),
  b = content.bindings;
const runtime = await read(
  "src/features/theme/qianzai-tongxin/runtime-inputs.json",
);
const resources = new Map(old.bindings.resources.map((r) => [r.id, r]));
const added: typeof b.resources = [];
const additions: Array<{
  file: string;
  id: string;
  slot: string;
  resultId?: string;
}> = [];
const ref = (id: string) => ({
  productId: "qianzai-tongxin",
  id,
  version: "1.0.0",
});
for (let i = 0; i < 3; i++) {
  const act = b.slots.neutral.acts[i]!;
  act.navigation = act.background;
  act.background = ref(`qztx-art-act-${i + 1}`);
  additions.push({
    file: path.join(art!, `act-${i + 1}-background.png`),
    id: act.background.id,
    slot: `acts.${i}.background`,
  });
  for (const [slot, file, id] of [
    ["questionPaper", "question-paper.png", "qztx-art-question-paper"],
    ["optionIdle", "option-idle.png", "qztx-art-option-idle"],
    ["optionSelected", "option-selected.png", "qztx-art-option-selected"],
  ] as const) {
    act[slot] = ref(id);
    if (i === 0) additions.push({ file: path.join(art!, file), id, slot });
  }
  b.visualPresentation.sections[i]!.sceneRef = act.background;
}
for (const role of b.slots.characters) {
  delete role.revealComposite;
  const id = `qztx-art-${role.resultRef.id}-name`;
  role.nameArt = ref(id);
  additions.push({
    file: path.join(names!, `${role.resultRef.id}.png`),
    id,
    slot: "character.nameArt",
    resultId: role.resultRef.id,
  });
}
// Optional clean full-frame Li Bai source is staged by the main coordinator after visual inspection.
try {
  await readFile(path.join(art!, "li-bai-reveal.png"));
  const role = b.slots.characters.find((r) => r.resultRef.id === "li-bai")!;
  role.reveal = ref("qztx-art-li-bai-reveal");
  additions.push({
    file: path.join(art!, "li-bai-reveal.png"),
    id: role.reveal.id,
    slot: "character.reveal",
    resultId: "li-bai",
  });
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
await mkdir(path.join(out!, "assets"), { recursive: true, mode: 0o700 });
for (const a of additions) {
  const bytes = await readFile(a.file),
    m = await sharp(bytes).metadata();
  if (m.format !== "png" || !m.width || !m.height || (m.pages && m.pages !== 1))
    throw Error("IMAGE_FORMAT");
  const r = {
    ...structuredClone(old.bindings.resources[0]!),
    ...ref(a.id),
    path: `assets/${a.id}.png`,
    purpose:
      a.slot === "character.reveal"
        ? ("portrait" as const)
        : ("decoration" as const),
    mediaType: "image/png" as const,
    width: m.width,
    height: m.height,
    bytes: bytes.length,
    sha256: sha(bytes),
    source: {
      kind:
        a.slot === "character.nameArt"
          ? ("program-font-sample" as const)
          : ("ai-generated-candidate" as const),
      attribution: "本轮作者授权的本地视觉校准候选",
      evidence:
        a.slot === "character.nameArt"
          ? "马善政固定字体轮廓生成透明姓名图；不是原确认美术字"
          : "built-in imagegen 对既有原型场景/皮肤编辑；不是新的作者视觉验收",
    },
  };
  added.push(r);
  resources.set(r.id, r);
  await copyFile(a.file, path.join(out!, r.path));
}
const n = b.slots.neutral,
  characters = b.slots.characters;
const acts = n.acts.flatMap((a) => [
  a.background,
  a.navigation!,
  a.questionPaper,
  a.optionIdle,
  a.optionSelected,
]);
const paper = [n.reportPaper, ...(n.reportBorder ? [n.reportBorder] : [])],
  seal = n.seal ? [n.seal] : [];
const groups = {
  cover: [n.cover, ...(n.preferenceScene ? [n.preferenceScene] : []), ...seal],
  question: acts,
  resume: [n.cover, ...(n.preferenceScene ? [n.preferenceScene] : []), ...acts],
  result: [...characters.flatMap((c) => [c.reveal, c.nameArt]), ...seal],
  report: [...paper, ...characters.flatMap((c) => [c.report, c.nameArt])],
  poster: [
    ...paper,
    ...seal,
    ...characters.flatMap((c) => [c.poster, c.nameArt]),
  ],
};
for (const k of Object.keys(groups) as (keyof typeof groups)[])
  b.layouts[k].resourceRefs = [
    ...new Map(groups[k].map((r) => [r.id, r])).values(),
  ];
const used = new Set(
  Object.values(groups)
    .flat()
    .map((r) => r.id),
);
b.resources = [...resources.values()].filter((r) => used.has(r.id));
b.visualPresentation.resourceDescriptions = b.resources.map((r) => ({
  resourceRef: ref(r.id),
  alt: `千载同心本地视觉候选 ${r.id}`,
}));
b.resourceVersion = "1.1.0";
b.visualVersion = "1.1.0";
const checked = quizPackContentV3Schema.parse(content);
const prepared = prepareContentV3(checked);
if (!prepared.ok) throw Error(JSON.stringify(prepared));
// Explicit semantic comparison; never drop all bindings to claim equivalence.
for (const key of ["core"] as const)
  if (canonicalP1Json(old[key]) !== canonicalP1Json(checked[key]))
    throw Error("CORE_CHANGED");
for (const key of [
  "reportTemplates",
  "reportVersion",
  "resultReports",
  "witnesses",
  "componentVersion",
  "kind",
  "schemaVersion",
  "privateTestUse",
] as const)
  if (
    canonicalP1Json(old.bindings[key]) !==
    canonicalP1Json(checked.bindings[key])
  )
    throw Error(`SEMANTICS_CHANGED:${key}`);
for (const r of b.resources)
  if (!added.some((a) => a.id === r.id))
    await copyFile(
      path.join(art!, "../source", path.basename(r.path)),
      path.join(out!, r.path),
    );
const facts = (r: (typeof b.resources)[number]) => ({
  id: r.id,
  productId: r.productId,
  version: r.version,
  sha256: r.sha256,
  bytes: r.bytes,
  width: r.width,
  height: r.height,
  mediaType: r.mediaType,
  purpose: r.purpose,
});
const local = {
  schemaVersion: "qianzai.local-art-fixture.v1",
  scope: "local-demo-only-no-quizpack-or-database-admission",
  canonicalContentSha256: sha(canonicalP1Json(checked)),
  baseContentSha256: sha(canonicalP1Json(old)),
  resources: added.map(facts),
};
runtime.resources = [];
const add = (slot: string, rid: string, layer: string) => {
  const r = resources.get(rid)!;
  runtime.resources.push({
    slot,
    layer,
    asset: {
      resourceRef: ref(rid),
      mediaType: r.mediaType,
      bytes: r.bytes,
      sha256: r.sha256,
      width: r.width,
      height: r.height,
      purpose: r.purpose,
      approval: r.approval,
    },
  });
};
add("cover", n.cover.id, "prototype-scene-base");
add("preferenceScene", n.preferenceScene!.id, "prototype-scene-base");
n.acts.forEach((a, i) => {
  add(`acts.${i}.background`, a.background.id, "prototype-scene-base");
  add(`acts.${i}.navigation`, a.navigation!.id, "prototype-scene-base");
  for (const k of ["questionPaper", "optionIdle", "optionSelected"] as const)
    add(`acts.${i}.${k}`, a[k].id, "clean");
});
add("reportPaper", n.reportPaper.id, "clean");
for (const c of characters)
  for (const k of ["reveal", "report", "poster", "nameArt"] as const)
    add(`character.${k}`, c[k].id, "clean");
for (const [f, v] of [
  ["content.json", checked],
  ["fixture.json", local],
  ["runtime-inputs.json", runtime],
  [
    "semantic-proof.json",
    {
      unchangedCoreSha256: sha(canonicalP1Json(old.core)),
      unchangedReportTemplatesSha256: sha(
        canonicalP1Json(old.bindings.reportTemplates),
      ),
      unchangedResultReportsSha256: sha(
        canonicalP1Json(old.bindings.resultReports),
      ),
      unchangedWitnessesSha256: sha(canonicalP1Json(old.bindings.witnesses)),
      changedBindings: [
        "resources",
        "slots",
        "layouts.resourceRefs",
        "visualPresentation.sections.sceneRef",
        "visualPresentation.resourceDescriptions",
        "resourceVersion",
        "visualVersion",
      ],
      scope: local.scope,
    },
  ],
] as const)
  await writeFile(path.join(out!, f), JSON.stringify(v, null, 2) + "\n", {
    mode: 0o600,
  });
console.log(JSON.stringify(local));
