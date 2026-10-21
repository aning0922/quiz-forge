import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { parseSupportedContent } from "@/features/quizpack/content/supported";
import { supportedManifestSchema } from "@/features/quizpack/package/manifest";
import { validateSupportedQuizPack } from "@/features/quizpack/package/validate";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { createStoredArchive } from "@/features/quizpack/v1/build";
import { PACK_LIMITS } from "@/features/quizpack/v1/limits";

export const RECOVERY_SYNTHETIC_BASELINE = Object.freeze({
  productId: "consumer-flow-fixture",
  contentSha256:
    "d2a2ccf9be34c2485f71080e73337e43a159132650f2d9f36e71e49bdc33fae6",
  assetSetSha256:
    "19f6cfe15c3eb4364a8f64a1b1f9f13ec5ddba6f0549bee11f3c8175f30e39d3",
  manifestSha256:
    "2d196b5fb1a36cb267e73ba28b8d37e167cd7c3d847d0d3c93c32c138a24485a",
});
const sha = (bytes: string | Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");
const fail = () => Error("RECOVERY_SYNTHETIC_BASELINE_INVALID");

/** Test-only real archive. This does not issue a candidate or fabricate native/DB evidence. */
export async function buildRecoverySyntheticPack(
  signal = new AbortController().signal,
) {
  signal.throwIfAborted();
  const root = new URL("../fixtures/p4-baseline/", import.meta.url);
  const [manifestBytes, contentBytes, assetSetBytes] = await Promise.all([
    readFile(new URL("manifest.json", root)),
    readFile(new URL("content.json", root)),
    readFile(new URL("asset-set.json", root)),
  ]);
  const fixed = RECOVERY_SYNTHETIC_BASELINE;
  if (
    sha(manifestBytes) !== fixed.manifestSha256 ||
    sha(contentBytes) !== fixed.contentSha256 ||
    sha(assetSetBytes) !== fixed.assetSetSha256
  )
    throw fail();
  const manifest = supportedManifestSchema.parse(
    JSON.parse(manifestBytes.toString("utf8")),
  );
  const parsed = parseSupportedContent(
    JSON.parse(contentBytes.toString("utf8")),
  );
  if (!parsed.ok) throw fail();
  const content = parsed.value;
  if (
    content.schemaVersion !== "quizpack-content.v2" ||
    content.kind !== "synthetic" ||
    content.product.productId !== fixed.productId ||
    manifest.productId !== fixed.productId ||
    manifest.contentSchemaVersion !== content.schemaVersion
  )
    throw fail();
  const assets = await Promise.all(
    content.resources.map(async (resource) => {
      signal.throwIfAborted();
      if (!/^assets\/[a-z0-9-]+\.png$/.test(resource.path)) throw fail();
      const bytes = await readFile(new URL(resource.path, root));
      if (bytes.length !== resource.bytes || sha(bytes) !== resource.sha256)
        throw fail();
      return { path: resource.path, bytes };
    }),
  );
  const assetSetText = canonicalP1Json({
    schemaVersion: "quizpack-candidate-asset-set.v1",
    productId: fixed.productId,
    resources: [...content.resources]
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
      .map((resource) => ({
        productId: resource.productId,
        resourceId: resource.id,
        resourceVersion: resource.version,
        blobSha256: resource.sha256,
        declarationSha256: sha(canonicalP1Json(resource)),
      })),
  });
  if (assetSetText !== assetSetBytes.toString("utf8")) throw fail();
  // Preserve the registered manifest bytes; the generic builder regenerates its ordering.
  const archive = await createStoredArchive(
    [
      { path: "manifest.json", bytes: manifestBytes },
      { path: "content.json", bytes: contentBytes },
      ...assets,
    ],
    PACK_LIMITS.archiveBytes,
    signal,
  );
  const report = await validateSupportedQuizPack(
    (async function* () {
      yield archive;
    })(),
    { targetProductId: fixed.productId, signal },
    "quizpack-content.v2",
  );
  if (!report.candidateValid || report.issues.length) throw fail();
  return {
    archive,
    archiveSha256: sha(archive),
    archiveBytes: archive.length,
    baseline: fixed,
    report,
  };
}
