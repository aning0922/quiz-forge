import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import {
  beforeAll,
  beforeEach,
  afterEach,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import { buildQuizPack } from "../../v1/build";
import { createSyntheticFixture } from "../../v1/fixtures/synthetic";
import { canonicalP1Json } from "../../v1/canonical";
import {
  type MediaOperationContext,
  type MediaRuntimeBinding,
  type ImageDeclaration,
} from "../media";
const mocks = vi.hoisted(() => ({
  binding: vi.fn(),
  run: vi.fn(),
  zipCore: vi.fn(),
}));
vi.mock("../media", async (importActual) => ({
  ...(await importActual<typeof import("../media")>()),
  readMediaRuntimeBinding: mocks.binding,
  runIsolatedImage: mocks.run,
}));
vi.mock("../../v1/zip", async (importActual) => ({
  ...(await importActual<typeof import("../../v1/zip")>()),
  readRestrictedZipCore: mocks.zipCore,
}));
import {
  createMediaOperationContext,
  disposeMediaOperationContext,
  readMediaOperationState,
  requestMediaOperationStop,
} from "../media";
import {
  prepareValidationIdentity,
  PreparedValidationIdentity,
  consumePreparedIdentity,
} from "./prepared";
import { createValidationOperationScope } from "./operation-scope";
import { serializeEvidenceSqlProjection } from "./sql-projection";
import { validateArchiveCandidate } from "./engine";
import type { CandidateResult } from "./private-candidate";
import { sealEvidenceEnvelope } from "./contracts";
import { restoreValidatedCandidate } from "./restore";
import {
  copyCandidateResourceBytes,
  preparePrivateCandidate,
  issuePreparedCandidate,
} from "./private-candidate";
import type {
  ExpectedCandidateFacts,
  FrozenValidationEvidence,
  RestoreCandidateInput,
} from "./adapter-types";
import { createStoredArchive } from "../../v1/build";
import { PACK_LIMITS } from "../../v1/limits";

const binding: MediaRuntimeBinding = {
  schema: "quizpack-media-runtime-binding.v1",
  platform: "darwin-arm64",
  componentId: "a".repeat(64),
  deploymentId: "b".repeat(64),
  runtimeBundleHash: "c".repeat(64),
  limitsHash: "d".repeat(64),
};
const contexts: MediaOperationContext[] = [];
const context = (deadline = performance.now() + 60000) => {
  const ctx = createMediaOperationContext({
    signal: new AbortController().signal,
    deadlineMonotonicMs: deadline,
  });
  contexts.push(ctx);
  return ctx;
};
let accepted: Extract<CandidateResult, { outcome: "accepted" }>;
let archive: Uint8Array;
let actualZip: typeof import("../../v1/zip");
beforeAll(async () => {
  actualZip =
    await vi.importActual<typeof import("../../v1/zip")>("../../v1/zip");
  mocks.zipCore.mockImplementation(actualZip.readRestrictedZipCore);
  mocks.binding.mockResolvedValue({ outcome: "bound", binding });
  mocks.run.mockImplementation(
    (_bytes: Uint8Array, declaration: ImageDeclaration) => ({
      outcome: "decoded",
      runId: randomUUID(),
      profileId: "e".repeat(64),
      facts: {
        mediaType: declaration.mediaType,
        width: declaration.width,
        height: declaration.height,
        frames: 1,
        mediaDecoded: true,
      },
      stopped: "confirmed",
    }),
  );
  const fixture = await createSyntheticFixture("dimensions");
  const built = await buildQuizPack(
    {
      packId: "synthetic-pack",
      packVersion: "1.0.0",
      content: fixture.content,
      assets: fixture.assets,
    },
    { targetProductId: fixture.content.product.productId },
  );
  if (!built.ok) throw new Error("Synthetic build rejected.");
  archive = built.value.archive;
  const result = await validateArchiveCandidate(
    archive,
    fixture.content.product.productId,
    context(),
  );
  if (result.outcome !== "accepted")
    throw new Error("Synthetic validation rejected.");
  accepted = result;
});
beforeEach(() => {
  mocks.binding.mockReset().mockResolvedValue({ outcome: "bound", binding });
  mocks.run.mockClear();
  mocks.zipCore.mockReset().mockImplementation(actualZip.readRestrictedZipCore);
});
afterEach(() => {
  for (const ctx of contexts.splice(0)) disposeMediaOperationContext(ctx);
});
const envelope = () => ({
  schemaVersion: "quizpack-evidence-envelope.v1",
  attempts: [
    {
      attempt: 1,
      result: { outcome: "accepted", evidence: accepted.evidence },
    },
  ],
});

describe("prepared same-context identity", () => {
  it("prepares a private handle without archive/decoder IO and leaves caller context active", async () => {
    const ctx = context(),
      result = await prepareValidationIdentity(ctx);
    expect(result.outcome).toBe("prepared");
    expect(mocks.binding).toHaveBeenCalledTimes(1);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(readMediaOperationState(ctx).phase).toBe("active");
    if (result.outcome !== "prepared") return;
    expect(() => JSON.stringify(result)).toThrow();
    expect(
      consumePreparedIdentity(
        result.prepared,
        createValidationOperationScope(ctx),
      ),
    ).toEqual(result.identity);
    expect(() =>
      consumePreparedIdentity(
        result.prepared,
        createValidationOperationScope(ctx),
      ),
    ).toThrow();
  });
  it("rejects forged/structural/cross-context/stopping handles", async () => {
    expect(() => new PreparedValidationIdentity({})).toThrow();
    const ctx = context(),
      result = await prepareValidationIdentity(ctx);
    if (result.outcome !== "prepared") throw new Error("Preparation rejected.");
    expect(() =>
      consumePreparedIdentity(
        {} as PreparedValidationIdentity,
        createValidationOperationScope(ctx),
      ),
    ).toThrow();
    expect(() =>
      consumePreparedIdentity(
        result.prepared,
        createValidationOperationScope(context()),
      ),
    ).toThrow();
    requestMediaOperationStop(ctx, "CANCELLED");
    expect(() =>
      consumePreparedIdentity(
        result.prepared,
        createValidationOperationScope(ctx),
      ),
    ).toThrow();
  });
  it("finite isolation unavailable is settled, unlike malformed/rejected binding", async () => {
    mocks.binding.mockResolvedValueOnce({
      outcome: "unavailable",
      code: "ISOLATION_UNAVAILABLE",
    });
    const finite = await prepareValidationIdentity(context());
    expect(finite).toMatchObject({
      outcome: "interrupted",
      code: "RUNTIME_IDENTITY_UNAVAILABLE",
      completion: {
        mediaStopped: "not-started",
        relatedIo: "settled",
        maintenanceRequired: false,
      },
    });
    for (const raw of [
      { outcome: "bound", binding: {} },
      { outcome: "unavailable", code: "invented" },
    ]) {
      mocks.binding.mockResolvedValueOnce(raw);
      expect(await prepareValidationIdentity(context())).toMatchObject({
        outcome: "interrupted",
        code: "MEDIA_STOP_UNCONFIRMED",
        completion: {
          mediaStopped: "unknown",
          relatedIo: "unconfirmed",
          maintenanceRequired: true,
        },
      });
    }
    mocks.binding.mockRejectedValueOnce(new Error("synthetic failure"));
    expect(await prepareValidationIdentity(context())).toMatchObject({
      outcome: "interrupted",
      code: "MEDIA_STOP_UNCONFIRMED",
      runtimeFailure: "STOP_UNCONFIRMED",
    });
  });
  it("preserves authoritative unknown before a simultaneous storage lock checkpoint", async () => {
    const ctx = context();
    mocks.binding.mockImplementationOnce(() => {
      requestMediaOperationStop(ctx, "STORAGE_LOCK_LOST");
      return { outcome: "unavailable", code: "STOP_UNCONFIRMED" };
    });
    expect(await prepareValidationIdentity(ctx)).toMatchObject({
      outcome: "interrupted",
      code: "MEDIA_STOP_UNCONFIRMED",
      completion: {
        mediaStopped: "unknown",
        relatedIo: "unconfirmed",
        maintenanceRequired: true,
      },
    });
  });
  it("does not issue binding for an already expired or unknown context", async () => {
    const expired = context(performance.now() - 1);
    expect(await prepareValidationIdentity(expired)).toMatchObject({
      outcome: "interrupted",
      code: "OPERATION_TIMEOUT",
    });
    const unknown = context();
    requestMediaOperationStop(unknown, "STOP_UNCONFIRMED");
    expect(await prepareValidationIdentity(unknown)).toMatchObject({
      outcome: "interrupted",
      code: "MEDIA_STOP_UNCONFIRMED",
    });
    expect(mocks.binding).not.toHaveBeenCalled();
  });
  it("cleanup timeout stays unknown despite a later resolving outer binding", async () => {
    const ctx = context();
    let resolve!: (value: unknown) => void;
    mocks.binding.mockReturnValueOnce(
      new Promise((r) => {
        resolve = r;
      }),
    );
    const task = prepareValidationIdentity(ctx);
    requestMediaOperationStop(ctx, "CANCELLED", performance.now() + 15);
    const result = await task;
    expect(result).toMatchObject({
      outcome: "interrupted",
      completion: { relatedIo: "unconfirmed", maintenanceRequired: true },
    });
    expect(result).not.toHaveProperty("prepared");
    resolve({ outcome: "bound", binding });
    await new Promise((r) => setImmediate(r));
    expect(result).toMatchObject({
      completion: { relatedIo: "unconfirmed", maintenanceRequired: true },
    });
  });
});

describe("canonical SQL evidence projection", () => {
  it("retains exact sealed report text/hash and value:null metadata without duplicate payload", () => {
    const controls = canonicalP1Json([
      {
        attemptId: randomUUID(),
        ordinal: 1,
        fence: 1,
        ownerPid: 123,
        ownerNonce: "a".repeat(43),
        kind: "validate",
        reservationBytes: 134283264,
        disposition: "held",
        mediaStop: "confirmed",
      },
    ]);
    const result = serializeEvidenceSqlProjection(envelope(), controls);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.reportTexts).toEqual([
      canonicalP1Json(
        accepted.evidence.report.status === "sealed"
          ? accepted.evidence.report.value
          : null,
      ),
    ]);
    expect(
      JSON.parse(result.value.metadataText!).attempts[0].result.evidence.report
        .value,
    ).toBeNull();
    expect(result.value.measuredBytes.attemptControls).toBe(
      Buffer.byteLength(controls),
    );
    expect(result.value.measuredBytes.reportPayload).toBe(
      Buffer.byteLength(result.value.reportTexts[0]!),
    );
    expect(Object.isFrozen(result.value.reportTexts)).toBe(true);
  });
  it("supports null evidence and exactly 8KiB controls, rejects +1/noncanonical/duplicate keys/Unicode", () => {
    const controls = JSON.stringify("x".repeat(8190));
    expect(serializeEvidenceSqlProjection(null, controls)).toMatchObject({
      ok: true,
      value: {
        evidenceText: null,
        evidenceSha256: null,
        reportTexts: [],
        metadataText: null,
        measuredBytes: { attemptControls: 8192 },
      },
    });
    expect(
      serializeEvidenceSqlProjection(null, JSON.stringify("x".repeat(8191))),
    ).toEqual({ ok: false, code: "EVIDENCE_METADATA_SIZE_LIMIT" });
    for (const text of ['{"x":1,"x":2}', "[ ]", '"\\u0000"', '"\\ud800"'])
      expect(serializeEvidenceSqlProjection(null, text).ok).toBe(false);
  });
  it("charges controls against the same hard 64KiB metadata bound for 3x64 facts", () => {
    const input = {
      schemaVersion: "quizpack-evidence-envelope.v1",
      attempts: [1, 2, 3].map((attempt) => ({
        attempt,
        result: {
          outcome: "accepted",
          evidence: {
            ...accepted.evidence,
            media: Array.from({ length: 64 }, (_, resourceIndex) => ({
              resourceIndex,
              result: {
                outcome: "decoded",
                runId: `00000000-0000-4000-8000-${(attempt * 64 + resourceIndex).toString(16).padStart(12, "0")}`,
                profileId: "e".repeat(64),
                facts: {
                  mediaType: "image/jpeg",
                  width: 8192,
                  height: 1953,
                  frames: 1,
                  mediaDecoded: true,
                },
                stopped: "confirmed",
              },
            })),
          },
        },
      })),
    };
    const sealed = sealEvidenceEnvelope(input),
      base = serializeEvidenceSqlProjection(sealed, "[]");
    expect(base.ok).toBe(true);
    if (!base.ok) return;
    const available = 65536 - base.value.measuredBytes.metadata;
    expect(available).toBeGreaterThanOrEqual(2);
    expect(available).toBeLessThan(8192);
    const exact = serializeEvidenceSqlProjection(
      sealed,
      JSON.stringify("x".repeat(available - 2)),
    );
    expect(exact.ok).toBe(true);
    expect(
      serializeEvidenceSqlProjection(
        sealed,
        JSON.stringify("x".repeat(available - 1)),
      ),
    ).toEqual({ ok: false, code: "EVIDENCE_METADATA_SIZE_LIMIT" });
  });
  it("rejects forged report/hash and accessor inputs without invoking getters", () => {
    const original = envelope(),
      changed = structuredClone(original);
    if (changed.attempts[0]!.result.evidence.report.status === "sealed")
      changed.attempts[0]!.result.evidence.report.sha256 = "f".repeat(64);
    expect(serializeEvidenceSqlProjection(changed, "[]").ok).toBe(false);
    const getter = vi.fn();
    expect(
      serializeEvidenceSqlProjection(
        {
          get attempts() {
            getter();
            return [];
          },
        },
        "[]",
      ).ok,
    ).toBe(false);
    expect(getter).not.toHaveBeenCalled();
  });
});

