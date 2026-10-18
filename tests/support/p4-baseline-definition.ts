import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { parseSupportedContent } from "@/features/quizpack/content/supported";
import {
  prepareContentForScoring,
  verifyPreparedContentWitnesses,
} from "@/features/quizpack/content/scoring-adapter";
const hash = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const originalId = "internal-version-fixture",
  productId = "consumer-flow-fixture";
function replace(value: unknown): unknown {
  if (value === originalId) return productId;
  if (Array.isArray(value)) return value.map(replace);
  if (value && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, replace(v)]),
    );
  return value;
}
/** Offline deterministic TEST derivation only; no write/registry/database/native/network entry. */
export async function deriveP4BaselineDefinition() {
  const root = new URL("../fixtures/p3e-baseline/", import.meta.url);
  const oldDescriptor = JSON.parse(
    await readFile(
      new URL(
        "../../src/features/product/internal-versions/baselines/synthetic-internal-version-v1.json",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  const oldContent = await readFile(new URL("content.json", root)),
    oldAssetSet = await readFile(new URL("asset-set.json", root)),
    oldManifest = await readFile(new URL("manifest.json", root));
  if (
    hash(oldContent) !==
      "482e06eb50d1a5cd9a9d3048b8e2a7c2fbca6831284f2a2fa0d474bc94b016fd" ||
    hash(oldAssetSet) !==
      "d294104cd47e27615a2a3cd1155a8958b11c15aff92f94f0d12576646bed06d3" ||
    hash(oldManifest) !==
      "6352846a3baa4c52940679da11f14db5b0c63c498473f68b598bcf9a8f619108"
  )
    throw Error("P4_ORIGINAL_BASELINE_CHANGED");
  const raw = replace(JSON.parse(oldContent.toString()));
  const parsed = parseSupportedContent(raw);
  if (!parsed.ok || parsed.value.schemaVersion !== "quizpack-content.v2")
    throw Error("P4_SYNTHETIC_DEFINITION_INVALID");
  const content = parsed.value;
  const contentText = canonicalP1Json(content);
  const manifest = replace(JSON.parse(oldManifest.toString())) as {
    files: { path: string; bytes: number; sha256: string }[];
  };
  const contentFile = manifest.files.find((f) => f.path === "content.json");
  if (!contentFile) throw Error("P4_SYNTHETIC_MANIFEST_INVALID");
  contentFile.bytes = Buffer.byteLength(contentText);
  contentFile.sha256 = hash(contentText);
  const assets = await Promise.all(
    content.resources.map(async (r) => {
      if (!/^assets\/[a-z0-9-]+\.png$/.test(r.path))
        throw Error("P4_SYNTHETIC_ASSET_PATH_INVALID");
      const bytes = await readFile(new URL(r.path, root));
      if (hash(bytes) !== r.sha256 || bytes.length !== r.bytes)
        throw Error("P4_SYNTHETIC_ASSET_CHANGED");
      return { path: r.path, bytes, resource: r };
    }),
  );
  const resources = [...content.resources]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((r) => ({
      productId,
      resourceId: r.id,
      resourceVersion: r.version,
      blobSha256: r.sha256,
      declarationSha256: hash(canonicalP1Json(r)),
    }));
  const assetSetText = canonicalP1Json({
    schemaVersion: "quizpack-candidate-asset-set.v1",
    productId,
    resources,
  });
  const manifestText = canonicalP1Json(manifest, "manifest");
  const prepared = prepareContentForScoring(content);
  if (!prepared.ok) throw Error("P4_SYNTHETIC_PREPARE_INVALID");
  const witnesses = verifyPreparedContentWitnesses(prepared.value);
  if (!witnesses.ok || witnesses.value.evidence.status !== "passed")
    throw Error("P4_SYNTHETIC_WITNESS_INVALID");
  const facts = {
    productId,
    canonicalContentSha256: hash(contentText),
    assetSetSha256: hash(assetSetText),
    canonicalManifestSha256: hash(manifestText),
  };
  const evidence = {
    schemaVersion: "quizforge.synthetic-consumer-baseline-evidence.v1",
    ...facts,
    qualification:
      "synthetic-db-private-pixels-no-native-validation-no-author-approval",
    allowedInstancePurposes: ["test", "ci"],
    authorApproved: false,
    publicationApproved: false,
    original: {
      productId: originalId,
      canonicalContentSha256: hash(oldContent),
      assetSetSha256: hash(oldAssetSet),
      canonicalManifestSha256: hash(oldManifest),
    },
    recipe: {
      replaceExactProductId: true,
      oldReferencesRetained: false,
      pixelBytesChanged: false,
      independentNodeDerivations: 2,
    },
    checks: {
      actualScoringWitnessesVerified: true,
      exactImageBytesEqual: true,
      dbOpened: false,
      nativeMediaVerified: false,
      registryWritten: false,
    },
    logicHash: witnesses.value.evidence.logicHash,
    documents: [
      {
        name: "content.json",
        bytes: Buffer.byteLength(contentText),
        sha256: hash(contentText),
      },
      {
        name: "asset-set.json",
        bytes: Buffer.byteLength(assetSetText),
        sha256: hash(assetSetText),
      },
      {
        name: "manifest.json",
        bytes: Buffer.byteLength(manifestText),
        sha256: hash(manifestText),
      },
    ],
    assets: assets.map((a) => ({
      path: a.path,
      bytes: a.bytes.length,
      sha256: hash(a.bytes),
    })),
    witnessResultIds: content.results.map((r) => r.id),
  };
  const evidenceText = canonicalP1Json(evidence),
    definitionSha = hash(evidenceText);
  const descriptor = {
    ...(replace(oldDescriptor) as object),
    id: "consumer-flow-synthetic-baseline",
    productId,
    canonicalContentSha256: facts.canonicalContentSha256,
    assetSetSha256: facts.assetSetSha256,
    canonicalManifestSha256: facts.canonicalManifestSha256,
    logicHash: witnesses.value.evidence.logicHash,
    allowedInstancePurposes: ["test", "ci"],
    approval: {
      kind: "synthetic-test",
      fixtureId: "consumer-flow-fixture-v1",
      evidenceSha256: definitionSha,
      scope: "test-evidence-no-author-approval",
    },
    sourceEvidence: {
      kind: "synthetic-definition",
      definitionSha256: definitionSha,
      qualification: "synthetic-content-private-pixels-no-author-approval",
    },
  };
  const files = new Map<string, Buffer>([
    ["content.json", Buffer.from(contentText)],
    ["asset-set.json", Buffer.from(assetSetText)],
    ["manifest.json", Buffer.from(manifestText)],
    ["synthetic-evidence.json", Buffer.from(evidenceText)],
    ...assets.map((a) => [a.path, a.bytes] as [string, Buffer]),
  ]);
  return { facts, descriptor, files };
}
