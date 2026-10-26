import { synthetic24ContentV3 } from "../../content/v3-synthetic.test-support";
import { readContentMetadata } from "../../content/current";
import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { buildSupportedQuizPack } from "../../package/build";
import { createContentV2Fixture } from "../../content/fixtures.test-support";
import { createSyntheticFixture } from "../../v1/fixtures/synthetic";
import { canonicalP1Json } from "../../v1/canonical";
import { hashBytes } from "../../v1/validate";
import { PACK_LIMITS } from "../../v1/limits";
import type { ContentSchemaVersion } from "../../package/api";
import type {
  MediaOperationContext,
  MediaRuntimeBinding,
  ImageDeclaration,
} from "../media";
import type {
  ExpectedCandidateFacts,
  FrozenValidationEvidence,
} from "./adapter-types";
import type { CandidateResult } from "./private-candidate";
const mocks = vi.hoisted(() => ({
  binding: vi.fn(),
  run: vi.fn(),
  zip: vi.fn(),
}));
vi.mock("../media", async (importActual) => ({
  ...(await importActual<typeof import("../media")>()),
  readMediaRuntimeBinding: mocks.binding,
  runIsolatedImage: mocks.run,
}));
vi.mock("../../v1/zip", async (importActual) => ({
  ...(await importActual<typeof import("../../v1/zip")>()),
  readRestrictedZipCore: mocks.zip,
}));
import {
  createMediaOperationContext,
  disposeMediaOperationContext,
} from "../media";
import { validateArchiveCandidate } from "./engine";
import { prepareValidationIdentity } from "./prepared";
import {
  restoreValidatedCandidate,
  expectedCandidateFactsSchema,
} from "./restore";
import { serializeEvidenceSqlProjection } from "./sql-projection";
import {
  copyCandidateResourceBytes,
  issuePrivateCandidate,
  preparePrivateCandidate,
  issuePreparedCandidate,
} from "./private-candidate";
import { runtimeIdentity, currentRuntimeIdentity } from "./identity";
import {
  sealP1Report,
  sealCurrentReport,
  CURRENT_REPORT_SCHEMA_HASH,
} from "./report";
import { sealCandidateResultEvidence, sealEvidenceEnvelope } from "./contracts";
import { computeCandidateSha256 } from "./candidate-hash";
import { validateQuizPack } from "../../v1/validate";

