import { randomUUID, createHash } from "node:crypto";
import { synthetic24ContentV3 } from "@/features/quizpack/content/v3-synthetic.test-support";
import { buildSupportedQuizPack } from "@/features/quizpack/package/build";
import { readRestrictedZipCore } from "@/features/quizpack/v1/zip";
import { PACK_LIMITS } from "@/features/quizpack/v1/limits";
import { currentRuntimeIdentity } from "@/features/quizpack/server/validation/identity";
import {
  sealCurrentReport,
  freezeJson,
} from "@/features/quizpack/server/validation/report";
import { sealCandidateResultEvidence } from "@/features/quizpack/server/validation/contracts";
import { issuePrivateCandidate } from "@/features/quizpack/server/validation/private-candidate";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import {
  ARCHIVE_POLICY_VERSION,
  archivePolicySha256,
} from "@/features/quizpack/validation/policy";
import type { FrozenCandidate } from "@/features/quizpack/validation/transactions-contract";
/** Real ZIP/local decoder plus explicitly synthetic platform authority. SQL fixture only, never native media proof. */
export async function prepareQztx2SqlSource(productId = "synthetic-d2") {
  const fixture = await synthetic24ContentV3(productId);
  const built = await buildSupportedQuizPack(
    {
      packId: productId,
      packVersion: "1.0.0",
      content: fixture.content,
      assets: fixture.assets,
    },
    { targetProductId: productId },
    "quizpack-content.v3",
  );
  if (!built.ok) throw Error("D2_SQL_FIXTURE_BUILD_FAILED");
  const archive = built.value.archive,
    archiveSha256 = createHash("sha256").update(archive).digest("hex");
  const identity = currentRuntimeIdentity({
    schema: "quizpack-media-runtime-binding.v1",
    platform: "darwin-arm64",
    componentId: "a".repeat(64),
    deploymentId: "b".repeat(64),
    runtimeBundleHash: "c".repeat(64),
    limitsHash: "d".repeat(64),
  });
  const result = sealCandidateResultEvidence({
    outcome: "accepted",
    evidence: {
      schemaVersion: "quizpack-candidate-evidence.v1",
      input: {
        status: "snapshotted",
        archiveSha256,
        archiveBytes: archive.length,
        targetProductId: productId,
      },
      identity: { status: "bound", value: identity },
      report: sealCurrentReport(built.value.report),
      policy: { status: "passed" },
      media: fixture.content.bindings.resources.map((r, resourceIndex) => ({
        resourceIndex,
        result: {
          outcome: "decoded",
          runId: randomUUID(),
          profileId: "e".repeat(64),
          stopped: "confirmed",
          facts: {
            mediaType: r.mediaType,
            width: r.width,
            height: r.height,
            frames: 1,
            mediaDecoded: true,
          },
        },
      })),
      completion: {
        mediaStopped: "confirmed",
        relatedIo: "settled",
        maintenanceRequired: false,
      },
      runtimeFailure: null,
    },
  });
  if (result.outcome !== "accepted")
    throw Error("D2_SQL_FIXTURE_EVIDENCE_FAILED");
  const zip = await readRestrictedZipCore(
    (async function* () {
      yield archive;
    })(),
    {
      signal: new AbortController().signal,
      limits: PACK_LIMITS,
      checkpoint() {},
    },
  );
  const facts = issuePrivateCandidate(result, zip.files).facts;
  const candidate: FrozenCandidate = {
    facts,
    manifestSha256: built.value.report.manifestSha256!,
    contentSha256: built.value.report.contentSha256!,
  };
  const blobs = [
    ...new Map(
      facts.resources.map((r) => [
        r.blobSha256,
        {
          sha256: r.blobSha256,
          bytes: r.bytes,
          mediaType: r.declaration.mediaType,
          width: r.declaration.width,
          height: r.declaration.height,
          frames: 1 as const,
        },
      ]),
    ).values(),
  ];
  return freezeJson({
    productId,
    archiveSha256,
    archiveBytes: archive.length,
    identityText: canonicalP1Json(identity),
    identitySha256: identity.identitySha256,
    archivePolicyVersion: ARCHIVE_POLICY_VERSION,
    archivePolicySha256,
    candidate,
    result,
    owner: { ownerPid: process.pid, ownerNonce: "a".repeat(43) },
    blobs,
  });
}
