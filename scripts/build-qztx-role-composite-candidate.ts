/** Private local preparation. Run with --conditions=react-server and the registered
 * 3293 test runtime. No PNG bytes or private source files are committed. */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { createDatabase } from "../src/lib/db/client";
import { loadRuntimeConfig } from "../src/lib/db/runtime";
import { issuePrivateTestCapability } from "../src/features/quizpack/private-test-scope";
import { buildPrivateTestQuizPack } from "../src/features/quizpack/private-test-build";
import { readRestrictedZip } from "../src/features/quizpack/v1/zip";
import { canonicalP1Json } from "../src/features/quizpack/v1/canonical";
import { quizPackContentV3Schema } from "../src/features/quizpack/content/v3";
import { prepareContentV3 } from "../src/features/quizpack/content/v3-scoring-adapter";
import { verifyPreparedContentWitnessesV3 } from "../src/features/quizpack/content/v3-witnesses";
import { baselineDescriptorV2Schema } from "../src/features/product/internal-versions/baseline-schema-v2";
import oldRegistration from "../src/features/quizpack/content/private-test-registration.json";
import currentRegistration from "../src/features/quizpack/content/private-test-registration-rebuild.json";
const root = process.cwd(),
  source = path.resolve(process.argv[2] ?? ""),
  out = path.resolve(process.argv[3] ?? "");
if (
  !source.endsWith("/.cache/qztx-full-flow/candidate-02") ||
  !out.startsWith(path.join(root, ".cache/qztx-prototype-rebuild/candidate-"))
)
  throw Error("PRIVATE_SOURCE_PATH_REQUIRED");
const sha = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const read = async (file: string) => JSON.parse(await readFile(file, "utf8"));
const old = await read(path.join(source, "content.json"));
if (sha(canonicalP1Json(old)) !== oldRegistration.canonicalContentSha256)
  throw Error("OLD_REGISTERED_CONTENT_MISMATCH");
const content = structuredClone(old);
const oldReport = await read(path.join(source, "build-report.json")),
  oldPack = await readFile(path.join(source, "pack.zip"));
if (sha(oldPack) !== oldReport.archiveSha256)
  throw Error("OLD_REGISTERED_ARCHIVE_MISMATCH");
const zip = await readRestrictedZip(
  (async function* () {
    yield oldPack;
  })(),
  { targetProductId: "qianzai-tongxin" },
);
if (!zip.ok) throw Error("OLD_ARCHIVE_REJECTED");
await mkdir(out, { mode: 0o700, recursive: true });
const assets: { path: string; bytes: Buffer }[] = [];
for (const r of content.bindings.resources) {
  const bytes = zip.value.files.get(r.path);
  if (!bytes || bytes.length !== r.bytes || sha(bytes) !== r.sha256)
    throw Error("OLD_ASSET_MISMATCH");
  assets.push({ path: r.path, bytes });
}
content.bindings.privateTestUse = {
  schemaVersion: "quizforge.private-test-use.v1",
  instanceId: currentRegistration.instanceId,
  authorizationId: currentRegistration.authorizationId,
  contentStatus: "candidate",
  resourceStatus: "reference-or-candidate",
};
const liBai = content.bindings.slots.characters.find(
  (r: { resultRef: { id: string } }) => r.resultRef.id === "li-bai",
);
if (!liBai || liBai.revealComposite)
  throw Error("ROLE_COMPOSITE_ALREADY_PRESENT_OR_MISSING");
