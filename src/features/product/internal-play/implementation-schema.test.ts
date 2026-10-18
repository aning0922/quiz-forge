import { describe, expect, it } from "vitest";
import previewMetadata from "../internal-versions/implementation-data/renderer-folio-preview-v1.json";
import { internalPlayFixture } from "./contracts.test-support";
import {
  consumerImplementationEntrySchema,
  consumerImplementationDescriptorSha256,
  consumerImplementationClosureSha256,
  verifyConsumerImplementationEntry,
} from "./implementation-schema";

async function metadataFixture() {
  const { play } = await internalPlayFixture();
  // Metadata-only synthetic fixture. Reusing a closure here does not register a consumer runtime.
  const descriptor = {
    schemaVersion: "quizforge.consumer-implementation-entry.v1" as const,
    kind: "consumer-renderer" as const,
    id: "synthetic-consumer-renderer",
    version: "1.0.0",
    capability: "local-internal-consumer" as const,
    contentSchemaVersion: "quizpack-content.v2" as const,
    mapping: play.snapshot.mapping,
    mappingSha256: play.snapshot.mappingSha256,
    protocols: play.snapshot.protocols,
    font: previewMetadata.descriptor.font,
    closure: structuredClone(previewMetadata.descriptor.closure),
    implementationSha256: await consumerImplementationClosureSha256(
      previewMetadata.descriptor.closure,
    ),
  };
  return {
    descriptor,
    entrySha256: await consumerImplementationDescriptorSha256(descriptor),
  };
}

describe("consumer immutable implementation metadata", () => {
  it("has a separate identity from the preserved preview and never accepts code or a publication capability", async () => {
    const value = await metadataFixture();
    expect(await verifyConsumerImplementationEntry(value)).toEqual(value);
    expect(
      consumerImplementationEntrySchema.safeParse(previewMetadata).success,
    ).toBe(false);
    for (const extra of [
      { sourceCode: "synthetic" },
      { moduleUrl: "https://invalid.example" },
      { publicationApproved: true },
    ])
      expect(
        consumerImplementationEntrySchema.safeParse({
          ...value,
          descriptor: { ...value.descriptor, ...extra },
        }).success,
      ).toBe(false);
    expect(
      consumerImplementationEntrySchema.safeParse({
        ...value,
        descriptor: { ...value.descriptor, capability: "public-consumer" },
      }).success,
    ).toBe(false);
  });
  it("rejects nested closure or mapping hash drift even after rehashing the descriptor", async () => {
    const value = await metadataFixture();
    const closure = structuredClone(value.descriptor);
    closure.closure.files[0]!.sha256 = "a".repeat(64);
    await expect(
      verifyConsumerImplementationEntry({
        descriptor: closure,
        entrySha256: await consumerImplementationDescriptorSha256(closure),
      }),
    ).rejects.toThrow("CONSUMER_IMPLEMENTATION_METADATA_MISMATCH");
    const mapping = structuredClone(value.descriptor);
    mapping.mapping.states.cover.runtime.id = "consumer-other-cover";
    await expect(
      verifyConsumerImplementationEntry({
        descriptor: mapping,
        entrySha256: await consumerImplementationDescriptorSha256(mapping),
      }),
    ).rejects.toThrow("CONSUMER_IMPLEMENTATION_METADATA_MISMATCH");
    await expect(
      verifyConsumerImplementationEntry({
        ...value,
        entrySha256: "a".repeat(64),
      }),
    ).rejects.toThrow("CONSUMER_IMPLEMENTATION_METADATA_MISMATCH");
  });
  it("requires both runtime directions and a declared DOM/canvas/JSX policy", async () => {
    const value = await metadataFixture();
    for (const runtime of ["browser", "server"])
      expect(
        consumerImplementationEntrySchema.safeParse({
          ...value,
          descriptor: {
            ...value.descriptor,
            closure: {
              ...value.descriptor.closure,
              entrypoints: value.descriptor.closure.entrypoints.filter(
                (e) => e.runtime === runtime,
              ),
            },
          },
        }).success,
      ).toBe(false);
    for (const change of [{ browser: null }, { jsxImport: null }])
      expect(
        consumerImplementationEntrySchema.safeParse({
          ...value,
          descriptor: {
            ...value.descriptor,
            closure: {
              ...value.descriptor.closure,
              runtimePolicy: {
                ...value.descriptor.closure.runtimePolicy,
                ...change,
              },
            },
          },
        }).success,
      ).toBe(false);
  });
});
