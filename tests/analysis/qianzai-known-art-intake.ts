/** Frozen B handoff -> A-owned private bytes. No source, runtime or author approval. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { currentResourceV3Schema } from "../../src/features/quizpack/content/v3";
import { readRestrictedZip } from "../../src/features/quizpack/v1/zip";
import { PACK_LIMITS } from "../../src/features/quizpack/v1/limits";
import { QIANZAI_KNOWN_TEN_ROLES } from "../../src/features/report/qianzai-tongxin/known-ten-catalog";
import oldRegistration from "../../src/features/quizpack/content/private-test-registration-final-e2e.json";

const [manifestFile, receiptFile, outputDirectory, expectedArchiveSha256] =
  process.argv.slice(2);
assert(manifestFile && receiptFile && outputDirectory && expectedArchiveSha256);
assert(/^[a-f0-9]{64}$/.test(expectedArchiveSha256));
for (const file of [manifestFile, receiptFile, outputDirectory])
  assert(path.isAbsolute(file));
const out = path.resolve(outputDirectory);
assert(out.startsWith(process.cwd() + "/.cache/"));
assert.equal(await realpath(path.dirname(out)), path.dirname(out));
const hash = (bytes: Buffer | string) =>
  createHash("sha256").update(bytes).digest("hex");
const manifestBytes = await readFile(manifestFile),
  receiptBytes = await readFile(receiptFile);
const manifest = JSON.parse(manifestBytes.toString("utf8")),
  receipt = JSON.parse(receiptBytes.toString("utf8"));
assert.equal(manifest.schemaVersion, "qianzai.known-ten-art-delivery.v1");
assert.equal(manifest.resources.length, 40);
assert.equal(manifest.shared.length, 13);
assert.equal(manifest.characterSlots.length, 10);
assert.equal(receipt.entries, 53);
assert(Number.isSafeInteger(receipt.bytes) && receipt.bytes > 0);
// Exact frozen transfer from the main-coordinated handoff, not an arbitrary replaceable path.
assert.equal(receipt.sha256, expectedArchiveSha256);
const archive = await readFile(receipt.path);
assert.equal(archive.length, receipt.bytes);
assert.equal(hash(archive), receipt.sha256);
assert(archive.length <= PACK_LIMITS.archiveBytes);
await mkdir(out, { mode: 0o700 });
const write = (name: string, value: unknown) =>
  writeFile(path.join(out, name), JSON.stringify(value, null, 2), {
    flag: "wx",
    mode: 0o600,
  });
await write("intent.json", {
  sourceManifest: manifestFile,
  sourceManifestSha256: hash(manifestBytes),
  sourceArchiveReceipt: receiptFile,
  sourceArchiveSha256: receipt.sha256,
  scope:
    "frozen material transfer and complete ref mapping; no QuizPack/source/DB/runtime admission",
});
try {
  const parsed = await readRestrictedZip(
    (async function* () {
      yield archive;
    })(),
    {
      targetProductId: "qianzai-tongxin",
      signal: new AbortController().signal,
    },
  );
  assert(
    parsed.ok,
    parsed.ok ? undefined : parsed.issues.map((i) => i.code).join(","),
  );
  assert.equal(parsed.value.files.size, 53);
  const declarations = [
    ...manifest.shared.map((r: { resource: unknown }) => r.resource),
    ...manifest.resources.map((r: { resource: unknown }) => r.resource),
  ].map((r) => currentResourceV3Schema.parse(r));
  const key = (r: { productId: string; id: string; version: string }) =>
    JSON.stringify([r.productId, r.id, r.version]);
  assert.equal(new Set(declarations.map(key)).size, 53);
  const resources = new Map(declarations.map((r) => [key(r), r]));
  assert.deepEqual(
    [...parsed.value.files.keys()].sort(),
    declarations.map((r) => r.path).sort(),
  );
  const useNames = ["reveal", "report", "poster", "nameArt"] as const;
  for (const role of QIANZAI_KNOWN_TEN_ROLES) {
    const slots = manifest.characterSlots.filter(
      (r: { resultRef: typeof role.ref }) => key(r.resultRef) === key(role.ref),
    );
    assert.equal(slots.length, 1);
    for (const use of useNames) {
      assert.equal(key(slots[0][use]), key(role.resourceRefs[use]));
      assert(resources.has(key(role.resourceRefs[use])));
      const rows = manifest.resources.filter(
        (r: { roleId: string; use: string }) =>
          r.roleId === role.id && r.use === use,
      );
      assert.equal(rows.length, 1);
      assert.equal(key(rows[0].resourceRef), key(role.resourceRefs[use]));
    }
  }
  for (const shared of manifest.shared) {
    const resource = currentResourceV3Schema.parse(shared.resource),
      old = oldRegistration.resources.find((r) => key(r) === key(resource));
    assert(old);
    for (const field of [
      "sha256",
      "bytes",
      "width",
      "height",
      "mediaType",
      "purpose",
    ] as const)
      assert.equal(resource[field], old[field]);
  }
  let payloadBytes = 0;
  const resolved = [];
  for (const resource of declarations) {
    assert.equal(resource.approval, "private-test-only");
    assert.equal(resource.license.commercialUse, false);
    assert.equal(resource.license.redistribution, false);
    const bytes = parsed.value.files.get(resource.path);
    assert(bytes);
    assert.equal(bytes.length, resource.bytes);
    assert.equal(hash(bytes), resource.sha256);
    const target = path.resolve(out, resource.path);
    assert(target.startsWith(out + "/"));
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    await writeFile(target, bytes, { flag: "wx", mode: 0o600 });
    assert.equal(hash(await readFile(target)), resource.sha256);
    payloadBytes += bytes.length;
    resolved.push({ resource, localPath: target });
  }
  assert.equal(payloadBytes, manifest.bytes.resourcePayload);
  const samples = [
    { role: "su-shi", use: "reveal" },
    { role: "yang-yuhuan", use: "report" },
    { role: "tang-yin", use: "report" },
    { role: "cai-wenji", use: "report" },
    { role: "cai-wenji", use: "nameArt" },
  ];
  const decoded = [];
  for (const sample of samples) {
    const role = QIANZAI_KNOWN_TEN_ROLES.find((r) => r.id === sample.role);
    assert(role);
    const resource = resources.get(
      key(role.resourceRefs[sample.use as (typeof useNames)[number]]),
    );
    assert(resource);
    const actual = await sharp(path.resolve(out, resource.path), {
      limitInputPixels: PACK_LIMITS.imagePixels,
    })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(actual.info.width, resource.width);
    assert.equal(actual.info.height, resource.height);
    decoded.push({
      role: sample.role,
      use: sample.use,
      width: actual.info.width,
      height: actual.info.height,
      qualification:
        "actual local Sharp decode; not managed media runtime acceptance",
    });
  }
  await writeFile(path.join(out, "source-manifest.json"), manifestBytes, {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(path.join(out, "source-archive-receipt.json"), receiptBytes, {
    flag: "wx",
    mode: 0o600,
  });
  await writeFile(path.join(out, "known-ten-resources-only.zip"), archive, {
    flag: "wx",
    mode: 0o600,
  });
  assert.equal(
    hash(await readFile(path.join(out, "known-ten-resources-only.zip"))),
    receipt.sha256,
  );
  await write("resolved-resources.json", {
    resources: resolved,
    characterSlots: manifest.characterSlots,
  });
  await write("result.json", {
    status: "PASS_FROZEN_ART_TRANSFER_MAPPING_ONLY",
    sourceManifestSha256: hash(manifestBytes),
    archiveSha256: receipt.sha256,
    archiveBytes: receipt.bytes,
    resourceCount: 53,
    roleRefs: 10,
    roleUses: 40,
    payloadBytes,
    sharedIdentityAndBytesPreserved: 13,
    decodedSamples: decoded,
    reuse:
      "B exact frozen input's 53-resource decode/name-alpha/crop review proof; no repeat whole visual matrix",
    sourceAdmission: "NOT_RUN",
    fullQuizPack: "NOT_BUILT",
  });
  console.log(
    JSON.stringify({
      status: "PASS_FROZEN_ART_TRANSFER_MAPPING_ONLY",
      resources: 53,
      decodedSamples: decoded.length,
      out,
    }),
  );
} catch (e) {
  await write("failure.json", {
    status: "FAILED_PRESERVED",
    code: (e as { code?: string }).code,
    message: (e as Error).message,
  });
  throw e;
}
