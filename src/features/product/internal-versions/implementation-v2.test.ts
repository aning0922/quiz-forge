import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { consumerCanonicalText } from "@/lib/consumer-contract/v1/integrity";
import { CONTENT_COMPONENTS_V3 } from "@/lib/assessment-contract/presentation-v3";
import { CONSUMER_PROTOCOLS_V2 } from "@/lib/consumer-contract/v2/identities";
import { syntheticContentV3 } from "@/features/quizpack/content/v3-fixtures.test-support";
import { syntheticInputV2 } from "@/features/quiz/scoring/v2/fixtures.test-support";
import rendererMetadata from "./implementation-data/renderer-folio-preview-v1-1.json";
import consumerMetadata from "../internal-play/implementation-data/consumer-folio-cabinet-v1-2.json";
import { rendererImplementationEntrySchema } from "./implementation-schema";
import {
  rendererImplementationEntryV2Schema,
  verifyInternalImplementationEntryV2,
} from "./implementation-schema-v2";
import {
  consumerImplementationEntryV2Schema,
  verifyConsumerImplementationEntryV2,
} from "../internal-play/implementation-schema-v2";
import { bindEngineV2 } from "./implementations/engine-v2";

const hash = (value: unknown) =>
  createHash("sha256")
    .update(consumerCanonicalText(value, 262_144), "utf8")
    .digest("hex");
const component = (id: string) => ({
  id,
  version: "1.0.0",
  propsSchemaVersion: "1.0.0",
});
const presentation = {
  presentationMode: "structured-only",
  exports: { posterPng: false, fullReportPng: false },
  font: { kind: "system-structured", pngAvailable: false },
};
/** Reused closure facts exercise metadata only; these fixtures never register code. */
function rendererEntry() {
  const descriptor = {
    ...structuredClone(rendererMetadata.descriptor),
    schemaVersion: "quizforge.implementation-entry.v2",
    id: "composed-structured-preview",
    contentSchemaVersion: "quizpack-content.v3",
    components: Object.fromEntries(
      Object.entries(CONTENT_COMPONENTS_V3).map(([state, id]) => [
        state,
        component(id),
      ]),
    ),
    ...structuredClone(presentation),
  };
  return { descriptor, entrySha256: hash(descriptor) };
}
function consumerEntry() {
  const mapping = {
    schemaVersion: "quizforge.consumer-component-map.v2",
    states: Object.fromEntries(
      Object.entries(CONTENT_COMPONENTS_V3).map(([state, id]) => [
        state,
        { source: component(id), runtime: component(`consumer-${id}`) },
      ]),
    ),
  };
  const descriptor = {
    ...structuredClone(consumerMetadata.descriptor),
    schemaVersion: "quizforge.consumer-implementation-entry.v2",
    id: "consumer-composed-structured",
    contentSchemaVersion: "quizpack-content.v3",
    mapping,
    mappingSha256: hash(mapping),
    protocols: { ...CONSUMER_PROTOCOLS_V2 },
    ...structuredClone(presentation),
  };
  return { descriptor, entrySha256: hash(descriptor) };
}

describe("explicit v2 implementation metadata and bound execution", () => {
  it("keeps historical metadata separate and does not permit structured PNG claims", async () => {
    const entry = rendererEntry();
    await expect(
      verifyInternalImplementationEntryV2(entry),
    ).resolves.toMatchObject({
      entrySha256: entry.entrySha256,
    });
    expect(rendererImplementationEntrySchema.safeParse(entry).success).toBe(
      false,
    );
    expect(
      rendererImplementationEntryV2Schema.safeParse(rendererMetadata).success,
    ).toBe(false);
    for (const kind of ["posterPng", "fullReportPng"] as const) {
      const changed = structuredClone(entry);
      changed.descriptor.exports[kind] = true;
      changed.entrySha256 = hash(changed.descriptor);
      expect(
        rendererImplementationEntryV2Schema.safeParse(changed).success,
      ).toBe(false);
    }
  });
  it("requires a fixed font for authored presentation, without treating that as availability", () => {
    const entry = rendererEntry();
    entry.descriptor.presentationMode = "authored-product";
    entry.entrySha256 = hash(entry.descriptor);
    expect(rendererImplementationEntryV2Schema.safeParse(entry).success).toBe(
      false,
    );
    const fixed = {
      descriptor: {
        ...entry.descriptor,
        font: rendererMetadata.descriptor.font,
      },
      entrySha256: "0".repeat(64),
    };
    fixed.entrySha256 = hash(fixed.descriptor);
    expect(rendererImplementationEntryV2Schema.safeParse(fixed).success).toBe(
      true,
    );
  });
  it("detects changed closure facts even when the outer descriptor is rehashed", async () => {
    const entry = rendererEntry();
    entry.descriptor.closure.files[0]!.sha256 = "0".repeat(64);
    entry.entrySha256 = hash(entry.descriptor);
    await expect(verifyInternalImplementationEntryV2(entry)).rejects.toThrow(
      "IMPLEMENTATION_METADATA_MISMATCH",
    );
  });
  it("binds consumer mapping and rejects mixed protocol metadata", async () => {
    const entry = consumerEntry();
    await expect(
      verifyConsumerImplementationEntryV2(entry),
    ).resolves.toMatchObject({
      entrySha256: entry.entrySha256,
    });
    const changed = structuredClone(entry);
    changed.descriptor.mapping.states.cover!.runtime.id =
      "consumer-foreign-cover";
    changed.entrySha256 = hash(changed.descriptor);
    await expect(verifyConsumerImplementationEntryV2(changed)).rejects.toThrow(
      "CONSUMER_IMPLEMENTATION_METADATA_MISMATCH",
    );
    expect(
      consumerImplementationEntryV2Schema.safeParse({
        ...entry,
        descriptor: {
          ...entry.descriptor,
          protocols: {
            ...entry.descriptor.protocols,
            state: "quizforge.consumer-state.v1",
          },
        },
      }).success,
    ).toBe(false);
  });
  it("does not accept a prepared handle issued by another binding", () => {
    const a = bindEngineV2({ id: "archetype-l1", version: "1.0.0" });
    const b = bindEngineV2({ id: "archetype-l1", version: "1.0.0" });
    const prepared = a.prepare(syntheticContentV3());
    expect(prepared.ok).toBe(true);
    if (!prepared.ok) throw Error("EXPECTED_PREPARED_SOURCE");
    const input = syntheticInputV2(3, [2, 2, 2]);
    expect(a.score(prepared.value, input).ok).toBe(true);
    expect(a.compose(prepared.value, input).ok).toBe(true);
    expect(a.witnesses(prepared.value).ok).toBe(true);
    expect(b.score(prepared.value, input)).toMatchObject({
      ok: false,
      issues: [{ code: "INVALID_PREPARED_DEFINITION" }],
    });
    expect(b.compose(prepared.value, input).ok).toBe(false);
    expect(b.witnesses(prepared.value).ok).toBe(false);
  });
});
