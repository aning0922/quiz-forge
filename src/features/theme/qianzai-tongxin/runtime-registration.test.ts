import { expect, it, vi } from "vitest";
// Self-consistent synthetic catalog facts only. Real source closure proof belongs to final integration.
vi.mock(
  "@/features/product/internal-versions/implementation-registration-v2",
  async () => {
    const { createHash } = await import("node:crypto");
    const { consumerCanonicalText } =
      await import("@/lib/consumer-contract/v1/integrity");
    const { QIANZAI_COMPONENT_MAPPING } = await import("./component-map");
    const { QIANZAI_RUNTIME_INPUTS } = await import("./runtime-inputs");
    const oldEngine = (
      await import("@/features/product/internal-versions/implementation-data/engine-archetype-l1-v1.json")
    ).default;
    const oldPreview = (
      await import("@/features/product/internal-versions/implementation-data/renderer-structured-composed-v1.json")
    ).default;
    const oldConsumer = (
      await import("@/features/product/internal-play/implementation-data/consumer-structured-composed-v1.json")
    ).default;
    const hash = (v: unknown) =>
      createHash("sha256")
        .update(consumerCanonicalText(v, 262144))
        .digest("hex");
    const make = (
      original: typeof oldEngine | typeof oldPreview | typeof oldConsumer,
      authored = false,
    ) => {
      const descriptor = structuredClone(original.descriptor) as Record<
        string,
        unknown
      > & { closure: typeof original.descriptor.closure };
      descriptor.closure.files[0]!.sha256 = "1".repeat(64);
      if (authored) {
        descriptor.id =
          descriptor.kind === "consumer-renderer"
            ? "consumer-qianzai-tongxin"
            : "qianzai-tongxin-preview";
        descriptor.presentationMode = "authored-product";
        descriptor.font = QIANZAI_RUNTIME_INPUTS.font;
        if (descriptor.kind === "consumer-renderer") {
          descriptor.mapping = QIANZAI_COMPONENT_MAPPING;
          descriptor.mappingSha256 = hash(QIANZAI_COMPONENT_MAPPING);
        }
      }
      descriptor.implementationSha256 = hash(descriptor.closure);
      return { descriptor, entrySha256: hash(descriptor) };
    };
    return {
      D3_IMPLEMENTATION_BINDINGS: {
        engine: make(oldEngine),
        structuredPreview: make(oldPreview),
        structuredConsumer: make(oldConsumer),
        qianzaiPreview: make(oldPreview, true),
        qianzaiConsumer: make(oldConsumer, true),
      },
    };
  },
);
import { D3_IMPLEMENTATION_BINDINGS as registered } from "@/features/product/internal-versions/implementation-registration-v2";
import {
  implementationIdentityV2,
  rendererImplementationAvailableV2,
} from "@/features/product/internal-versions/implementation-catalog-v2";
import {
  consumerImplementationIdentityV2,
  consumerImplementationAvailableV2,
  findConsumerImplementationDescriptorV2,
  CONSUMER_IMPLEMENTATION_DESCRIPTORS_V2,
} from "@/features/product/internal-play/implementation-catalog-v2";
import { resolveConsumerExperienceRuntimeV2 } from "@/features/product/internal-play/implementation-client-v2";
import { QianzaiTongxinRuntime } from "./runtime";
import { selectParentConsumerRendererV2 } from "@/features/product/internal-play/parent-renderer-v2";
import { persistedReportFixtureV2 } from "@/features/report/persisted/contracts-v2.test-support";
import historical from "@/features/product/internal-play/implementation-data/consumer-structured-composed-v1.json";
const fontIdentity = () => {
  const f = registered.qianzaiConsumer!.descriptor.font;
  if ("kind" in f) throw Error("FIXTURE");
  return {
    id: f.id,
    version: f.version,
    weight: f.weight,
    fileSha256: f.fileSha256,
    coverageSha256: f.coverageSha256,
    licenseSha256: f.licenseSha256,
  };
};
it("resolves only the exact new renderer, mapping and fixed-font identity", () => {
  const entry = registered.qianzaiConsumer!,
    facts = {
      renderer: consumerImplementationIdentityV2(entry),
      mapping: entry.descriptor.mapping,
      font: fontIdentity(),
    };
  expect(resolveConsumerExperienceRuntimeV2(facts)?.Experience).toBe(
    QianzaiTongxinRuntime,
  );
  expect(
    resolveConsumerExperienceRuntimeV2({
      ...facts,
      font: { ...facts.font, fileSha256: "0".repeat(64) },
    }),
  ).toBeNull();
  expect(
    resolveConsumerExperienceRuntimeV2({
      ...facts,
      renderer: { ...facts.renderer, entrySha256: "0".repeat(64) },
    }),
  ).toBeNull();
  const changed = structuredClone(facts);
  changed.mapping.states.cover.runtime.id = "consumer-other-cover";
  expect(resolveConsumerExperienceRuntimeV2(changed)).toBeNull();
});
it("keeps old descriptor facts readable without claiming their changed closure is executable", () => {
  const old = {
    kind: "consumer-renderer",
    id: historical.descriptor.id,
    version: historical.descriptor.version,
    entrySha256: historical.entrySha256,
  };
  expect(findConsumerImplementationDescriptorV2(old)).not.toBeNull();
  expect(consumerImplementationAvailableV2(old)).toBe(false);
  expect(
    consumerImplementationAvailableV2(
      consumerImplementationIdentityV2(registered.structuredConsumer!),
    ),
  ).toBe(true);
  expect(CONSUMER_IMPLEMENTATION_DESCRIPTORS_V2[0]!.entrySha256).toBe(
    registered.structuredConsumer!.entrySha256,
  );
});
it("selects a new play candidate only for its exact verified parent renderer/font/components", async () => {
  const fixture = await persistedReportFixtureV2();
  const parent = structuredClone(fixture.snapshot.play.snapshot.parentSnapshot);
  parent.renderer = implementationIdentityV2(
    registered.qianzaiPreview!,
  ) as typeof parent.renderer;
  parent.font = fontIdentity();
  const authored = consumerImplementationIdentityV2(
      registered.qianzaiConsumer!,
    ),
    structured = consumerImplementationIdentityV2(
      registered.structuredConsumer!,
    );
  expect(rendererImplementationAvailableV2(parent.renderer)).toBe(true);
  expect(
    selectParentConsumerRendererV2(parent, [structured, authored]),
  ).toEqual(authored);
  expect(selectParentConsumerRendererV2(parent, [structured])).toBeNull();
  parent.font = { ...fontIdentity(), version: "1.0.0" };
  expect(selectParentConsumerRendererV2(parent, [authored])).toBeNull();
});
