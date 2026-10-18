import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import {
  CONSUMER_IMPLEMENTATION_DESCRIPTORS,
  CONSUMER_IMPLEMENTATION_AVAILABILITY,
  consumerImplementationAvailable,
  consumerImplementationIdentity,
  findConsumerImplementationDescriptor,
} from "./implementation-catalog";
import { verifyConsumerImplementationEntry } from "./implementation-schema";
import { resolveConsumerImplementation } from "./implementation-server";
import {
  resolveConsumerRendererClient,
  resolveConsumerExperienceRuntime,
} from "./implementation-client";
import { verifyConsumerImplementations } from "../../../../scripts/verify-consumer-implementations";
const entry = CONSUMER_IMPLEMENTATION_DESCRIPTORS[0]!;
const identity = CONSUMER_IMPLEMENTATION_AVAILABILITY.rendererV1;
function runtimeFacts() {
  const font = entry.descriptor.font;
  return {
    renderer: structuredClone(identity),
    mapping: structuredClone(entry.descriptor.mapping),
    font: {
      id: font.id,
      version: font.version,
      weight: font.weight,
      fileSha256: font.fileSha256,
      coverageSha256: font.coverageSha256,
      licenseSha256: font.licenseSha256,
    },
  };
}
describe("registered exact consumer implementation", () => {
  it("binds actual server/client implementations only for the exact frozen identity", async () => {
    await expect(verifyConsumerImplementationEntry(entry)).resolves.toEqual(
      entry,
    );
    expect(consumerImplementationIdentity(entry)).toEqual(identity);
    expect(Object.isFrozen(entry.descriptor.closure.files[0])).toBe(true);
    expect(resolveConsumerImplementation(identity)?.projectEntry).toBeTypeOf(
      "function",
    );
    expect(resolveConsumerRendererClient(identity)?.exportPoster).toBeTypeOf(
      "function",
    );
    expect(resolveConsumerExperienceRuntime(runtimeFacts())).not.toBeNull();
    const invalid = [
      null,
      {},
      { ...identity, kind: "renderer" },
      { ...identity, id: "folio-cabinet-preview" },
      { ...identity, version: "1.0.1" },
      { ...identity, entrySha256: "a".repeat(64) },
      { ...identity, extra: true },
    ];
    for (const value of invalid) {
      expect(consumerImplementationAvailable(value)).toBe(false);
      expect(findConsumerImplementationDescriptor(value)).toBeNull();
      expect(resolveConsumerImplementation(value)).toBeNull();
      expect(resolveConsumerRendererClient(value)).toBeNull();
    }
  });
  it("rejects a correct identity paired with altered mapping or any changed font identity field", () => {
    for (const key of [
      "id",
      "version",
      "weight",
      "fileSha256",
      "coverageSha256",
      "licenseSha256",
    ] as const) {
      const f = runtimeFacts();
      Reflect.set(
        f.font,
        key,
        key === "weight"
          ? 400
          : key === "version"
            ? "1.0.2"
            : key === "id"
              ? "other-font"
              : "a".repeat(64),
      );
      expect(resolveConsumerExperienceRuntime(f)).toBeNull();
    }
    for (const state of Object.keys(
      entry.descriptor.mapping.states,
    ) as (keyof typeof entry.descriptor.mapping.states)[]) {
      const f = runtimeFacts();
      f.mapping.states[state].runtime.version = "1.0.1";
      expect(resolveConsumerExperienceRuntime(f)).toBeNull();
    }
    expect(
      resolveConsumerExperienceRuntime({ ...runtimeFacts(), extra: true }),
    ).toBeNull();
  });
  it("checks the real host/controller, transport, server projection and export bytes at build time", async () => {
    const report = await verifyConsumerImplementations(
      process.cwd(),
      CONSUMER_IMPLEMENTATION_DESCRIPTORS,
      [identity],
    );
    expect(report.available).toBe(1);
    expect(report.descriptors).toBe(1);
    for (const changed of [
      "src/features/theme/consumer-v1/host.tsx",
      "src/features/theme/consumer-v1/controller.ts",
      "src/features/theme/consumer-v1/request.ts",
      "src/features/theme/consumer-v1/resource.ts",
      "src/features/theme/consumer-v1/projection.ts",
      "src/features/report/consumer-v1/export.ts",
    ]) {
      await expect(
        verifyConsumerImplementations(
          process.cwd(),
          CONSUMER_IMPLEMENTATION_DESCRIPTORS,
          [identity],
          async (file) => {
            const original = await readFile(file);
            return file === changed
              ? Buffer.concat([
                  original,
                  Buffer.from("\n// changed implementation\n"),
                ])
              : original;
          },
        ),
      ).rejects.toThrow("IMPLEMENTATION_FILE_CHANGED:" + changed);
    }
  });
});
