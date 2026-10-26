import type { FixtureCandidate } from "../support/legacy-fixture-types";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { prepareP2b3Source } from "./p2b3-fixture";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { sealCandidateResultEvidence } from "@/features/quizpack/server/validation/contracts";
import { sealCurrentReport } from "@/features/quizpack/server/validation/report";
import { issuePrivateCandidate } from "@/features/quizpack/server/validation/private-candidate";
import { supportedManifestSchema } from "@/features/quizpack/package/manifest";

const sha = (s: string | Uint8Array) =>
  createHash("sha256").update(s).digest("hex");
const productId = "internal-version-fixture";
/** Fixed TEST inputs, fresh no-file archive/source identity. Never registers/approves runtime content. */
export async function prepareP3eSource(runId: string, ordinal = 1) {
  if (!Number.isInteger(ordinal) || ordinal < 1 || ordinal > 100)
    throw Error("P3E_TEST_REVISION_INVALID");
  const base = await prepareP2b3Source(productId, { engine: "archetype" });
  const read = (p: string) =>
    readFile(new URL(`../fixtures/p3e-baseline/${p}`, import.meta.url));
  let manifestBytes = await read("manifest.json"),
    contentBytes = await read("content.json");
  const assetSetBytes = await read("asset-set.json");
  if (
    sha(contentBytes) !==
      "482e06eb50d1a5cd9a9d3048b8e2a7c2fbca6831284f2a2fa0d474bc94b016fd" ||
    sha(assetSetBytes) !==
      "d294104cd47e27615a2a3cd1155a8958b11c15aff92f94f0d12576646bed06d3" ||
    sha(manifestBytes) !==
      "6352846a3baa4c52940679da11f14db5b0c63c498473f68b598bcf9a8f619108"
  )
    throw Error("P3E_FIXED_INPUT_CHANGED");
  let content = JSON.parse(
    contentBytes.toString(),
  ) as FixtureCandidate<"quizpack-content.v2">["facts"]["content"];
  if (ordinal > 1) {
    // Deliberately UNREGISTERED next revision for head/obsolete tests. Static image bytes are preserved.
    content = {
      ...content,
      product: { ...content.product, title: `Synthetic revision ${ordinal}` },
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
        throw Error("P3E_FIXED_INPUT_PATH");
      const bytes = await read(r.path);
      if (sha(bytes) !== r.sha256 || bytes.length !== r.bytes)
        throw Error("P3E_FIXED_IMAGE_CHANGED");
      return { path: r.path, bytes };
    }),
  );
  if (base.result.evidence.report.status !== "sealed")
    throw Error("P3E_SYNTHETIC_REPORT_REQUIRED");
  const archiveSha256 = sha(
    `P3E explicit no-file archive:${productId}:${runId}`,
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
      report: sealCurrentReport({
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
    throw Error("P3E_SYNTHETIC_ACCEPTED_REQUIRED");
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
    throw Error("P3E_FIXED_CANONICAL_CHANGED");
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