const binding: MediaRuntimeBinding = {
  schema: "quizpack-media-runtime-binding.v1",
  platform: "darwin-arm64",
  componentId: "a".repeat(64),
  deploymentId: "b".repeat(64),
  runtimeBundleHash: "c".repeat(64),
  limitsHash: "d".repeat(64),
};
const contexts: MediaOperationContext[] = [];
const context = () => {
  const value = createMediaOperationContext({
    signal: new AbortController().signal,
    deadlineMonotonicMs: performance.now() + 60000,
  });
  contexts.push(value);
  return value;
};
const source = async function* (archive: Uint8Array) {
  yield archive;
};
type Accepted = Extract<CandidateResult, { outcome: "accepted" }>;
const matrix: {
  engine: "dimensions" | "archetype";
  version: ContentSchemaVersion;
  kind: "synthetic" | "authored";
  archive: Uint8Array;
}[] = [];
let actualZip: typeof import("../../v1/zip");
function expectedFacts(accepted: Accepted): ExpectedCandidateFacts {
  const { facts } = accepted.candidate;
  if (
    accepted.evidence.report.status !== "sealed" ||
    accepted.evidence.input.status !== "snapshotted"
  )
    throw new Error("fixture");
  return {
    archiveSha256: facts.archiveSha256,
    archiveBytes: accepted.evidence.input.archiveBytes,
    productId: facts.productId,
    packId: facts.packId,
    packVersion: facts.packVersion,
    containerSchemaVersion: facts.manifest.schemaVersion,
    contentSchemaVersion: facts.contentSchemaVersion,
    contentKind: readContentMetadata(facts.content).kind,
    manifestSha256: accepted.evidence.report.value.manifestSha256!,
    contentSha256: accepted.evidence.report.value.contentSha256!,
    canonicalManifestText: facts.canonicalManifestText,
    canonicalManifestSha256: facts.canonicalManifestSha256,
    canonicalContentText: facts.canonicalContentText,
    canonicalContentSha256: facts.canonicalContentSha256,
    assetSetText: facts.assetSetText,
    assetSetSha256: facts.assetSetSha256,
    candidateSha256: facts.candidateSha256,
    resourceCount: facts.resources.length,
  };
}
function frozenEvidence(accepted: Accepted): FrozenValidationEvidence {
  const value = serializeEvidenceSqlProjection(
    {
      schemaVersion: "quizpack-evidence-envelope.v1",
      attempts: [
        {
          attempt: 1,
          result: { outcome: "accepted", evidence: accepted.evidence },
        },
      ],
    },
    "[]",
  );
  if (
    !value.ok ||
    value.value.evidenceText === null ||
    value.value.evidenceSha256 === null ||
    value.value.metadataText === null
  )
    throw new Error("fixture");
  return {
    evidenceText: value.value.evidenceText,
    evidenceSha256: value.value.evidenceSha256,
    reportTexts: value.value.reportTexts,
    metadataText: value.value.metadataText,
    attemptsControlText: value.value.attemptsControlText,
  };
}
async function accept(entry = matrix[0]!): Promise<Accepted> {
  const result = await validateArchiveCandidate(
    entry.archive,
    `synthetic-${entry.engine}`,
    context(),
  );
  expect(result.outcome, JSON.stringify(result.evidence)).toBe("accepted");
  if (result.outcome !== "accepted") throw new Error("fixture");
  return result;
}
async function restoredInput(accepted: Accepted) {
  const operation = context(),
    prepared = await prepareValidationIdentity(operation);
  if (prepared.outcome !== "prepared") throw new Error("fixture");
  return {
    operation,
    input: {
      prepared: prepared.prepared,
      frozenEvidence: frozenEvidence(accepted),
      expectedFacts: expectedFacts(accepted),
    },
  };
}
beforeAll(async () => {
  actualZip =
    await vi.importActual<typeof import("../../v1/zip")>("../../v1/zip");
  for (const engine of ["dimensions", "archetype"] as const) {
    const fixture = await createSyntheticFixture(engine);
    for (const version of [
      "quizpack-content.v1",
      "quizpack-content.v2",
    ] as const) {
      const content =
        version === "quizpack-content.v1"
          ? fixture.content
          : await createContentV2Fixture(engine);
      const assets =
        version === "quizpack-content.v1"
          ? fixture.assets
          : [
              ...fixture.assets,
              {
                path: "assets/neutral-scene.png",
                bytes: fixture.assets[0]!.bytes,
              },
            ];
      for (const kind of ["synthetic", "authored"] as const) {
        content.kind = kind;
        const built = await buildSupportedQuizPack(
          {
            packId: `fixture-${engine}`,
            packVersion: "1.0.0",
            content,
            assets,
          },
          { targetProductId: content.product.productId },
          version,
        );
        if (!built.ok) throw new Error(JSON.stringify(built));
        matrix.push({ engine, version, kind, archive: built.value.archive });
      }
    }
  }
}, 30000);
beforeEach(() => {
  mocks.zip.mockReset().mockImplementation(actualZip.readRestrictedZipCore);
  mocks.binding.mockReset().mockResolvedValue({ outcome: "bound", binding });
  mocks.run
    .mockReset()
    .mockImplementation(
      (_bytes: Uint8Array, declaration: ImageDeclaration) => ({
        outcome: "decoded",
        runId: randomUUID(),
        profileId: "e".repeat(64),
        stopped: "confirmed",
        facts: {
          mediaType: declaration.mediaType,
          width: declaration.width,
          height: declaration.height,
          frames: 1,
          mediaDecoded: true,
        },
      }),
    );
});
afterEach(() => {
  for (const operation of contexts.splice(0))
    disposeMediaOperationContext(operation);
});

