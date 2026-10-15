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
import { buildQuizPack, createStoredArchive } from "../../v1/build";
import { canonicalP1Json } from "../../v1/canonical";
import { createSyntheticFixture } from "../../v1/fixtures/synthetic";
import { PACK_LIMITS } from "../../v1/limits";
import { hashBytes } from "../../v1/validate";
import { readRestrictedZip, PackToolError } from "../../v1/zip";
import type {
  ImageDeclaration,
  LaunchResult,
  MediaOperationContext,
  MediaRuntimeBinding,
} from "../media";

const mocks = vi.hoisted(() => ({
  run: vi.fn(),
  binding: vi.fn(),
  zipCore: vi.fn(),
}));
vi.mock("../../v1/zip", async (importActual) => ({
  ...(await importActual<typeof import("../../v1/zip")>()),
  readRestrictedZipCore: mocks.zipCore,
}));
vi.mock("../media", async (importActual) => ({
  ...(await importActual<typeof import("../media")>()),
  runIsolatedImage: mocks.run,
  readMediaRuntimeBinding: mocks.binding,
}));
import {
  createMediaOperationContext,
  disposeMediaOperationContext,
  readMediaOperationState,
  requestMediaOperationStop,
} from "../media";
import { validateArchiveCandidate } from "./engine";
import { copyCandidateResourceBytes } from "./private-candidate";
import { EvidenceError } from "./unicode";

const binding: MediaRuntimeBinding = {
  schema: "quizpack-media-runtime-binding.v1",
  platform: "darwin-arm64",
  componentId: "a".repeat(64),
  deploymentId: "b".repeat(64),
  runtimeBundleHash: "c".repeat(64),
  limitsHash: "d".repeat(64),
};
const source = async function* (bytes: Uint8Array) {
  yield bytes;
};
const archives = new Map<string, Uint8Array>();
const contexts: MediaOperationContext[] = [];
function context(
  signal = new AbortController().signal,
  deadline = performance.now() + 60000,
) {
  const value = createMediaOperationContext({
    signal,
    deadlineMonotonicMs: deadline,
  });
  contexts.push(value);
  return value;
}
function decoded(
  _bytes: Uint8Array,
  declaration: ImageDeclaration,
): LaunchResult {
  return {
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
  };
}
async function repack(edit: (files: Map<string, Buffer>) => void) {
  const zip = await readRestrictedZip(source(archives.get("dimensions")!), {
    targetProductId: "synthetic-dimensions",
  });
  if (!zip.ok) throw new Error("Synthetic archive rejected.");
  const files = new Map(zip.value.files);
  edit(files);
  return createStoredArchive(
    [...files].map(([path, bytes]) => ({ path, bytes })),
    PACK_LIMITS.archiveBytes,
    new AbortController().signal,
  );
}
async function rewriteContent(edit: (value: Record<string, unknown>) => void) {
  return repack((files) => {
    const content = JSON.parse(files.get("content.json")!.toString()) as Record<
      string,
      unknown
    >;
    edit(content);
    const bytes = Buffer.from(JSON.stringify(content));
    files.set("content.json", bytes);
    const manifest = JSON.parse(files.get("manifest.json")!.toString());
    const file = manifest.files.find(
      (item: { path: string }) => item.path === "content.json",
    );
    file.bytes = bytes.length;
    file.sha256 = hashBytes(bytes);
    files.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
  });
}
beforeAll(async () => {
  for (const engine of ["dimensions", "archetype"] as const) {
    const fixture = await createSyntheticFixture(engine);
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
    archives.set(engine, built.value.archive);
  }
}, 30000);
beforeEach(async () => {
  const actual =
    await vi.importActual<typeof import("../../v1/zip")>("../../v1/zip");
  mocks.zipCore.mockReset().mockImplementation(actual.readRestrictedZipCore);
  mocks.run.mockReset().mockImplementation(decoded);
  mocks.binding.mockReset().mockResolvedValue({ outcome: "bound", binding });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const value of contexts.splice(0)) disposeMediaOperationContext(value);
});

