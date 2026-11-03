/** Stage one exact final candidate locally. This grants no source/DB admission.
 * Run once per owned test instance after the reviewed art bundle is frozen. */
import {
  readFile,
  writeFile,
  mkdir,
  realpath,
  lstat,
  copyFile,
} from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import sharp from "sharp";
import { canonicalP1Json as canonical } from "../src/features/quizpack/v1/canonical";
import { quizPackContentV3Schema } from "../src/features/quizpack/content/v3";
import { prepareContentV3 } from "../src/features/quizpack/content/v3-scoring-adapter";
import { verifyPreparedContentWitnessesV3 } from "../src/features/quizpack/content/v3-witnesses";
import { readContentMetadata } from "../src/features/quizpack/content/current";
import { baselineDescriptorV2Schema } from "../src/features/product/internal-versions/baseline-schema-v2";
import { loadManagedInstance } from "../src/lib/db/management";
import { PACK_LIMITS } from "../src/features/quizpack/v1/limits";
const hash = (s: string | Uint8Array) =>
  createHash("sha256").update(s).digest("hex");
const args = z
  .tuple([
    z.string(),
    z.string().regex(/^[a-f0-9]{64}$/),
    z.string(),
    z.enum(["demo", "e2e"]),
  ])
  .parse(process.argv.slice(2));
const [bundle, expectedManifest, base, kind] = args;
const specs = {
  demo: {
    id: "601707c7f4511e7d6fb09da3a907c8d9",
    origin: "http://127.0.0.1:63226",
  },
  e2e: {
    id: "79331f888c569d9fbf7a2a08e5f33f68",
    origin: "http://127.0.0.1:63227",
  },
} as const;
const spec = specs[kind],
  managed = await loadManagedInstance(spec.id);
assert.equal(managed.config.purpose, "test");
assert.equal(managed.config.origin, spec.origin);
for (const dir of [bundle, base]) {
  assert.equal(path.isAbsolute(dir), true);
  assert.equal(await realpath(dir), dir);
}
const manifestBytes = await readFile(path.join(bundle, "manifest.json"));
assert.equal(hash(manifestBytes), expectedManifest);
const art = JSON.parse(manifestBytes.toString()),
  original = JSON.parse(
    await readFile(path.join(base, "content.json"), "utf8"),
  );
assert.equal(
  hash(canonical(original)),
  "b0c6bbe7742e2da54ccad22afbf909009e7a002dcbd4b78ff36a1def57beda6f",
);
assert.equal(art.resources.length, 20);
assert.equal(art.characterSlots.length, 5);
const content = structuredClone(original),
  b = content.bindings;
const roleRefs = new Set<string>(
  b.slots.characters.flatMap((r: Record<string, { id: string }>) =>
    ["reveal", "report", "poster", "nameArt"].map((k) => r[k]!.id),
  ),
);
const shared = b.resources.filter((r: { id: string }) => !roleRefs.has(r.id));
b.resources = [
  ...shared,
  ...art.resources.map((r: { resource: unknown }) => r.resource),
];
assert.equal(
  new Set(
    b.resources.map(
      (r: { id: string; version: string }) => r.id + "@" + r.version,
    ),
  ).size,
  b.resources.length,
);
for (const role of b.slots.characters) {
  const replacement = art.characterSlots.find(
    (r: { resultRef: { id: string } }) => r.resultRef.id === role.resultRef.id,
  );
  assert.ok(replacement);
  assert.deepEqual(replacement.resultRef, role.resultRef);
  for (const k of ["reveal", "report", "poster", "nameArt"])
    role[k] = replacement[k];
  assert.equal(role.revealComposite, undefined);
}
b.visualVersion = "2.0.0";
b.resourceVersion = "2.0.0";
b.privateTestUse = {
  schemaVersion: "quizforge.private-test-use.v1",
  instanceId: spec.id,
  authorizationId: "qztx-final-private-20261103",
  contentStatus: "candidate",
  resourceStatus: "reference-or-candidate",
};
for (const [id, layout] of Object.entries(b.layouts) as [
  string,
  {
    resourceRefs: { productId: string; id: string; version: string }[];
    component: unknown;
  },
][]) {
  const keys =
    id === "result"
      ? ["reveal", "nameArt"]
      : id === "report"
        ? ["report", "nameArt"]
        : id === "poster"
          ? ["poster", "nameArt"]
          : [];
  layout.resourceRefs = [
    ...layout.resourceRefs.filter((r: { id: string }) => !roleRefs.has(r.id)),
    ...b.slots.characters.flatMap((r: Record<string, unknown>) =>
      keys.map((k) => r[k]),
    ),
  ];
}
b.visualPresentation.resourceDescriptions = [
  ...b.visualPresentation.resourceDescriptions.filter(
    (r: { resourceRef: { id: string } }) => !roleRefs.has(r.resourceRef.id),
  ),
  ...art.resources.map(
    (r: { resourceRef: unknown; roleId: string; use: string }) => ({
      resourceRef: r.resourceRef,
      alt:
        (
          {
            "li-bai": "李白",
            "su-shi": "苏轼",
            "tao-yuanming": "陶渊明",
            "li-qingzhao": "李清照",
            "mulan-ballad": "木兰",
          } as Record<string, string>
        )[r.roleId]! +
        (
          {
            reveal: "揭晓立绘",
            nameArt: "姓名书法",
            report: "报告插画",
            poster: "海报插画",
          } as Record<string, string>
        )[r.use]!,
    }),
  ),
];
assert.deepEqual(content.core, original.core);
for (const k of ["reportTemplates", "resultReports", "witnesses"])
  assert.deepEqual(b[k], original.bindings[k]);