describe("supported trusted bridge (real ZIP, mocked platform authority)", () => {
  it("admits and restores v3 raw bytes with current evidence, retaining the nested source and resource owners", async () => {
    const fixture = await synthetic24ContentV3("synthetic-v3-bridge");
    const built = await buildSupportedQuizPack(
      {
        packId: "synthetic-v3-bridge",
        packVersion: "1.0.0",
        content: fixture.content,
        assets: fixture.assets,
      },
      { targetProductId: "synthetic-v3-bridge" },
      "quizpack-content.v3",
    );
    if (!built.ok) throw Error(JSON.stringify(built.issues));
    const result = await validateArchiveCandidate(
      built.value.archive,
      "synthetic-v3-bridge",
      context(),
    );
    expect(result.outcome).toBe("accepted");
    if (result.outcome !== "accepted") throw Error("EXPECTED_ACCEPTED");
    expect(result.candidate.facts.content).toEqual(fixture.content);
    expect(result.candidate.facts.contentSchemaVersion).toBe(
      "quizpack-content.v3",
    );
    expect(result.evidence.identity).toEqual({
      status: "bound",
      value: currentRuntimeIdentity(binding),
    });
    expect(result.evidence.report).toMatchObject({
      status: "sealed",
      value: { schemaVersion: "quizpack-validation.v3", candidateValid: true },
    });
    expect(result.candidate.facts.resources).toHaveLength(
      fixture.assets.length,
    );
    const restore = await restoredInput(result);
    const restored = await restoreValidatedCandidate(
      built.value.archive,
      restore.input,
      restore.operation,
    );
    expect(restored.outcome).toBe("restored");
    if (restored.outcome !== "restored") throw Error("EXPECTED_RESTORED");
    expect(restored.candidate.facts.canonicalContentText).toBe(
      result.candidate.facts.canonicalContentText,
    );
    expect(restored.candidate.facts.candidateSha256).toBe(
      result.candidate.facts.candidateSha256,
    );
  });

  it("validates and restores eight engine/schema/kind combinations from identical raw bytes", async () => {
    for (const entry of matrix) {
      const accepted = await accept(entry),
        facts = accepted.candidate.facts;
      expect(accepted.evidence.identity).toEqual({
        status: "bound",
        value: currentRuntimeIdentity(binding),
      });
      expect(accepted.evidence.report).toMatchObject({
        status: "sealed",
        value: {
          schemaVersion: "quizpack-validation.v3",
          candidateValid: true,
          importable: false,
          publishable: false,
          issues: [],
          issuesTruncated: false,
        },
      });
      if (
        accepted.evidence.identity.status !== "bound" ||
        accepted.evidence.report.status !== "sealed"
      )
        throw new Error("fixture");
      expect(accepted.evidence.identity.value.reportSchemaHash).toBe(
        CURRENT_REPORT_SCHEMA_HASH,
      );
      expect(accepted.evidence.report.value.unverified).toHaveLength(5);
      expect(facts.contentSchemaVersion).toBe(entry.version);
      expect(facts.manifest.contentSchemaVersion).toBe(entry.version);
      expect(facts.content.schemaVersion).toBe(entry.version);
      expect(readContentMetadata(facts.content).kind).toBe(entry.kind);
      expect(facts.archiveSha256).toBe(hashBytes(entry.archive));
      expect(facts.candidateSha256).toBe(
        computeCandidateSha256({
          archiveSha256: facts.archiveSha256,
          canonicalManifestSha256: facts.canonicalManifestSha256,
          canonicalContentSha256: facts.canonicalContentSha256,
          assetSetSha256: facts.assetSetSha256,
          identitySha256: accepted.evidence.identity.value.identitySha256,
        }),
      );
      const zip = await actualZip.readRestrictedZipCore(source(entry.archive), {
        signal: new AbortController().signal,
        limits: PACK_LIMITS,
        checkpoint: () => {},
      });
      expect(accepted.evidence.report.value.manifestSha256).toBe(
        hashBytes(zip.files.get("manifest.json")!),
      );
      expect(accepted.evidence.report.value.contentSha256).toBe(
        hashBytes(zip.files.get("content.json")!),
      );
      expect(facts.canonicalContentText).toBe(canonicalP1Json(facts.content));
      expect(facts.canonicalManifestText).toBe(
        canonicalP1Json(facts.manifest, "manifest"),
      );
      const { operation, input } = await restoredInput(accepted);
      expect(expectedCandidateFactsSchema.parse(input.expectedFacts)).toEqual(
        input.expectedFacts,
      );
      const frozenBefore = JSON.stringify(input.frozenEvidence),
        calls = mocks.binding.mock.calls.length;
      mocks.binding.mockImplementation(() => {
        throw new Error("No runtime read during restore");
      });
      mocks.run.mockImplementation(() => {
        throw new Error("No decoder during restore");
      });
      const restored = await restoreValidatedCandidate(
        entry.archive,
        input,
        operation,
      );
      expect(restored.outcome).toBe("restored");
      if (restored.outcome !== "restored") throw new Error("fixture");
      expect(restored.candidate.facts).toEqual(facts);
      expect(mocks.binding).toHaveBeenCalledTimes(calls);
      expect(JSON.stringify(input.frozenEvidence)).toBe(frozenBefore);
      for (const [i, resource] of facts.resources.entries()) {
        const copy = copyCandidateResourceBytes(restored.candidate, i);
        expect(hashBytes(copy)).toBe(resource.blobSha256);
        copy.fill(0);
        expect(
          hashBytes(copyCandidateResourceBytes(restored.candidate, i)),
        ).toBe(resource.blobSha256);
      }
      expect(() => JSON.stringify(restored.candidate)).toThrow();
      expect(Object.isFrozen(facts.content)).toBe(true);
      mocks.binding.mockResolvedValue({ outcome: "bound", binding });
      mocks.run.mockImplementation(
        (_bytes: Uint8Array, declaration: ImageDeclaration) => ({
          outcome: "decoded",
          runId: randomUUID(),
          profileId: "e".repeat(64),
          stopped: "confirmed",
          facts: {
            mediaType: declaration.mediaType,
            width: declaration.width,
            height: declaration.height,
            frames: 1,
            mediaDecoded: true,
          },
        }),
      );
    }
  }, 30000);
  it("keeps old evidence readable but rejects it against current prepared identity before ZIP IO", async () => {
    const accepted = await accept();
    const report = await validateQuizPack(source(matrix[0]!.archive), {
      targetProductId: "synthetic-dimensions",
    });
    const old = sealCandidateResultEvidence({
      outcome: "accepted",
      evidence: {
        ...accepted.evidence,
        identity: { status: "bound", value: runtimeIdentity(binding) },
        report: sealP1Report(report),
      },
    });
    if (old.outcome !== "accepted") throw new Error("fixture");
    const zip = await actualZip.readRestrictedZipCore(
      source(matrix[0]!.archive),
      {
        signal: new AbortController().signal,
        limits: PACK_LIMITS,
        checkpoint: () => {},
      },
    );
    const oldAccepted = {
      ...old,
      candidate: issuePrivateCandidate(old, zip.files),
    };
    expect(
      sealEvidenceEnvelope({
        schemaVersion: "quizpack-evidence-envelope.v1",
        attempts: [{ attempt: 1, result: old }],
      }).attempts[0]?.result,
    ).toEqual(old);
    const { operation, input } = await restoredInput(oldAccepted);
    const zipCalls = mocks.zip.mock.calls.length;
    expect(
      await restoreValidatedCandidate(matrix[0]!.archive, input, operation),
    ).toMatchObject({ outcome: "unavailable", code: "REVALIDATION_REQUIRED" });
    expect(mocks.zip).toHaveBeenCalledTimes(zipCalls);
  });
  it("rejects changed version/kind, canonical text, raw JSON hash, asset set and runtime identity", async () => {
    const entry = matrix.find(
        (item) =>
          item.version === "quizpack-content.v2" && item.kind === "authored",
      )!,
      accepted = await accept(entry);
    for (const patch of [
      { contentSchemaVersion: "quizpack-content.v1" as const },
      { contentKind: "synthetic" as const },
      {
        canonicalContentText:
          accepted.candidate.facts.canonicalContentText + " ",
      },
      { contentSha256: "f".repeat(64) },
      { assetSetSha256: "f".repeat(64) },
    ]) {
      const { operation, input } = await restoredInput(accepted);
      expect(
        await restoreValidatedCandidate(
          entry.archive,
          { ...input, expectedFacts: { ...input.expectedFacts, ...patch } },
          operation,
        ),
      ).toMatchObject({
        outcome: "unavailable",
        code: "FROZEN_FACTS_MISMATCH",
      });
    }
    mocks.binding.mockResolvedValue({
      outcome: "bound",
      binding: { ...binding, runtimeBundleHash: "f".repeat(64) },
    });
    const { operation, input } = await restoredInput(accepted),
      zipCalls = mocks.zip.mock.calls.length;
    expect(
      await restoreValidatedCandidate(entry.archive, input, operation),
    ).toMatchObject({ outcome: "unavailable", code: "REVALIDATION_REQUIRED" });
    expect(mocks.zip).toHaveBeenCalledTimes(zipCalls);
  });
  it("issues new handles only for exact report-bound raw files and never from serialized facts", async () => {
    const entry = matrix.find(
        (item) =>
          item.version === "quizpack-content.v2" && item.kind === "authored",
      )!,
      accepted = await accept(entry);
    const zip = await actualZip.readRestrictedZipCore(source(entry.archive), {
      signal: new AbortController().signal,
      limits: PACK_LIMITS,
      checkpoint: () => {},
    });
    const facts = preparePrivateCandidate(
      { outcome: "accepted", evidence: accepted.evidence },
      zip.files,
    );
    expect(() =>
      issuePreparedCandidate(JSON.parse(JSON.stringify(facts))),
    ).toThrow();
    expect(issuePreparedCandidate(facts).facts).toEqual(
      accepted.candidate.facts,
    );
    expect(() => issuePreparedCandidate(facts)).toThrow();
    const changed = new Map(zip.files);
    changed.set("content.json", Buffer.from(facts.canonicalContentText + " "));
    expect(() =>
      preparePrivateCandidate(
        { outcome: "accepted", evidence: accepted.evidence },
        changed,
      ),
    ).toThrow();
    const forged = structuredClone(accepted.evidence);
    if (forged.report.status !== "sealed") throw new Error("fixture");
    forged.report = sealCurrentReport({
      ...forged.report.value,
      contentSha256: hashBytes(changed.get("content.json")!),
    });
    // Updating the report's raw hash alone cannot bypass manifest/file integrity.
    expect(() =>
      preparePrivateCandidate(
        { outcome: "accepted", evidence: forged },
        changed,
      ),
    ).toThrow();
  });
});