describe("trusted candidate validation (mock isolation, real ZIP/supported core)", () => {
  it.each(["dimensions", "archetype"])(
    "fully validates same-byte %s with fixed inspector/context and private copies",
    async (engine) => {
      const operation = context();
      const input = Buffer.from(archives.get(engine)!);
      const expectedHash = hashBytes(input);
      const pending = validateArchiveCandidate(
        input,
        `synthetic-${engine}`,
        operation,
      );
      input.fill(0); // Caller mutation after the first synchronous snapshot cannot affect proof.
      const result = await pending;
      expect(result.outcome).toBe("accepted");
      expect(readMediaOperationState(operation).phase).toBe("active");
      if (result.outcome !== "accepted") return;
      expect(result.evidence.input).toMatchObject({
        archiveSha256: expectedHash,
      });
      expect(result.evidence.report.status).toBe("sealed");
      if (result.evidence.report.status === "sealed")
        expect(Object.values(result.evidence.report.value.checks)).toEqual(
          Array(6).fill("passed"),
        );
      expect(mocks.run).toHaveBeenCalledTimes(
        result.candidate.facts.content.resources.length,
      );
      expect(mocks.run.mock.calls.every((call) => call[2] === operation)).toBe(
        true,
      );
      expect(result.evidence.media.map((fact) => fact.resourceIndex)).toEqual(
        result.candidate.facts.content.resources.map((_, index) => index),
      );
      const copy = copyCandidateResourceBytes(result.candidate, 0);
      copy.fill(0);
      expect(hashBytes(copyCandidateResourceBytes(result.candidate, 0))).toBe(
        result.candidate.facts.resources[0]!.blobSha256,
      );
      expect(() => JSON.stringify(result)).toThrow(EvidenceError);
      expect(Object.isFrozen(result.candidate.facts.content)).toBe(true);
      expect(result.candidate.facts.canonicalContentSha256).toBe(
        hashBytes(canonicalP1Json(result.candidate.facts.content)),
      );
    },
  );
  it.each([
    ["schemaVersion", "quizpack-content.v3", "UNSUPPORTED_CONTENT_VERSION"],
  ])(
    "rejects %s precheck without P1 report or decoding",
    async (field, value, code) => {
      const archive = await rewriteContent((content) => {
        content[field!] = value;
      });
      const result = await validateArchiveCandidate(
        archive,
        "synthetic-dimensions",
        context(),
      );
      expect(result).toMatchObject({
        outcome: "rejected",
        code,
        evidence: {
          report: { status: "not-run", reason: "BACKEND_POLICY_REJECTED" },
        },
      });
      expect(mocks.run).not.toHaveBeenCalled();
    },
  );
  it("rejects manifest version and target Product with no decoding", async () => {
    const archive = await repack((files) => {
      const manifest = JSON.parse(files.get("manifest.json")!.toString());
      manifest.schemaVersion = "quizpack.v2";
      files.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
    });
    expect(
      await validateArchiveCandidate(
        archive,
        "synthetic-dimensions",
        context(),
      ),
    ).toMatchObject({
      outcome: "rejected",
      code: "UNSUPPORTED_MANIFEST_VERSION",
    });
    expect(
      await validateArchiveCandidate(
        archives.get("dimensions")!,
        "different-product",
        context(),
      ),
    ).toMatchObject({ outcome: "rejected", code: "TARGET_PRODUCT_MISMATCH" });
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([Buffer.from("bad zip"), Buffer.alloc(0)])(
    "uses real final container report for invalid ZIP",
    async (archive) => {
      const result = await validateArchiveCandidate(
        archive,
        "synthetic-dimensions",
        context(),
      );
      expect(result.outcome).toBe("rejected");
      expect(result.evidence.report).toMatchObject({
        status: "sealed",
        value: { candidateValid: false, checks: { container: "failed" } },
      });
      expect(mocks.run).not.toHaveBeenCalled();
    },
  );
  it("uses a full P1 failed report for malformed JSON and structure", async () => {
    for (const content of ["{", '{"schemaVersion":"quizpack-content.v1"}']) {
      const archive = await repack((files) =>
        files.set("content.json", Buffer.from(content)),
      );
      const result = await validateArchiveCandidate(
        archive,
        "synthetic-dimensions",
        context(),
      );
      expect(result).toMatchObject({
        outcome: "rejected",
        code: "P1_REJECTED",
        evidence: {
          report: {
            status: "sealed",
            value: { checks: { structure: "failed" } },
          },
        },
      });
    }
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each([
    "WORKER_FAILED",
    "OUTPUT_INVALID",
    "ISOLATION_UNAVAILABLE",
    "BUSY",
    "STOP_UNCONFIRMED",
  ] as const)(
    "interrupts whole pack on %s, preserving observed stop",
    async (code) => {
      const stopped = code === "STOP_UNCONFIRMED" ? "unknown" : "confirmed";
      mocks.run.mockImplementation(() => ({
        outcome: "failed",
        runId: randomUUID(),
        profileId: "e".repeat(64),
        code,
        stopped,
      }));
      const result = await validateArchiveCandidate(
        archives.get("dimensions")!,
        "synthetic-dimensions",
        context(),
      );
      expect(result.outcome).toBe("interrupted");
      expect(mocks.run).toHaveBeenCalledTimes(1);
      expect(result.evidence.media[0]?.result).toMatchObject({ code, stopped });
      expect(result.evidence.completion.maintenanceRequired).toBe(
        stopped === "unknown",
      );
      expect(result).not.toHaveProperty("candidate");
    },
  );
  it("keeps confirmed content decode rejection as P1 rejection", async () => {
    mocks.run.mockImplementation(() => ({
      outcome: "failed",
      runId: randomUUID(),
      profileId: "e".repeat(64),
      code: "DECODE_REJECTED",
      stopped: "confirmed",
    }));
    const result = await validateArchiveCandidate(
      archives.get("dimensions")!,
      "synthetic-dimensions",
      context(),
    );
    expect(result).toMatchObject({
      outcome: "rejected",
      code: "P1_REJECTED",
      evidence: {
        completion: { mediaStopped: "confirmed", maintenanceRequired: false },
      },
    });
  });
  it.each(["throws", "invalid-output"])(
    "retains unknown media stop when launcher %s",
    async (mode) => {
      mocks.run.mockImplementation(() => {
        if (mode === "throws") throw new Error("finite test failure");
        return { outcome: "decoded", unexpected: true };
      });
      const result = await validateArchiveCandidate(
        archives.get("dimensions")!,
        "synthetic-dimensions",
        context(),
      );
      expect(result).toMatchObject({
        outcome: "interrupted",
        code: "MEDIA_STOP_UNCONFIRMED",
        evidence: {
          media: [],
          completion: { mediaStopped: "unknown", maintenanceRequired: true },
        },
      });
      expect(mocks.run).toHaveBeenCalledTimes(1);
    },
  );
  it("interrupts pre-cancellation, expires absolute deadline and rejects forged context", async () => {
    const cancelled = new AbortController();
    cancelled.abort(new PackToolError("X".repeat(270000)));
    expect(
      await validateArchiveCandidate(
        archives.get("dimensions")!,
        "synthetic-dimensions",
        context(cancelled.signal),
      ),
    ).toMatchObject({ outcome: "interrupted", code: "OPERATION_CANCELLED" });
    expect(
      await validateArchiveCandidate(
        archives.get("dimensions")!,
        "synthetic-dimensions",
        context(undefined, performance.now() - 1),
      ),
    ).toMatchObject({ outcome: "interrupted", code: "OPERATION_TIMEOUT" });
    expect(
      await validateArchiveCandidate(
        archives.get("dimensions")!,
        "synthetic-dimensions",
        {} as MediaOperationContext,
      ),
    ).toMatchObject({ outcome: "interrupted", code: "INVALID_CONTEXT" });
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("passes stable limits hash under distinct remaining deadlines", async () => {
    const first = await validateArchiveCandidate(
      archives.get("dimensions")!,
      "synthetic-dimensions",
      context(undefined, performance.now() + 10000),
    );
    const second = await validateArchiveCandidate(
      archives.get("dimensions")!,
      "synthetic-dimensions",
      context(undefined, performance.now() + 50000),
    );
    expect(first.outcome).toBe("accepted");
    expect(second.outcome).toBe("accepted");
    expect(first.evidence.identity).toEqual(second.evidence.identity);
  });
  it("stops after first image cancellation/storage-lock loss under the same context", async () => {
    const operation = context();
    mocks.run.mockImplementation((bytes, declaration) => {
      requestMediaOperationStop(operation, "STORAGE_LOCK_LOST");
      return decoded(bytes, declaration);
    });
    const result = await validateArchiveCandidate(
      archives.get("dimensions")!,
      "synthetic-dimensions",
      operation,
    );
    expect(result.outcome).toBe("interrupted");
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(readMediaOperationState(operation).phase).toBe("stopping");
  });
  it("rejects unpaired Unicode as separate persistence policy after true P1", async () => {
    const archive = await rewriteContent((content) => {
      const product = content.product as Record<string, unknown>;
      product.title = "synthetic\ud800";
    });
    const result = await validateArchiveCandidate(
      archive,
      "synthetic-dimensions",
      context(),
    );
    expect(result).toMatchObject({
      outcome: "rejected",
      code: "UNICODE_UNPAIRED_SURROGATE",
      evidence: {
        report: { status: "sealed", value: { candidateValid: true } },
        policy: { status: "rejected" },
      },
    });
  });
  it("fails closed when runtime identity is unavailable or changes mid-validation", async () => {
    mocks.binding.mockResolvedValueOnce({
      outcome: "unavailable",
      code: "ISOLATION_UNAVAILABLE",
    });
    expect(
      await validateArchiveCandidate(
        archives.get("dimensions")!,
        "synthetic-dimensions",
        context(),
      ),
    ).toMatchObject({
      outcome: "interrupted",
      code: "RUNTIME_IDENTITY_UNAVAILABLE",
    });
    expect(mocks.run).not.toHaveBeenCalled();
    mocks.binding
      .mockResolvedValueOnce({ outcome: "bound", binding })
      .mockResolvedValueOnce({
        outcome: "bound",
        binding: { ...binding, deploymentId: "f".repeat(64) },
      });
    expect(
      await validateArchiveCandidate(
        archives.get("dimensions")!,
        "synthetic-dimensions",
        context(),
      ),
    ).toMatchObject({
      outcome: "interrupted",
      code: "RUNTIME_IDENTITY_UNAVAILABLE",
    });
  });
  it("returns unknown when launcher outlives the shared shortened cleanup, preserving late facts", async () => {
    const operation = context();
    let complete: (() => void) | undefined;
    mocks.run.mockImplementation(
      (bytes: Uint8Array, declaration: ImageDeclaration) => {
        requestMediaOperationStop(
          operation,
          "STOP_REQUESTED",
          performance.now() + 20,
        );
        return new Promise<LaunchResult>((resolve) => {
          complete = () => resolve(decoded(bytes, declaration));
        });
      },
    );
    const result = await validateArchiveCandidate(
      archives.get("dimensions")!,
      "synthetic-dimensions",
      operation,
    );
    expect(result).toMatchObject({
      outcome: "interrupted",
      code: "MEDIA_STOP_UNCONFIRMED",
      evidence: {
        media: [],
        runtimeFailure: "STOP_UNCONFIRMED",
        completion: {
          mediaStopped: "unknown",
          relatedIo: "unconfirmed",
          maintenanceRequired: true,
        },
      },
    });
    complete?.();
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(result.evidence.media).toEqual([]);
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it("does not add a fresh cleanup period to a pending binding read", async () => {
    const operation = context();
    mocks.binding.mockImplementation(() => {
      requestMediaOperationStop(
        operation,
        "STORAGE_LOCK_LOST",
        performance.now() + 20,
      );
      return new Promise(() => {});
    });
    const result = await validateArchiveCandidate(
      archives.get("dimensions")!,
      "synthetic-dimensions",
      operation,
    );
    expect(result).toMatchObject({
      outcome: "interrupted",
      code: "MEDIA_STOP_UNCONFIRMED",
      evidence: {
        completion: {
          mediaStopped: "unknown",
          relatedIo: "unconfirmed",
          maintenanceRequired: true,
        },
      },
    });
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("retains unknown stop from the final runtime rebind", async () => {
    mocks.binding
      .mockResolvedValueOnce({ outcome: "bound", binding })
      .mockResolvedValueOnce({
        outcome: "unavailable",
        code: "STOP_UNCONFIRMED",
      });
    const result = await validateArchiveCandidate(
      archives.get("dimensions")!,
      "synthetic-dimensions",
      context(),
    );
    expect(result).toMatchObject({
      outcome: "interrupted",
      code: "MEDIA_STOP_UNCONFIRMED",
      evidence: {
        runtimeFailure: "STOP_UNCONFIRMED",
        completion: { mediaStopped: "unknown", maintenanceRequired: true },
      },
    });
    expect(result).not.toHaveProperty("candidate");
  });
  it("retains policy control IO uncertainty before any image launch", async () => {
    mocks.binding.mockResolvedValueOnce({
      outcome: "unavailable",
      code: "STOP_UNCONFIRMED",
    });
    const result = await validateArchiveCandidate(
      archives.get("dimensions")!,
      "synthetic-dimensions",
      context(),
    );
    expect(result).toMatchObject({
      outcome: "interrupted",
      code: "MEDIA_STOP_UNCONFIRMED",
      evidence: {
        media: [],
        runtimeFailure: "STOP_UNCONFIRMED",
        completion: {
          mediaStopped: "unknown",
          relatedIo: "unconfirmed",
          maintenanceRequired: true,
        },
      },
    });
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it.each(["initial", "final"])(
    "preserves %s binding unknown before a simultaneous storage stop",
    async (stage) => {
      const operation = context();
      const stopUnknown = () => {
        requestMediaOperationStop(operation, "STORAGE_LOCK_LOST");
        return { outcome: "unavailable", code: "STOP_UNCONFIRMED" };
      };
      if (stage === "final")
        mocks.binding.mockResolvedValueOnce({ outcome: "bound", binding });
      mocks.binding.mockImplementationOnce(stopUnknown);
      const result = await validateArchiveCandidate(
        archives.get("dimensions")!,
        "synthetic-dimensions",
        operation,
      );
      expect(result).toMatchObject({
        outcome: "interrupted",
        code: "MEDIA_STOP_UNCONFIRMED",
        evidence: {
          runtimeFailure: "STOP_UNCONFIRMED",
          completion: {
            mediaStopped: "unknown",
            relatedIo: "unconfirmed",
            maintenanceRequired: true,
          },
        },
      });
      if (stage === "initial") expect(mocks.run).not.toHaveBeenCalled();
    },
  );
  it.each(["initial", "final"])(
    "retains %s binding uncertainty for rejection and malformed authority",
    async (stage) => {
      for (const failure of ["rejected", "malformed-bound", "unknown-code"]) {
        mocks.binding
          .mockReset()
          .mockResolvedValue({ outcome: "bound", binding });
        if (stage === "final")
          mocks.binding.mockResolvedValueOnce({ outcome: "bound", binding });
        if (failure === "rejected")
          mocks.binding.mockRejectedValueOnce(
            new Error("finite synthetic control failure"),
          );
        else
          mocks.binding.mockResolvedValueOnce(
            failure === "malformed-bound"
              ? { outcome: "bound", binding: {} }
              : { outcome: "unavailable", code: "UNKNOWN_CONTROL_RESULT" },
          );
        const result = await validateArchiveCandidate(
          archives.get("dimensions")!,
          "synthetic-dimensions",
          context(),
        );
        expect(result).toMatchObject({
          outcome: "interrupted",
          code: "MEDIA_STOP_UNCONFIRMED",
          evidence: {
            runtimeFailure: "STOP_UNCONFIRMED",
            completion: {
              mediaStopped: "unknown",
              relatedIo: "unconfirmed",
              maintenanceRequired: true,
            },
          },
        });
      }
    },
  );
  it("keeps finite isolation-unavailable separate from unknown control IO", async () => {
    mocks.binding.mockResolvedValueOnce({
      outcome: "unavailable",
      code: "ISOLATION_UNAVAILABLE",
    });
    const result = await validateArchiveCandidate(
      archives.get("dimensions")!,
      "synthetic-dimensions",
      context(),
    );
    expect(result).toMatchObject({
      outcome: "interrupted",
      code: "RUNTIME_IDENTITY_UNAVAILABLE",
      evidence: {
        completion: {
          mediaStopped: "not-started",
          relatedIo: "settled",
          maintenanceRequired: false,
        },
      },
    });
  });
  it("freezes cleanup-timeout IO evidence when the core settles in the same timer callback", async () => {
    const parsed = await readRestrictedZip(
      source(archives.get("dimensions")!),
      { targetProductId: "synthetic-dimensions" },
    );
    if (!parsed.ok) throw new Error("Synthetic ZIP rejected.");
    const operation = context();
    let resolveZip: (() => void) | undefined;
    mocks.zipCore.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveZip = () => resolve(parsed.value);
        }),
    );
    const resultPromise = validateArchiveCandidate(
      archives.get("dimensions")!,
      "synthetic-dimensions",
      operation,
    );
    while (!resolveZip)
      await new Promise<void>((resolve) => setImmediate(resolve));
    const actualTimeout = globalThis.setTimeout;
    vi.spyOn(globalThis, "setTimeout").mockImplementation(
      (callback, delay, ...args) =>
        actualTimeout(() => {
          const state = readMediaOperationState(operation);
          const expired =
            state.phase === "stopping" &&
            performance.now() >= state.stop.cleanupDeadlineMonotonicMs;
          callback(...args);
          if (expired) resolveZip?.();
        }, delay),
    );
    requestMediaOperationStop(
      operation,
      "STORAGE_LOCK_LOST",
      performance.now() + 20,
    );
    const result = await resultPromise;
    expect(result).toMatchObject({
      outcome: "interrupted",
      code: "RELATED_IO_UNCONFIRMED",
      evidence: {
        completion: { relatedIo: "unconfirmed", maintenanceRequired: true },
      },
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(result.evidence.completion.relatedIo).toBe("unconfirmed");
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("observes a tightened cleanup deadline while waiting on registered IO", async () => {
    const actual =
      await vi.importActual<typeof import("../../v1/zip")>("../../v1/zip");
    const operation = context();
    let releaseIo: (() => void) | undefined;
    mocks.zipCore.mockImplementationOnce(async (input, execution) => {
      execution.trackIo(
        new Promise<void>((resolve) => {
          releaseIo = resolve;
        }),
      );
      return actual.readRestrictedZipCore(input, execution);
    });
    let tightening: NodeJS.Timeout | undefined;
    mocks.run.mockImplementationOnce((bytes, declaration) => {
      requestMediaOperationStop(
        operation,
        "STORAGE_LOCK_LOST",
        performance.now() + 160,
      );
      tightening = setTimeout(
        () =>
          requestMediaOperationStop(
            operation,
            "STORAGE_LOCK_LOST",
            performance.now() + 15,
          ),
        5,
      );
      return decoded(bytes, declaration);
    });
    const started = performance.now();
    const result = await validateArchiveCandidate(
      archives.get("dimensions")!,
      "synthetic-dimensions",
      operation,
    );
    const elapsed = performance.now() - started;
    if (tightening) clearTimeout(tightening);
    releaseIo?.();
    expect(result).toMatchObject({
      outcome: "interrupted",
      code: "RELATED_IO_UNCONFIRMED",
      evidence: {
        completion: { relatedIo: "unconfirmed", maintenanceRequired: true },
      },
    });
    expect(elapsed).toBeLessThan(120);
  });
});
