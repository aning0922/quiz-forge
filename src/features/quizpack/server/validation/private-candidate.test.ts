import { REPORT_SCHEMA_HASH } from "./report";
import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { buildQuizPack } from "../../v1/build";
import { canonicalP1Json } from "../../v1/canonical";
import { createSyntheticFixture } from "../../v1/fixtures/synthetic";
import { hashBytes } from "../../v1/validate";
import { readRestrictedZip } from "../../v1/zip";
import { sealCandidateResultEvidence } from "./contracts";
import { issuePrivateCandidate } from "./private-candidate";
import { sealP1Report } from "./report";
import { EvidenceError } from "./unicode";

describe("same-source private candidate issuance", () => {
  it("derives every fact solely from report-bound raw files, ignoring extra parsed objects", async () => {
    const fixture = await createSyntheticFixture("dimensions");
    const targetProductId = fixture.content.product.productId;
    const built = await buildQuizPack(
      {
        packId: "synthetic-pack",
        packVersion: "1.0.0",
        content: fixture.content,
        assets: fixture.assets,
      },
      { targetProductId },
    );
    if (!built.ok) throw new Error("Synthetic baseline build rejected.");
    const source = async function* () {
      yield built.value.archive;
    };
    const zip = await readRestrictedZip(source(), { targetProductId });
    if (!zip.ok) throw new Error("Synthetic baseline ZIP rejected.");
    const hash = "a".repeat(64);
    const identityPayload = {
      schemaVersion: "quizpack-validation-identity.v1",
      validatorVersion: "1.0.0",
      policyId: "quizpack-local-p1.v1",
      validatorBundleSha256: hash,
      compatibilityPolicyHash: built.value.report.compatibilityPolicyHash,
      effectiveLimitsHash: built.value.report.effectiveLimitsHash,
      persistencePolicyVersion: "quizpack-persistence-policy.v1",
      persistencePolicyHash: hash,
      reportSchemaVersion: "quizpack-validation.v1",
      reportSchemaHash: REPORT_SCHEMA_HASH,
      runtime: {
        schema: "quizpack-media-runtime-binding.v1",
        platform: "darwin-arm64",
        componentId: hash,
        deploymentId: hash,
        runtimeBundleHash: hash,
        limitsHash: hash,
      },
    };
    const sealed = sealCandidateResultEvidence({
      outcome: "accepted",
      evidence: {
        schemaVersion: "quizpack-candidate-evidence.v1",
        input: {
          status: "snapshotted",
          archiveSha256: hashBytes(built.value.archive),
          archiveBytes: built.value.archive.length,
          targetProductId,
        },
        identity: {
          status: "bound",
          value: {
            ...identityPayload,
            identitySha256: hashBytes(canonicalP1Json(identityPayload)),
          },
        },
        report: sealP1Report(built.value.report),
        policy: { status: "passed" },
        runtimeFailure: null,
        media: fixture.content.resources.map((resource, resourceIndex) => ({
          resourceIndex,
          result: {
            outcome: "decoded",
            runId: randomUUID(),
            profileId: hash,
            stopped: "confirmed",
            facts: {
              mediaType: resource.mediaType,
              width: resource.width,
              height: resource.height,
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
      },
    });
    if (sealed.outcome !== "accepted")
      throw new Error("Synthetic evidence rejected.");
    const forgedManifest = JSON.parse(
      zip.value.files.get("manifest.json")!.toString(),
    );
    const forgedContent = structuredClone(fixture.content);
    forgedManifest.packVersion = "9.9.9";
    forgedContent.product.title = "changed synthetic title";
    forgedContent.resources[0]!.productId = "foreign-product";
    const candidate = Reflect.apply(issuePrivateCandidate, undefined, [
      sealed,
      zip.value.files,
      forgedManifest,
      forgedContent,
    ]);
    expect(candidate.facts.packVersion).toBe("1.0.0");
    expect(candidate.facts.content.product.title).toBe(
      fixture.content.product.title,
    );
    expect(candidate.facts.content.resources[0]!.productId).toBe(
      targetProductId,
    );
    // Former independent-object signature is rejected as it is not a raw-file map.
    expect(() =>
      Reflect.apply(issuePrivateCandidate, undefined, [
        sealed,
        forgedManifest,
        forgedContent,
        zip.value.files,
      ]),
    ).toThrow(EvidenceError);
    const changedFiles = new Map(zip.value.files);
    changedFiles.set(
      "manifest.json",
      Buffer.from(JSON.stringify(forgedManifest)),
    );
    expect(() => issuePrivateCandidate(sealed, changedFiles)).toThrow(
      EvidenceError,
    );
  });
});