const added = [];
for (const [part, filename, expected] of [
  [
    "before",
    "revealBefore.png",
    "778e1ae1817fc53840d4478cbcd0e6074daba6e3febe7456801066a4a396db38",
  ],
  [
    "full",
    "revealFull.png",
    "08ed543b80e55e4a5c3d02819270cf87c216bdc370e78465aba6c9b48ad9c425",
  ],
] as const) {
  const bytes = await readFile(
      path.join(root, ".cache/qztx-prototype-rebuild", filename),
    ),
    m = await sharp(bytes).metadata();
  if (
    sha(bytes) !== expected ||
    m.format !== "png" ||
    m.width !== 780 ||
    m.height !== 1688 ||
    (m.pages && m.pages !== 1)
  )
    throw Error("ROLE_COMPOSITE_BYTES_MISMATCH");
  const id = `qztx-rebuild-li-bai-reveal-${part}`,
    ref = { productId: "qianzai-tongxin", id, version: "1.0.0" };
  const r = {
    ...ref,
    path: `assets/${id}.png`,
    mediaType: "image/png",
    bytes: bytes.length,
    sha256: expected,
    width: 780,
    height: 1688,
    purpose: "decoration",
    source: {
      kind: "user-supplied-reference",
      attribution: "作者提供原型的固定李白揭晓合成层；含角色书法，不是净人物图",
      evidence: `保存分享原型V2的reveal${part === "before" ? "Before" : "Full"}原始字节；本批私有测试`,
    },
    license: {
      scope: "private-test-only",
      commercialUse: false,
      redistribution: false,
      evidence: "仅本机隔离测试；不授予商业使用或对外再分发",
    },
    approval: "private-test-only",
  };
  content.bindings.resources.push(r);
  assets.push({ path: r.path, bytes });
  added.push({ part, ref, r });
  content.bindings.visualPresentation.resourceDescriptions.push({
    resourceRef: ref,
    alt: `李白固定角色揭晓${part === "before" ? "前" : "完整"}合成层；仅本批私有测试`,
  });
  content.bindings.layouts.result.resourceRefs.push(ref);
}
liBai.revealComposite = {
  kind: "role-composite.v1",
  before: added[0]!.ref,
  full: added[1]!.ref,
};
for (const field of ["core"] as const)
  if (canonicalP1Json(content[field]) !== canonicalP1Json(old[field]))
    throw Error("SCORING_OR_QUESTIONS_CHANGED");
for (const field of ["reportTemplates", "resultReports", "witnesses"] as const)
  if (
    canonicalP1Json(content.bindings[field]) !==
    canonicalP1Json(old.bindings[field])
  )
    throw Error("REPORT_OR_WITNESSES_CHANGED");
const checked = quizPackContentV3Schema.parse(content),
  prepared = prepareContentV3(checked);
if (!prepared.ok) throw Error("CONTENT_PREPARE_REJECTED");
const witnesses = verifyPreparedContentWitnessesV3(prepared.value);
if (!witnesses.ok) throw Error("WITNESSES_REJECTED");
const config = await loadRuntimeConfig();
if (
  config.instanceId !== currentRegistration.instanceId ||
  config.origin !== currentRegistration.origin ||
  config.database.port !== 55493 ||
  config.purpose !== "test"
)
  throw Error("NEW_TEST_INSTANCE_REQUIRED");
const db = await createDatabase(config);
let built;
try {
  const cap = await issuePrivateTestCapability(db);
  built = await buildPrivateTestQuizPack(
    {
      packId: "qztx-prototype-private-candidate",
      packVersion: "1.0.0",
      content: checked,
      assets,
    },
    { targetProductId: "qianzai-tongxin" },
    cap,
  );
} finally {
  await db.close();
}
if (!built.ok) {
  await writeFile(
    path.join(out, "build-failure.json"),
    JSON.stringify(built, null, 2),
    { flag: "wx", mode: 0o600 },
  );
  throw Error("PRIVATE_BUILD_REJECTED");
}
const contentText = canonicalP1Json(checked),
  resources = checked.bindings.resources;
