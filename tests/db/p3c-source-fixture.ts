import { createHash, randomUUID } from "node:crypto";
import { prepareP2b3Source } from "./p2b3-fixture";
import { createContentV2Fixture } from "@/features/quizpack/content/fixtures.test-support";
import { createSyntheticFixture } from "@/features/quizpack/v1/fixtures/synthetic";
import { supportedManifestSchema } from "@/features/quizpack/package/manifest";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { sealSupportedReport } from "@/features/quizpack/server/validation/report";
import { sealCandidateResultEvidence } from "@/features/quizpack/server/validation/contracts";
import { issuePrivateCandidate } from "@/features/quizpack/server/validation/private-candidate";
/** Actual candidate/PG shape with explicitly synthetic media evidence; never native-media proof. */
export async function prepareP3cSource(
  productId: string,
  engine: "dimensions" | "archetype" = "archetype",
) {
  const base = await prepareP2b3Source(productId, { engine });
  const original = await createContentV2Fixture(engine);
  const content = JSON.parse(
    JSON.stringify(original).replaceAll(
      JSON.stringify(original.product.productId),
      JSON.stringify(productId),
    ),
  ) as typeof original;
  const contentText = canonicalP1Json(content);
  const sha = (s: string | Uint8Array) =>
    createHash("sha256").update(s).digest("hex");
  const manifest = supportedManifestSchema.parse({
    ...base.candidate.facts.manifest,
    contentSchemaVersion: content.schemaVersion,
    components: Object.values(content.layouts).map((l) => l.component),
    files: [
      {
        path: "content.json",
        mediaType: "application/json",
        bytes: Buffer.byteLength(contentText),
        sha256: sha(contentText),
      },
      ...content.resources.map((r) => ({
        path: r.path,
        mediaType: r.mediaType,
        bytes: r.bytes,
        sha256: r.sha256,
      })),
    ],
  });
  const manifestText = canonicalP1Json(manifest);
  const evidence = base.result.evidence;
  if (evidence.report.status !== "sealed")
    throw Error("P3C_SYNTHETIC_REPORT_REQUIRED");
  const report = evidence.report;
  const result = sealCandidateResultEvidence({
    ...base.result,
    evidence: {
      ...evidence,
      report: sealSupportedReport({
        ...report.value,
        manifestSha256: sha(manifestText),
        contentSha256: sha(contentText),
      }),
      media: [
        ...evidence.media,
        {
          ...evidence.media[0]!,
          resourceIndex: content.resources.length - 1,
          result: { ...evidence.media[0]!.result, runId: randomUUID() },
        },
      ],
    },
  });
  const pixels = await createSyntheticFixture(engine);
  const files = new Map<string, Uint8Array>([
    ["manifest.json", Buffer.from(manifestText)],
    ["content.json", Buffer.from(contentText)],
    ...pixels.assets.map((a) => [a.path, a.bytes] as const),
    ["assets/neutral-scene.png", pixels.assets[0]!.bytes],
  ]);
  if (result.outcome !== "accepted")
    throw Error("P3C_SYNTHETIC_CANDIDATE_REQUIRED");
  const facts = issuePrivateCandidate(result, files).facts;
  return {
    ...base,
    result,
    candidate: {
      facts,
      manifestSha256: sha(manifestText),
      contentSha256: sha(contentText),
    },
    blobs: [...new Map(facts.resources.map((r) => [r.blobSha256, r])).values()]
      .sort((a, b) => a.blobSha256.localeCompare(b.blobSha256))
      .map((r) => ({
        sha256: r.blobSha256,
        bytes: r.bytes,
        mediaType: r.declaration.mediaType,
        width: r.declaration.width,
        height: r.declaration.height,
        frames: 1 as const,
      })),
  };
}
