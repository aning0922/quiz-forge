import type { FixtureCandidate } from "../support/legacy-fixture-types";
import { createHash } from "node:crypto";
import { prepareP3cSource } from "./p3c-source-fixture";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { supportedManifestSchema } from "@/features/quizpack/package/manifest";
import { sealCandidateResultEvidence } from "@/features/quizpack/server/validation/contracts";
import { sealCurrentReport } from "@/features/quizpack/server/validation/report";
import { issuePrivateCandidate } from "@/features/quizpack/server/validation/private-candidate";
/** Real supported candidate construction and PG transitions, synthetic no-file archive/media evidence. */
export async function prepareP3dSource(
  productId: string,
  ordinal: number,
  runId: string,
) {
  const base = await prepareP3cSource(productId, "archetype", runId),
    sha = (x: string | Uint8Array) =>
      createHash("sha256").update(x).digest("hex");
  const content = {
    ...base.candidate.facts.content,
    product: {
      ...base.candidate.facts.content.product,
      title: `Synthetic revision ${ordinal}`,
    },
  };
  const text = canonicalP1Json(content),
    manifest = supportedManifestSchema.parse({
      ...base.candidate.facts.manifest,
      packVersion: `1.0.${ordinal}`,
      files: base.candidate.facts.manifest.files.map((f) =>
        f.path === "content.json"
          ? { ...f, bytes: Buffer.byteLength(text), sha256: sha(text) }
          : f,
      ),
    }),
    manifestText = canonicalP1Json(manifest);
  if (base.result.evidence.report.status !== "sealed")
    throw Error("P3D_SYNTHETIC_REPORT_REQUIRED");
  const archiveSha256 = sha(
    `P3D explicit no-file archive:${productId}:${ordinal}:${runId}`,
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
        manifestSha256: sha(manifestText),
        contentSha256: sha(text),
      }),
    },
  });
  if (result.outcome !== "accepted")
    throw Error("P3D_SYNTHETIC_ACCEPTED_REQUIRED");
  const facts = issuePrivateCandidate(
    result,
    new Map<string, Uint8Array>([
      ["manifest.json", Buffer.from(manifestText)],
      ["content.json", Buffer.from(text)],
      ...base.assetFiles.map((a) => [a.path, a.bytes] as const),
    ]),
  ).facts as FixtureCandidate<"quizpack-content.v2">["facts"];
  return {
    ...base,
    archiveSha256,
    result,
    candidate: {
      facts,
      manifestSha256: sha(manifestText),
      contentSha256: sha(text),
    },
  };
}