const assetSet = {
  schemaVersion: "quizpack-candidate-asset-set.v1",
  productId: "qianzai-tongxin",
  resources: resources
    .map((r) => ({
      productId: r.productId,
      resourceId: r.id,
      resourceVersion: r.version,
      blobSha256: r.sha256,
      declarationSha256: sha(canonicalP1Json(r)),
    }))
    .sort((a, b) => a.resourceId.localeCompare(b.resourceId, "en")),
};
const definitionSha = sha(
  canonicalP1Json({
    contentSha: sha(contentText),
    assetSet,
    witnesses: witnesses.value.evidence,
  }),
);
const registration = {
  ...currentRegistration,
  canonicalContentSha256: sha(contentText),
  assetSetSha256: sha(canonicalP1Json(assetSet)),
  canonicalManifestSha256: built.value.report.manifestSha256,
  resources: resources.map(
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
const baseline = baselineDescriptorV2Schema.parse({
  schemaVersion: "quizforge.baseline-registry-entry.v2",
  contentSchemaVersion: "quizpack-content.v3",
  kind: "baseline",
  id: "qztx-private-rebuild-20261031",
  version: "1.0.0",
  productId: "qianzai-tongxin",
  purpose: "internal-test",
  allowedInstancePurposes: ["test"],
  canonicalContentSha256: registration.canonicalContentSha256,
  assetSetSha256: registration.assetSetSha256,
  canonicalManifestSha256: registration.canonicalManifestSha256,
  logicHash: witnesses.value.evidence.logicHash,
  approval: {
    kind: "private-test-only",
    authorizationId: registration.authorizationId,
    instanceId: registration.instanceId,
    evidenceSha256: definitionSha,
    scope: "candidate-content-reference-art-local-test-only",
  },
  sourceEvidence: {
    kind: "private-test-definition",
    definitionSha256: definitionSha,
    qualification:
      "authored-candidate-private-reference-assets-not-final-approval",
  },
  engine: checked.core.scoringDefinition.engine,
  components: Object.fromEntries(
    Object.entries(checked.bindings.layouts).map(([k, l]) => [k, l.component]),
  ),
  slots: checked.bindings.slots,
  resourceEdges: resources.map((r) => ({
    resourceId: r.id,
    version: r.version,
    purpose: r.purpose,
    sha256: r.sha256,
    bytes: r.bytes,
    mediaType: r.mediaType,
    width: r.width,
    height: r.height,
    reviewFile:
      r.id +
      "." +
      (r.mediaType === "image/jpeg"
        ? "jpg"
        : r.mediaType === "image/webp"
          ? "webp"
          : "png"),
  })),
});
const runtime = await read(path.join(source, "runtime-inputs.json"));
for (const { part, r } of added) {
  const {
    path: _path,
    source: _source,
    license: _license,
    id,
    productId,
    version,
    ...facts
  } = r;
  void _path;
  void _source;
  void _license;
  runtime.resources.push({
    slot: `character.revealComposite.${part}`,
    layer: "role-composite",
    resultRef: liBai.resultRef,
    asset: { resourceRef: { productId, id, version }, ...facts },
  });
}
const proof = {
  instanceId: config.instanceId,
  origin: config.origin,
  questions: checked.core.questions.length,
  unchangedCoreSha256: sha(canonicalP1Json(checked.core)),
  unchangedReportSha256: sha(canonicalP1Json(checked.bindings.reportTemplates)),
  witnessEntries: witnesses.value.evidence.entries.length,
  resources: resources.length,
  addedDeclarations: added.map(({ r }) => ({
    id: r.id,
    sha256: sha(canonicalP1Json(r)),
  })),
  source: {
    canonicalContentSha256: registration.canonicalContentSha256,
    assetSetSha256: registration.assetSetSha256,
    canonicalManifestSha256: registration.canonicalManifestSha256,
  },
  archiveSha256: sha(built.value.archive),
};
for (const [name, value] of [
  ["content.json", contentText],
  ["pack.zip", built.value.archive],
  ["baseline.json", JSON.stringify(baseline, null, 2)],
  ["registration.json", JSON.stringify(registration, null, 2)],
  ["runtime-inputs.json", JSON.stringify(runtime, null, 2)],
  ["build-report.json", JSON.stringify(built.value.report, null, 2)],
  ["source-proof.json", JSON.stringify(proof, null, 2)],
] as const)
  await writeFile(path.join(out, name), value, { flag: "wx", mode: 0o600 });
if (
  currentRegistration.canonicalContentSha256 !== "0".repeat(64) &&
  canonicalP1Json(currentRegistration) !== canonicalP1Json(registration)
)
  throw Error("COMPILED_REGISTRATION_DRIFT");
await writeFile(
  path.join(
    root,
    "src/features/quizpack/content/private-test-registration-rebuild.json",
  ),
  JSON.stringify(registration, null, 2) + "\n",
);
await writeFile(
  path.join(
    root,
    "src/features/product/internal-versions/baselines/qztx-private-rebuild-20261031.json",
  ),
  JSON.stringify(baseline, null, 2) + "\n",
  { flag: "wx" },
);
console.log(JSON.stringify(proof));