const checked = quizPackContentV3Schema.parse(content),
  prepared = prepareContentV3(checked);
if (!prepared.ok) throw Error("FINAL_SCORING_PREPARATION_REJECTED");
const witnesses = verifyPreparedContentWitnessesV3(prepared.value);
if (!witnesses.ok) throw Error("FINAL_WITNESSES_REJECTED");
const resources = checked.bindings.resources,
  files = [];
let payload = 0;
for (const r of resources) {
  const dir = roleRefs.has(r.id)
    ? bundle
    : art.resources.some(
          (a: { resource: { id: string } }) => a.resource.id === r.id,
        )
      ? bundle
      : base;
  const file = path.join(dir, r.path);
  assert.equal(await realpath(file), file);
  const stat = await lstat(file);
  assert.equal(stat.isFile(), true);
  const bytes = await readFile(file),
    meta = await sharp(bytes).metadata();
  assert.equal(bytes.length, r.bytes);
  assert.equal(hash(bytes), r.sha256);
  assert.equal(meta.width, r.width);
  assert.equal(meta.height, r.height);
  assert.equal(
    "image/" + (meta.format === "jpeg" ? "jpeg" : meta.format),
    r.mediaType,
  );
  assert.ok(meta.pages === undefined || meta.pages === 1);
  assert.ok(bytes.length <= PACK_LIMITS.resourceBytes);
  payload += bytes.length;
  files.push({ resource: r, file });
}
const text = canonical(checked),
  metadata = readContentMetadata(checked),
  components = [
    ...new Map(metadata.components.map((c) => [canonical(c), c])).entries(),
  ]
    .sort(([a], [c]) => (a < c ? -1 : a > c ? 1 : 0))
    .map(([, c]) => c);
const manifest = {
  schemaVersion: "quizpack.v1",
  packId: "qztx-final-private-" + kind,
  packVersion: "1.0.0",
  productId: metadata.productId,
  contentSchemaVersion: checked.schemaVersion,
  engine: metadata.engine,
  components,
  files: [
    {
      path: "content.json",
      bytes: Buffer.byteLength(text),
      sha256: hash(text),
      mediaType: "application/json",
    },
    ...resources.map((r) => ({
      path: r.path,
      bytes: r.bytes,
      sha256: r.sha256,
      mediaType: r.mediaType,
    })),
  ].sort((a, c) => (a.path < c.path ? -1 : a.path > c.path ? 1 : 0)),
};
const manifestText = canonical(manifest, "manifest"),
  estimated =
    payload + Buffer.byteLength(text) + Buffer.byteLength(manifestText) + 65536;
assert.ok(
  estimated <= PACK_LIMITS.archiveBytes,
  "FINAL_ARCHIVE_BUDGET_EXCEEDED",
);
const assetSet = {
  schemaVersion: "quizpack-candidate-asset-set.v1",
  productId: "qianzai-tongxin",
  resources: resources
    .map((r) => ({
      productId: r.productId,
      resourceId: r.id,
      resourceVersion: r.version,
      blobSha256: r.sha256,
      declarationSha256: hash(canonical(r)),
    }))
    .sort((a, c) => a.resourceId.localeCompare(c.resourceId, "en")),
};
const registration = {
  schemaVersion: "quizforge.private-test-registration.v1",
  instanceId: spec.id,
  origin: spec.origin,
  productId: "qianzai-tongxin",
  authorizationId: b.privateTestUse.authorizationId,
  canonicalContentSha256: hash(text),
  assetSetSha256: hash(canonical(assetSet)),
  canonicalManifestSha256: hash(manifestText),
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
const definition = hash(
  canonical({
    source: registration,
    artManifestSha256: expectedManifest,
    witnesses: witnesses.value.evidence,
  }),
);
const baseline = baselineDescriptorV2Schema.parse({
  schemaVersion: "quizforge.baseline-registry-entry.v2",
  contentSchemaVersion: "quizpack-content.v3",
  kind: "baseline",
  id: "qztx-final-private-20261103-" + kind,
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
    instanceId: spec.id,
    evidenceSha256: definition,
    scope: "candidate-content-reference-art-local-test-only",
  },
  sourceEvidence: {
    kind: "private-test-definition",
    definitionSha256: definition,
    qualification:
      "authored-candidate-private-reference-assets-not-final-approval",
  },
  engine: checked.core.scoringDefinition.engine,
  components: Object.fromEntries(
    Object.entries(checked.bindings.layouts).map(([k, l]) => [k, l.component]),
  ),
  slots: b.slots,
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
const out = path.resolve(".cache/final-integration/candidate-" + kind);
await mkdir(out, { mode: 0o700 });
await mkdir(out + "/assets", { mode: 0o700 });
for (const { resource: r, file } of files)
  await copyFile(file, path.join(out, r.path));
for (const [name, value] of [
  ["content.json", text],
  ["manifest.json", manifestText],
  ["registration.json", JSON.stringify(registration, null, 2)],
  ["baseline.json", JSON.stringify(baseline, null, 2)],
  [
    "source-proof.json",
    JSON.stringify(
      {
        scope: "staged only, not built or admitted",
        artManifestSha256: expectedManifest,
        estimatedArchiveBytesWithReserve: estimated,
        logicHash: witnesses.value.evidence.logicHash,
        source: registration,
        baselineSha256: hash(canonical(baseline)),
      },
      null,
      2,
    ),
  ],
] as const)
  await writeFile(out + "/" + name, value, { flag: "wx", mode: 0o600 });
console.log(
  JSON.stringify({
    out,
    source: registration.canonicalContentSha256,
    assetSet: registration.assetSetSha256,
    manifest: registration.canonicalManifestSha256,
    estimatedArchiveBytesWithReserve: estimated,
  }),
);
