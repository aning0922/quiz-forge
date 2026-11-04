import { afterEach, expect, it, vi } from "vitest";
import { issueToken, csrfForToken } from "@/lib/security/p2a-tokens";
import * as transaction from "@/features/fulfillment/consumer-flow/transaction";
import * as execution from "@/features/fulfillment/consumer-flow/fixed-execution";
import * as source from "@/features/quizpack/consumer-fixed-source";
import * as policy from "@/features/fulfillment/consumer-session/policy-repository";
import * as repository from "./repository";
import * as activation from "./activation-repository";
import { createConsumerActivationService } from "./activation-service";
import type { ConsumerRequestOwner } from "@/features/fulfillment/consumer-flow/request-owner";

afterEach(() => vi.restoreAllMocks());
const id = "01000000-0000-4000-8000-000000000001";
const binding = {
  schemaVersion: "quizforge.consumer-product-activate.v1" as const,
  productId: "qianzai-tongxin",
  operationKey: id,
  expectedGeneration: 0,
  playVersionId: id,
  playSnapshotSha256: "a".repeat(64),
};

function setup(
  change?:
    | "content"
    | "assets"
    | "content-hash"
    | "asset-hash"
    | "manifest-hash"
    | "validation"
    | "play",
) {
  const evidence = {
    // Validated canonical text fits its own content budget, while quoting it
    // inside the old 512 KiB comparison envelope exceeds that envelope.
    canonicalContentText: JSON.stringify({ text: "相逢".repeat(90_000) }),
    assetSetText: JSON.stringify({ resources: [] }),
    canonicalContentSha256: "b".repeat(64),
    assetSetSha256: "c".repeat(64),
    canonicalManifestSha256: "d".repeat(64),
    validation: { candidateSha256: "e".repeat(64) },
  };
  const finalEvidence = structuredClone(evidence);
  if (change === "content") finalEvidence.canonicalContentText += " ";
  if (change === "assets") finalEvidence.assetSetText += " ";
  if (change === "content-hash")
    finalEvidence.canonicalContentSha256 = "f".repeat(64);
  if (change === "asset-hash") finalEvidence.assetSetSha256 = "f".repeat(64);
  if (change === "manifest-hash")
    finalEvidence.canonicalManifestSha256 = "f".repeat(64);
  if (change === "validation")
    finalEvidence.validation.candidateSha256 = "f".repeat(64);
  const parent = { snapshot: { productId: binding.productId } };
  const play = { snapshot: { parent: {}, parentSnapshot: parent.snapshot } };
  vi.spyOn(repository, "readConsumerProduct").mockResolvedValue({
    archivedAt: null,
  } as never);
  vi.spyOn(repository, "readFixedInternalPlay")
    .mockResolvedValue(play as never)
    .mockResolvedValueOnce(play as never)
    .mockResolvedValueOnce(play as never)
    .mockResolvedValueOnce(
      (change === "play" ? { ...play, changed: true } : play) as never,
    );
  vi.spyOn(repository, "readConsumerParent").mockResolvedValue(parent as never);
  vi.spyOn(repository, "assertConsumerParentSource").mockResolvedValue(
    undefined,
  );
  vi.spyOn(source, "readConsumerFixedSource")
    .mockResolvedValue({ evidence: finalEvidence } as never)
    .mockResolvedValueOnce({ evidence } as never)
    .mockResolvedValueOnce({ evidence } as never);
  vi.spyOn(execution, "fixedConsumerExecution").mockReturnValue({} as never);
  vi.spyOn(execution, "verifyConsumerExecutionIo").mockResolvedValue(
    {} as never,
  );
  const write = vi.spyOn(policy, "activatePolicyProduct").mockResolvedValue({});
  vi.spyOn(activation, "observeActivation").mockImplementation(
    async () =>
      ({ kind: write.mock.calls.length ? "applied" : "unresolved" }) as never,
  );
  vi.spyOn(transaction, "operatorRead").mockImplementation(
    async (_db, _token, _check, work) => work({} as never, {} as never),
  );
  vi.spyOn(transaction, "operatorWrite").mockImplementation(
    async (_db, _credentials, _capability, _check, _observation, work) =>
      work({} as never, {} as never),
  );
  const context = {
    sql: async (work: (db: never, check: () => void) => unknown) =>
      work({} as never, () => {}),
    io: async (work: (io: never) => unknown) =>
      work({ db: {}, checkpoint() {} } as never),
  };
  const owner = {
    run: async (_operation: string, work: (c: typeof context) => unknown) =>
      work(context),
  } as unknown as ConsumerRequestOwner;
  const token = issueToken("session").raw;
  return {
    write,
    activate: () =>
      createConsumerActivationService(owner).activate(
        {
          sessionToken: token,
          csrfToken: csrfForToken(token, "session"),
          requestId: id,
        },
        binding.productId,
        binding,
      ),
  };
}

it("activates an unchanged validated source whose quoted canonical text exceeds the operation envelope", async () => {
  const f = setup();
  await expect(f.activate()).resolves.toMatchObject({ kind: "applied" });
  expect(f.write).toHaveBeenCalledOnce();
});

it.each([
  "content",
  "assets",
  "content-hash",
  "asset-hash",
  "manifest-hash",
  "validation",
  "play",
] as const)(
  "rejects a changed final %s before issuing the activation mutation",
  async (change) => {
    const f = setup(change);
    await expect(f.activate()).rejects.toMatchObject({
      code: "SOURCE_OBSOLETE",
    });
    expect(f.write).not.toHaveBeenCalled();
  },
);
