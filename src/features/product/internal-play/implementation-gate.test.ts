import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import previewMetadata from "../internal-versions/implementation-data/renderer-folio-preview-v1-1.json";
import { internalPlayFixture } from "./contracts.test-support";
import { consumerImplementationDescriptorSha256 } from "./implementation-schema";
import { verifyConsumerImplementations } from "../../../../scripts/verify-consumer-implementations";

async function syntheticMetadata() {
  const { play } = await internalPlayFixture();
  const { components: omitted, ...old } = previewMetadata.descriptor;
  void omitted;
  // Tests the verifier using existing real files, not a registered or usable consumer implementation.
  const descriptor = {
    ...old,
    schemaVersion: "quizforge.consumer-implementation-entry.v1",
    kind: "consumer-renderer",
    id: "synthetic-gate",
    capability: "local-internal-consumer",
    mapping: play.snapshot.mapping,
    mappingSha256: play.snapshot.mappingSha256,
    protocols: play.snapshot.protocols,
  };
  const entry = {
    descriptor,
    entrySha256: await consumerImplementationDescriptorSha256(descriptor),
  };
  const identity = {
    kind: descriptor.kind,
    id: descriptor.id,
    version: descriptor.version,
    entrySha256: entry.entrySha256,
  };
  return { entry, identity };
}
describe("consumer local-catalog build verification", () => {
  it("requires an exact independent compiled binding and retains unavailable metadata", async () => {
    const { entry, identity } = await syntheticMetadata();
    const inactive = await verifyConsumerImplementations(
      process.cwd(),
      [entry],
      [],
    );
    expect(inactive.available).toBe(0);
    expect(inactive.descriptors).toBe(1);
    const selected = await verifyConsumerImplementations(
      process.cwd(),
      [entry],
      [identity],
    );
    expect(selected.available).toBe(1);
    expect(selected.sourceFiles).toBeGreaterThan(40);
    await expect(
      verifyConsumerImplementations(
        process.cwd(),
        [entry],
        [{ ...identity, entrySha256: "a".repeat(64) }],
      ),
    ).rejects.toThrow("CONSUMER_CATALOG_BINDING_MISMATCH");
    await expect(
      verifyConsumerImplementations(process.cwd(), [entry, entry], [identity]),
    ).rejects.toThrow("CONSUMER_CATALOG_BINDING_MISMATCH");
  });
  it("checks actual selected file and lock bytes without changing the originals", async () => {
    const { entry, identity } = await syntheticMetadata();
    for (const changed of [
      "src/features/theme/preview/components.tsx",
      "public/assets/fonts/preview-v1-1/serif-600.woff2",
      "pnpm-lock.yaml",
    ]) {
      await expect(
        verifyConsumerImplementations(
          process.cwd(),
          [entry],
          [identity],
          async (path) => {
            const bytes = await readFile(path);
            if (path !== changed) return bytes;
            return changed === "pnpm-lock.yaml"
              ? Buffer.from(
                  bytes
                    .toString("utf8")
                    .replace(
                      "autoInstallPeers: true",
                      "autoInstallPeers: false",
                    ),
                )
              : Buffer.concat([bytes, Buffer.from("synthetic-drift")]);
          },
        ),
      ).rejects.toThrow(/IMPLEMENTATION_(FILE|LOCK_SETTINGS)_CHANGED/);
    }
  });
  it("rejects metadata drift before performing availability or reading selected source", async () => {
    const { entry, identity } = await syntheticMetadata();
    let reads = 0;
    const altered = structuredClone(entry);
    altered.descriptor.mappingSha256 = "a".repeat(64);
    await expect(
      verifyConsumerImplementations(
        process.cwd(),
        [altered],
        [identity],
        async () => {
          reads++;
          throw Error("UNEXPECTED_READ");
        },
      ),
    ).rejects.toThrow("CONSUMER_IMPLEMENTATION_METADATA_MISMATCH");
    expect(reads).toBe(0);
  });
});
