/** Deterministic registration facts only. Does not build/admit a private pack,
 * issue a capability, access a database, or mutate the compiled registry. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile, realpath } from "node:fs/promises";
import path from "node:path";
import { canonicalP1Json } from "../src/features/quizpack/v1/canonical";
import { readContentMetadata } from "../src/features/quizpack/content/current";
import { quizPackContentV3Schema } from "../src/features/quizpack/content/v3";
import { prepareContentV3 } from "../src/features/quizpack/content/v3-scoring-adapter";
import { verifyPreparedContentWitnessesV3 } from "../src/features/quizpack/content/v3-witnesses";
import { QIANZAI_KNOWN_TEN_FINAL_TEST_IDENTITY as identity } from "../src/features/quizpack/content/private-test-known-ten-final-identity";
import { QIANZAI_KNOWN_PRESENTATION_SOURCE_SHA256 } from "../src/features/report/qianzai-tongxin/known-presentation-source";

const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const [candidatePath, outputPath] = process.argv.slice(2);
assert(candidatePath && outputPath && process.argv.length === 4);
const candidate = await realpath(candidatePath);
const out = path.resolve(outputPath);
assert(out.startsWith(process.cwd() + "/.cache/"));
assert.equal(await realpath(path.dirname(out)), path.dirname(out));
const content = quizPackContentV3Schema.parse(
  JSON.parse(await readFile(path.join(candidate, "content.json"), "utf8")),
);
assert.equal(
  sha(canonicalP1Json(content)),
  QIANZAI_KNOWN_PRESENTATION_SOURCE_SHA256,
);
assert.equal(content.bindings.kind, "authored");
assert.equal(content.bindings.privateTestUse?.instanceId, identity.instanceId);
assert.equal(
  content.bindings.privateTestUse?.authorizationId,
  identity.authorizationId,
);
const metadata = readContentMetadata(content);
const prepared = prepareContentV3(content);
assert(prepared.ok);
const witnesses = verifyPreparedContentWitnessesV3(prepared.value);
assert(witnesses.ok);
const resources = content.bindings.resources;
assert.equal(resources.length, 53);
const files = [
  {
    path: "content.json",
    bytes: Buffer.byteLength(canonicalP1Json(content)),
    sha256: sha(canonicalP1Json(content)),
    mediaType: "application/json",
  },
];
for (const r of resources) {
  const file = path.join(candidate, r.path);
  assert(file.startsWith(candidate + "/assets/"));
  assert.equal(await realpath(file), file);
  const bytes = await readFile(file);
  assert.equal(bytes.length, r.bytes);
  assert.equal(sha(bytes), r.sha256);
  files.push({
    path: r.path,
    bytes: bytes.length,
    sha256: sha(bytes),
    mediaType: r.mediaType,
  });
}
const components = new Map(
  metadata.components.map((c) => [canonicalP1Json(c), c]),
);
// Exact public runBuild manifest construction; actual capability-gated build
// must independently reproduce this hash before a pack is accepted.
const manifest = {
  schemaVersion: "quizpack.v1",
  packId: "qianzai-tongxin-known-ten",
  packVersion: "3.0.0",
  productId: metadata.productId,
  contentSchemaVersion: content.schemaVersion,
  engine: metadata.engine,
  components: [...components.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, c]) => c),
  files: files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0)),
};
const assetSet = {
  schemaVersion: "quizpack-candidate-asset-set.v1",
  productId: metadata.productId,
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
const definitionSha256 = sha(
  canonicalP1Json({
    contentSha: sha(canonicalP1Json(content)),
    assetSet,
    witnesses: witnesses.value.evidence,
  }),
);
const registration = {
  schemaVersion: "quizforge.private-test-registration.v1",
  instanceId: identity.instanceId,
  origin: identity.origin,
  productId: metadata.productId,
  authorizationId: identity.authorizationId,
  canonicalContentSha256: sha(canonicalP1Json(content)),
  assetSetSha256: sha(canonicalP1Json(assetSet)),
  canonicalManifestSha256: sha(canonicalP1Json(manifest)),
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
const baseline = {
  schemaVersion: "quizforge.baseline-registry-entry.v2",
  contentSchemaVersion: content.schemaVersion,
  kind: "baseline",
  id: "qztx-known-ten-private-20261104",
  version: "1.0.0",
  productId: metadata.productId,
  purpose: "internal-test",
  allowedInstancePurposes: ["test"],
  canonicalContentSha256: registration.canonicalContentSha256,
  assetSetSha256: registration.assetSetSha256,
  canonicalManifestSha256: registration.canonicalManifestSha256,
  logicHash: witnesses.value.evidence.logicHash,
  approval: {
    kind: "private-test-only",
    authorizationId: identity.authorizationId,
    instanceId: identity.instanceId,
    evidenceSha256: definitionSha256,
    scope: "candidate-content-reference-art-local-test-only",
  },
  sourceEvidence: {
    kind: "private-test-definition",
    definitionSha256,
    qualification:
      "authored-candidate-private-reference-assets-not-final-approval",
  },
  engine: metadata.engine,
  components: Object.fromEntries(
    Object.entries(content.bindings.layouts).map(([k, l]) => [k, l.component]),
  ),
  slots: content.bindings.slots,
  resourceEdges: resources.map((r) => ({
    resourceId: r.id,
    version: r.version,
    purpose: r.purpose,
    sha256: r.sha256,
    bytes: r.bytes,
    mediaType: r.mediaType,
    width: r.width,
    height: r.height,
    reviewFile: r.path.slice("assets/".length),
  })),
};
await mkdir(out, { mode: 0o700 });
for (const [name, value] of Object.entries({
  "registration.json": registration,
  "baseline.json": baseline,
  "manifest.json": manifest,
  "asset-set.json": assetSet,
  "receipt.json": {
    status: "DETERMINISTIC_FACTS_ONLY",
    source: registration,
    definitionSha256,
    files: files.length + 1,
    archive: "NOT_BUILT",
    database: "NOT_ACCESSED",
    compiledRegistration: "NOT_WRITTEN",
  },
}))
  await writeFile(path.join(out, name), JSON.stringify(value, null, 2) + "\n", {
    flag: "wx",
    mode: 0o600,
  });
console.log(
  JSON.stringify({
    status: "DETERMINISTIC_FACTS_ONLY",
    canonicalContentSha256: registration.canonicalContentSha256,
    assetSetSha256: registration.assetSetSha256,
    canonicalManifestSha256: registration.canonicalManifestSha256,
    archive: "NOT_BUILT",
  }),
);