function expectedFacts(): ExpectedCandidateFacts {
  const facts = accepted.candidate.facts;
  if (facts.content.kind !== "synthetic")
    throw new Error("Synthetic content required.");
  if (accepted.evidence.report.status !== "sealed")
    throw new Error("Synthetic report unavailable.");
  return {
    archiveSha256: facts.archiveSha256,
    archiveBytes: archive.byteLength,
    productId: facts.productId,
    packId: facts.packId,
    packVersion: facts.packVersion,
    containerSchemaVersion: facts.manifest.schemaVersion,
    contentSchemaVersion: facts.content.schemaVersion,
    contentKind: facts.content.kind,
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
function frozenEvidence(): FrozenValidationEvidence {
  const result = serializeEvidenceSqlProjection(envelope(), "[]");
  if (
    !result.ok ||
    result.value.evidenceText === null ||
    result.value.evidenceSha256 === null ||
    result.value.metadataText === null
  )
    throw new Error("Synthetic projection rejected.");
  return {
    evidenceText: result.value.evidenceText,
    evidenceSha256: result.value.evidenceSha256,
    metadataText: result.value.metadataText,
    reportTexts: result.value.reportTexts,
    attemptsControlText: result.value.attemptsControlText,
  };
}
async function restoration() {
  const ctx = context(),
    prepared = await prepareValidationIdentity(ctx);
  if (prepared.outcome !== "prepared")
    throw new Error("Synthetic preparation rejected.");
  const input: RestoreCandidateInput = {
    prepared: prepared.prepared,
    frozenEvidence: frozenEvidence(),
    expectedFacts: expectedFacts(),
  };
  mocks.binding.mockImplementation(() => {
    throw new Error("Binding forbidden after claim.");
  });
  mocks.run.mockImplementation(() => {
    throw new Error("Decoder forbidden during restore.");
  });
  return { ctx, input };
}
describe("same-original-archive restoration", () => {
  it("restores exact frozen facts and private resource copies without postclaim platform IO/new report", async () => {
    const { ctx, input } = await restoration();
    const bindingCalls = mocks.binding.mock.calls.length,
      reports = JSON.stringify(input.frozenEvidence);
    const result = await restoreValidatedCandidate(archive, input, ctx);
    expect(result.outcome).toBe("restored");
    expect(result.completion).toEqual({
      mediaStopped: "not-started",
      relatedIo: "settled",
      maintenanceRequired: false,
    });
    expect(mocks.binding).toHaveBeenCalledTimes(bindingCalls);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(JSON.stringify(input.frozenEvidence)).toBe(reports);
    expect(readMediaOperationState(ctx).phase).toBe("active");
    if (result.outcome !== "restored") return;
    expect(result.candidate.facts).toEqual(accepted.candidate.facts);
    const copy = copyCandidateResourceBytes(result.candidate, 0),
      original = copyCandidateResourceBytes(result.candidate, 0);
    copy[0] = copy[0]! ^ 1;
    expect(copyCandidateResourceBytes(result.candidate, 0)).toEqual(original);
    expect(() => JSON.stringify(result.candidate)).toThrow();
    expect(await restoreValidatedCandidate(archive, input, ctx)).toMatchObject({
      outcome: "interrupted",
      code: "INVALID_CONTEXT",
    });
  });
  it.each([
    "canonicalManifestText",
    "canonicalContentText",
    "assetSetText",
    "canonicalManifestSha256",
    "canonicalContentSha256",
    "assetSetSha256",
    "candidateSha256",
    "manifestSha256",
    "contentSha256",
    "packId",
    "resourceCount",
  ] as const)(
    "rejects changed frozen %s before candidate issuance",
    async (key) => {
      const { ctx, input } = await restoration();
      const value = input.expectedFacts[key];
      const changed = {
        ...input.expectedFacts,
        [key]:
          typeof value === "number"
            ? value + 1
            : key.endsWith("Text")
              ? value + " "
              : key.endsWith("Sha256")
                ? "f".repeat(64)
                : "foreign-pack",
      };
      expect(
        await restoreValidatedCandidate(
          archive,
          { ...input, expectedFacts: changed },
          ctx,
        ),
      ).toMatchObject({
        outcome: "unavailable",
        code: "FROZEN_FACTS_MISMATCH",
      });
      expect(mocks.run).not.toHaveBeenCalled();
    },
  );
  it.each([
    "evidenceSha256",
    "metadataText",
    "reportTexts",
    "attemptsControlText",
  ] as const)(
    "rejects corrupted original evidence projection %s",
    async (key) => {
      const { ctx, input } = await restoration();
      const changed = {
        ...input.frozenEvidence,
        [key]:
          key === "evidenceSha256"
            ? "f".repeat(64)
            : key === "reportTexts"
              ? ["{}"]
              : key === "attemptsControlText"
                ? "[ ]"
                : "{}",
      };
      expect(
        await restoreValidatedCandidate(
          archive,
          { ...input, frozenEvidence: changed },
          ctx,
        ),
      ).toMatchObject({
        outcome: "unavailable",
        code: "FROZEN_EVIDENCE_INVALID",
      });
      expect(mocks.zipCore).not.toHaveBeenCalled();
    },
  );
  it("refuses old runtime identity before any archive parsing", async () => {
    mocks.binding.mockResolvedValue({
      outcome: "bound",
      binding: { ...binding, runtimeBundleHash: "f".repeat(64) },
    });
    const { ctx, input } = await restoration();
    expect(await restoreValidatedCandidate(archive, input, ctx)).toMatchObject({
      outcome: "unavailable",
      code: "REVALIDATION_REQUIRED",
    });
    expect(mocks.zipCore).not.toHaveBeenCalled();
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("rejects changed raw bytes and semantically same JSON repacked into different raw archive", async () => {
    const bytes = Buffer.from(archive);
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 1;
    const first = await restoration();
    expect(
      await restoreValidatedCandidate(bytes, first.input, first.ctx),
    ).toMatchObject({
      outcome: "unavailable",
      code: "ARCHIVE_BINDING_MISMATCH",
    });
    mocks.binding.mockResolvedValue({ outcome: "bound", binding });
    const zip = await actualZip.readRestrictedZipCore(
      (async function* () {
        yield archive;
      })(),
      {
        signal: new AbortController().signal,
        limits: PACK_LIMITS,
        checkpoint: () => {},
      },
    );
    const files = new Map(zip.files);
    files.set(
      "content.json",
      Buffer.from(
        JSON.stringify(
          JSON.parse(files.get("content.json")!.toString()),
          null,
          2,
        ),
      ),
    );
    const repacked = await createStoredArchive(
      [...files].map(([path, bytes]) => ({ path, bytes })),
      PACK_LIMITS.archiveBytes,
      new AbortController().signal,
    );
    const second = await restoration();
    expect(
      await restoreValidatedCandidate(repacked, second.input, second.ctx),
    ).toMatchObject({
      outcome: "unavailable",
      code: "ARCHIVE_BINDING_MISMATCH",
    });
    expect(mocks.zipCore).not.toHaveBeenCalled();
  });
  it("rejects structural/accessor/proxy handle and facts inputs without executing getters", async () => {
    const { ctx, input } = await restoration(),
      getter = vi.fn();
    const facts = {
      ...input.expectedFacts,
      get packId() {
        getter();
        return "foreign";
      },
    };
    expect(
      await restoreValidatedCandidate(
        archive,
        { ...input, expectedFacts: facts },
        ctx,
      ),
    ).toMatchObject({ outcome: "unavailable", code: "FROZEN_FACTS_MISMATCH" });
    expect(getter).not.toHaveBeenCalled();
    expect(
      await restoreValidatedCandidate(
        archive,
        { ...input, prepared: {} as PreparedValidationIdentity },
        context(),
      ),
    ).toMatchObject({ outcome: "interrupted", code: "INVALID_CONTEXT" });
  });
  it("late inflater close remains unconfirmed and cannot issue a candidate after cleanup expires", async () => {
    const { ctx, input } = await restoration();
    let close!: () => void;
    const pendingClose = new Promise<void>((r) => {
      close = r;
    });
    mocks.zipCore.mockImplementationOnce(
      async (...args: Parameters<typeof actualZip.readRestrictedZipCore>) => {
        args[1].trackIo?.(pendingClose);
        return actualZip.readRestrictedZipCore(...args);
      },
    );
    const task = restoreValidatedCandidate(archive, input, ctx);
    setTimeout(
      () => requestMediaOperationStop(ctx, "CANCELLED", performance.now() + 15),
      5,
    );
    const result = await task;
    expect(result).toMatchObject({
      outcome: "interrupted",
      code: "RELATED_IO_UNCONFIRMED",
      completion: {
        mediaStopped: "not-started",
        relatedIo: "unconfirmed",
        maintenanceRequired: true,
      },
    });
    expect(result).not.toHaveProperty("candidate");
    close();
    await new Promise((r) => setImmediate(r));
    expect(result.completion.relatedIo).toBe("unconfirmed");
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("defers private candidate publication and rejects serialized prepared facts", async () => {
    const zip = await actualZip.readRestrictedZipCore(
      (async function* () {
        yield archive;
      })(),
      {
        signal: new AbortController().signal,
        limits: PACK_LIMITS,
        checkpoint: () => {},
      },
    );
    const evidence = {
      outcome: "accepted" as const,
      evidence: accepted.evidence,
    };
    const facts = preparePrivateCandidate(evidence, zip.files);
    expect(() =>
      issuePreparedCandidate(JSON.parse(JSON.stringify(facts))),
    ).toThrow();
    expect(issuePreparedCandidate(facts).facts).toEqual(
      accepted.candidate.facts,
    );
    expect(() => issuePreparedCandidate(facts)).toThrow();
  });
});

describe("adapter final budget and ownership", () => {
  it("does not issue prepared authority for a positive binding observed after the business deadline", async () => {
    const ctx = context(performance.now() + 30);
    mocks.binding.mockImplementationOnce(async () => {
      await new Promise((r) => setTimeout(r, 45));
      return { outcome: "bound", binding };
    });
    const result = await prepareValidationIdentity(ctx);
    expect(result).toMatchObject({
      outcome: "interrupted",
      code: "OPERATION_TIMEOUT",
    });
    expect(result).not.toHaveProperty("prepared");
  });
  it("owns the original raw snapshot before the first restoration await", async () => {
    const { ctx, input } = await restoration(),
      raw = Buffer.from(archive);
    const task = restoreValidatedCandidate(raw, input, ctx);
    raw[0] = raw[0]! ^ 1;
    const result = await task;
    expect(result.outcome).toBe("restored");
    if (result.outcome === "restored")
      expect(result.candidate.facts.archiveSha256).toBe(
        input.expectedFacts.archiveSha256,
      );
  });
  it("an expired operation after final ZIP IO cannot restart authority or issue candidate", async () => {
    const ctx = context(performance.now() + 80),
      prepared = await prepareValidationIdentity(ctx);
    if (prepared.outcome !== "prepared")
      throw new Error("Synthetic preparation rejected.");
    mocks.zipCore.mockImplementationOnce(
      async (...args: Parameters<typeof actualZip.readRestrictedZipCore>) => {
        const result = await actualZip.readRestrictedZipCore(...args);
        while (performance.now() <= ctx.deadlineMonotonicMs + 10) {
          /* Last real IO observation is late. */
        }
        return result;
      },
    );
    const result = await restoreValidatedCandidate(
      archive,
      {
        prepared: prepared.prepared,
        frozenEvidence: frozenEvidence(),
        expectedFacts: expectedFacts(),
      },
      ctx,
    );
    expect(result).toMatchObject({
      outcome: "interrupted",
      code: "OPERATION_TIMEOUT",
    });
    expect(result).not.toHaveProperty("candidate");
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
