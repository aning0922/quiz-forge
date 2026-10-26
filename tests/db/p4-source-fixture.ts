import type { FixtureCandidate } from "../support/legacy-fixture-types";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { prepareP2b3Source } from "./p2b3-fixture";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { sealCandidateResultEvidence } from "@/features/quizpack/server/validation/contracts";
import { sealSupportedReport } from "@/features/quizpack/server/validation/report";
import { issuePrivateCandidate } from "@/features/quizpack/server/validation/private-candidate";
import { supportedManifestSchema } from "@/features/quizpack/package/manifest";

const sha = (s: string | Uint8Array) =>
  createHash("sha256").update(s).digest("hex");
const productId = "consumer-flow-fixture";
/** Fixed TEST inputs, fresh no-file archive/source identity. Never registers/approves runtime content. */
export async function prepareP4ConsumerSource(runId: string, ordinal = 1) {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 100)
    throw Error("P4_TEST_REVISION_INVALID");
  const base = await prepareP2b3Source(productId, { engine: "archetype" });
  const read = (p: string) =>
    readFile(new URL(`../fixtures/p4-baseline/${p}`, import.meta.url));
  let manifestBytes = await read("manifest.json"),
    contentBytes = await read("content.json");
  const assetSetBytes = await read("asset-set.json");
  if (
    sha(contentBytes) !==
      "d2a2ccf9be34c2485f71080e73337e43a159132650f2d9f36e71e49bdc33fae6" ||
    sha(assetSetBytes) !==
      "19f6cfe15c3eb4364a8f64a1b1f9f13ec5ddba6f0549bee11f3c8175f30e39d3" ||
    sha(manifestBytes) !==
      "2d196b5fb1a36cb267e73ba28b8d37e167cd7c3d847d0d3c93c32c138a24485a"
  )
    throw Error("P4_FIXED_INPUT_CHANGED");
  let content = JSON.parse(
    contentBytes.toString(),
  ) as FixtureCandidate<"quizpack-content.v2">["facts"]["content"];
  if (ordinal > 1) {
    // Deliberately UNREGISTERED next revision for head/obsolete tests. Static image bytes are preserved.
    content = {
      ...content,
      product: {
        ...content.product,
        title: `Synthetic P4 revision ${ordinal}`,
      },
    };
    contentBytes = Buffer.from(canonicalP1Json(content));
    const manifest = supportedManifestSchema.parse(
      JSON.parse(manifestBytes.toString()),
    );
    manifestBytes = Buffer.from(
      canonicalP1Json(
        {
          ...manifest,
          packVersion: `1.0.${ordinal}`,
          files: manifest.files.map((f) =>
            f.path === "content.json"
              ? { ...f, bytes: contentBytes.length, sha256: sha(contentBytes) }
              : f,
          ),
        },
        "manifest",
      ),
    );
  }
  const assetFiles = await Promise.all(
    content.resources.map(async (r) => {
      if (!/^assets\/[a-z0-9-]+\.png$/.test(r.path))
        throw Error("P4_FIXED_INPUT_PATH");
      const bytes = await read(r.path);
      if (sha(bytes) !== r.sha256 || bytes.length !== r.bytes)
        throw Error("P4_FIXED_IMAGE_CHANGED");
      return { path: r.path, bytes };
    }),
  );
  if (base.result.evidence.report.status !== "sealed")
    throw Error("P4_SYNTHETIC_REPORT_REQUIRED");
  const archiveSha256 = sha(
    `P4 explicit no-file archive:${productId}:${runId}`,
  );
  const result = sealCandidateResultEvidence({
    ...base.result,
    evidence: {
      ...base.result.evidence,
      input: {
        status: "snapshotted",
        archiveSha256,
        archiveBytes: 100,
        targetProductId: productId,
      },
      report: sealSupportedReport({
        ...base.result.evidence.report.value,
        archiveSha256,
        manifestSha256: sha(manifestBytes),
        contentSha256: sha(contentBytes),
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
  if (result.outcome !== "accepted")
    throw Error("P4_SYNTHETIC_ACCEPTED_REQUIRED");
  const facts = issuePrivateCandidate(
    result,
    new Map([
      ["manifest.json", manifestBytes],
      ["content.json", contentBytes],
      ...assetFiles.map((a) => [a.path, a.bytes] as [string, Buffer]),
    ]),
  ).facts as FixtureCandidate<"quizpack-content.v2">["facts"];
  if (
    facts.assetSetText !== assetSetBytes.toString() ||
    canonicalP1Json(facts.content) !== contentBytes.toString()
  )
    throw Error("P4_FIXED_CANONICAL_CHANGED");
  return {
    ...base,
    archiveSha256,
    result,
    assetFiles,
    candidate: {
      facts,
      manifestSha256: sha(manifestBytes),
      contentSha256: sha(contentBytes),
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
