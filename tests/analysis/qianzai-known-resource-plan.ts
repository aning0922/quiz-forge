/** Offline inventory only. No content/manifest/source is emitted or registered. */
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { PACK_LIMITS } from "../../src/features/quizpack/v1/limits";
import { canonicalP1Json } from "../../src/features/quizpack/v1/canonical";
import { quizPackContentV3Schema } from "../../src/features/quizpack/content/v3";
import registration from "../../src/features/quizpack/content/private-test-registration-final-e2e.json";
import { QIANZAI_KNOWN_TEN_ROLES } from "../../src/features/report/qianzai-tongxin/known-ten-catalog";
const [sourceFile, outputFile] = process.argv.slice(2);
assert.ok(
  sourceFile &&
    outputFile &&
    path.isAbsolute(sourceFile) &&
    path.isAbsolute(outputFile),
  "two explicit absolute paths required",
);
const source = quizPackContentV3Schema.parse(
  JSON.parse(await readFile(sourceFile, "utf8")),
);
const sourceSha256 = createHash("sha256")
  .update(canonicalP1Json(source))
  .digest("hex");
assert.equal(sourceSha256, registration.canonicalContentSha256);
const key = (ref: { productId: string; id: string; version: string }) =>
  JSON.stringify([ref.productId, ref.id, ref.version]);
const oldRoleRefs = new Set(
  source.bindings.slots.characters.flatMap((role) =>
    [role.reveal, role.report, role.poster, role.nameArt].map(key),
  ),
);
const shared = source.bindings.resources.filter(
  (resource) => !oldRoleRefs.has(key(resource)),
);
assert.equal(shared.length, 13);
const pending = QIANZAI_KNOWN_TEN_ROLES.flatMap((role) =>
  Object.entries(role.resourceRefs).map(([use, ref]) => ({
    roleRef: role.ref,
    use,
    ref,
    status: "awaiting-final-bytes-dimensions-provenance-and-authorization",
  })),
);
assert.equal(pending.length, 40);
const allKeys = [
  ...shared.map(key),
  ...pending.map((resource) => key(resource.ref)),
];
assert.equal(new Set(allKeys).size, allKeys.length);
const resourceCount = allKeys.length,
  fileCount = resourceCount + 2;
assert.ok(
  resourceCount <= PACK_LIMITS.resources && fileCount <= PACK_LIMITS.entries,
);
const knownSharedBytes = shared.reduce((total, r) => total + r.bytes, 0);
const report = {
  schemaVersion: "qianzai-known-ten-resource-inventory.v1",
  scope: "offline planning, not a valid QuizPack or resource/source admission",
  baseSourceSha256: sourceSha256,
  counts: {
    shared: shared.length,
    finalRoleResourcesPending: pending.length,
    plannedResources: resourceCount,
    plannedPackFiles: fileCount,
    resourceLimit: PACK_LIMITS.resources,
    fileLimit: PACK_LIMITS.entries,
    countFits: true,
  },
  bytes: {
    knownSharedBytes,
    archiveLimit: PACK_LIMITS.archiveBytes,
    uncompressedLimit: PACK_LIMITS.totalUncompressedBytes,
    perResourceLimit: PACK_LIMITS.resourceBytes,
    contentLimit: PACK_LIMITS.contentBytes,
    manifestLimit: PACK_LIMITS.manifestBytes,
    rawRoleAllowanceWithoutCompressionOrZipHeaders:
      PACK_LIMITS.archiveBytes -
      knownSharedBytes -
      PACK_LIMITS.contentBytes -
      PACK_LIMITS.manifestBytes,
    caveat:
      "raw allowance reserves maximum JSON sizes but excludes ZIP headers; it is not a final archive proof",
  },
  shared: shared.map((r) => ({
    ref: { productId: r.productId, id: r.id, version: r.version },
    bytes: r.bytes,
    sha256: r.sha256,
    mediaType: r.mediaType,
    newSourceReuseAuthorization: "pending",
  })),
  pending,
  finalArchiveBytes: null,
  finalContentBytes: null,
  finalSourceFrozen: false,
  readyForAdmission: false,
  excluded:
    "mother-art trial images are not final runtime declarations; Yang Yuhuan v1 is withdrawn and is not counted as ready",
};
await writeFile(outputFile, JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
  mode: 0o600,
});
console.log(
  JSON.stringify(
    {
      counts: report.counts,
      bytes: report.bytes,
      readyForAdmission: report.readyForAdmission,
    },
    null,
    2,
  ),
);
