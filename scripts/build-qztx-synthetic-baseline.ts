import { createHash } from "node:crypto";
import { mkdir, writeFile, realpath } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { synthetic24ContentV3 } from "../src/features/quizpack/content/v3-synthetic.test-support";
import { buildSupportedQuizPack } from "../src/features/quizpack/package/build";
import { canonicalP1Json } from "../src/features/quizpack/v1/canonical";
import { prepareContentV3 } from "../src/features/quizpack/content/v3-scoring-adapter";
import { verifyPreparedContentWitnessesV3 } from "../src/features/quizpack/content/v3-witnesses";
import { baselineDescriptorV2Schema } from "../src/features/product/internal-versions/baseline-schema-v2";
const sha = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
async function main() {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== "--out" || !args[1])
    throw Error("EXPLICIT_NEW_OUTPUT_REQUIRED");
  const out = resolve(args[1]),
    cwd = await realpath(process.cwd());
  if (
    !out.startsWith(cwd + "/.cache/") ||
    (await realpath(dirname(out))) !== dirname(out)
  )
    throw Error("PRIVATE_OUTPUT_REQUIRED");
  const { content, assets } = await synthetic24ContentV3("synthetic-d2");
  const built = await buildSupportedQuizPack(
    { packId: "synthetic-d2", packVersion: "1.0.0", content, assets },
    { targetProductId: "synthetic-d2" },
    "quizpack-content.v3",
  );
  if (!built.ok) throw Error("SYNTHETIC_PACK_BUILD_FAILED");
  const prepared = prepareContentV3(content);
  if (!prepared.ok) throw Error("SYNTHETIC_PREPARE_FAILED");
  const witnesses = verifyPreparedContentWitnessesV3(prepared.value);
  if (!witnesses.ok) throw Error("SYNTHETIC_WITNESSES_FAILED");
  const assetSet = {
    schemaVersion: "quizpack-candidate-asset-set.v1",
    productId: "synthetic-d2",
    resources: content.bindings.resources
      .map((r) => ({
        productId: r.productId,
        resourceId: r.id,
        resourceVersion: r.version,
        blobSha256: r.sha256,
        declarationSha256: sha(canonicalP1Json(r)),
      }))
      .sort((a, b) =>
        a.resourceId < b.resourceId ? -1 : a.resourceId > b.resourceId ? 1 : 0,
      ),
  };
  const contentSha = sha(canonicalP1Json(content));
  if (
    contentSha !== built.value.report.contentSha256 ||
    contentSha !== witnesses.value.sourceBinding.canonicalContentSha256
  )
    throw Error("SYNTHETIC_CONTENT_HASH_MISMATCH");
  const definitionSha = sha(
    canonicalP1Json({
      contentSha,
      assetSet,
      witnesses: witnesses.value.evidence,
    }),
  );
  const descriptor = baselineDescriptorV2Schema.parse({
    schemaVersion: "quizforge.baseline-registry-entry.v2",
    contentSchemaVersion: "quizpack-content.v3",
    kind: "baseline",
    id: "synthetic-d2-structured",
    version: "1.0.0",
    productId: "synthetic-d2",
    purpose: "internal-test",
    allowedInstancePurposes: ["test", "ci"],
    canonicalContentSha256: contentSha,
    assetSetSha256: sha(canonicalP1Json(assetSet)),
    canonicalManifestSha256: built.value.report.manifestSha256,
    logicHash: witnesses.value.evidence.logicHash,
    approval: {
      kind: "synthetic-test",
      fixtureId: "synthetic-d2-structured",
      evidenceSha256: definitionSha,
      scope: "test-evidence-no-author-approval",
    },
    sourceEvidence: {
      kind: "synthetic-definition",
      definitionSha256: definitionSha,
      qualification: "synthetic-content-private-pixels-no-author-approval",
    },
    engine: content.core.scoringDefinition.engine,
    components: Object.fromEntries(
      Object.entries(content.bindings.layouts).map(([state, layout]) => [
        state,
        layout.component,
      ]),
    ),
    slots: content.bindings.slots,
    resourceEdges: content.bindings.resources.map((r) => ({
      resourceId: r.id,
      version: r.version,
      purpose: r.purpose,
      sha256: r.sha256,
      bytes: r.bytes,
      mediaType: r.mediaType,
      width: r.width,
      height: r.height,
      reviewFile: r.id + ".png",
    })),
  });
  await mkdir(out, { mode: 0o700 });
  for (const [name, data] of [
    ["pack.zip", built.value.archive],
    ["content.json", canonicalP1Json(content)],
    ["asset-set.json", canonicalP1Json(assetSet)],
    ["baseline.json", JSON.stringify(descriptor, null, 2) + "\n"],
  ] as const)
    await writeFile(resolve(out, name), data, { flag: "wx", mode: 0o600 });
  console.log(
    JSON.stringify({
      out,
      source: {
        content: contentSha,
        assetSet: descriptor.assetSetSha256,
        manifest: descriptor.canonicalManifestSha256,
      },
      witnesses: witnesses.value.evidence.entries.length,
      registered: false,
      nativeMediaVerified: false,
      databaseWritten: false,
    }),
  );
}
main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "SYNTHETIC_BUILD_FAILED",
  );
  process.exitCode = 1;
});
