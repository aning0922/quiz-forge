import sharp from "sharp";
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
  uniqueRun?: string,
) {
  const base = await prepareP2b3Source(productId, { engine });
  const original = await createContentV2Fixture(engine);
  const content = JSON.parse(
    JSON.stringify(original).replaceAll(
      JSON.stringify(original.product.productId),
      JSON.stringify(productId),
    ),
  ) as typeof original;
  const pixels = await createSyntheticFixture(engine);
  let assetFiles = [
    ...pixels.assets,
    { path: "assets/neutral-scene.png", bytes: pixels.assets[0]!.bytes },
  ];
  if (uniqueRun) {
    assetFiles = [];
    for (const [i, r] of content.resources.entries()) {
      const seed = createHash("sha256")
        .update(uniqueRun + engine + String(i))
        .digest();
      const raw = Buffer.alloc(48 * 48 * 3);
      for (let n = 0; n < raw.length; n++)
        raw[n] = (seed[n % 32]! + n * 13 + Math.floor(n / 48)) % 256;
      const bytes = await sharp(raw, {
        raw: { width: 48, height: 48, channels: 3 },
      })
        .png()
        .toBuffer();
      r.path = `assets/${r.id}.png`;
      r.mediaType = "image/png";
      r.width = 48;
      r.height = 48;
      r.bytes = bytes.length;
      r.sha256 = createHash("sha256").update(bytes).digest("hex");
      assetFiles.push({ path: r.path, bytes });
    }
  }
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
      media: content.resources.map((r, resourceIndex) => ({
        resourceIndex,
        result: {
          outcome: "decoded" as const,
          runId: randomUUID(),
          profileId: "a".repeat(64),
          stopped: "confirmed" as const,
          facts: {
            mediaType: r.mediaType,
            width: r.width,
            height: r.height,
            frames: 1,
            mediaDecoded: true,
          },
        },
      })),
    },
  });
  const files = new Map<string, Uint8Array>([
    ["manifest.json", Buffer.from(manifestText)],
    ["content.json", Buffer.from(contentText)],
    ...assetFiles.map((a) => [a.path, a.bytes] as const),
  ]);
  if (result.outcome !== "accepted")
    throw Error("P3C_SYNTHETIC_CANDIDATE_REQUIRED");
  const facts = issuePrivateCandidate(result, files).facts;
  return {
    ...base,
    assetFiles,
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
