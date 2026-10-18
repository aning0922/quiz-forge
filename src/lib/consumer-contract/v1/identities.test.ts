import { describe, expect, it } from "vitest";
import { DISPLAY_COMPONENT_IDS_V1 } from "@/lib/assessment-contract/display-limits-v1";
import {
  consumerComponentMappingSchema,
  consumerMappingSha256,
  consumerRendererIdentitySchema,
} from "./identities";

const mapping = () => ({
  schemaVersion: "quizforge.consumer-component-map.v1",
  states: Object.fromEntries(
    Object.entries(DISPLAY_COMPONENT_IDS_V1).map(([state, sourceId]) => [
      state,
      {
        source: { id: sourceId, version: "2.0.0", propsSchemaVersion: "1.0.0" },
        runtime: {
          id: `consumer-${sourceId}`,
          version: "1.0.0",
          propsSchemaVersion: "1.0.0",
        },
      },
    ]),
  ),
});

describe("consumer source/runtime mapping boundary", () => {
  it("retains exact source tuples while hashing independent consumer implementation tuples", async () => {
    const original = consumerComponentMappingSchema.parse(mapping());
    const updated = structuredClone(original);
    updated.states.cover.runtime.version = "1.0.1";
    expect(updated.states.cover.source).toEqual(original.states.cover.source);
    expect(await consumerMappingSha256(updated)).not.toBe(
      await consumerMappingSha256(original),
    );
  });
  it("rejects missing states, future source recipes and source properties masquerading as executable code", () => {
    const base = mapping();
    const missing = structuredClone(base);
    delete missing.states.poster;
    expect(consumerComponentMappingSchema.safeParse(missing).success).toBe(
      false,
    );
    const future = structuredClone(base);
    future.states.cover!.source.version = "3.0.0";
    expect(consumerComponentMappingSchema.safeParse(future).success).toBe(
      false,
    );
    expect(
      consumerComponentMappingSchema.safeParse({
        ...base,
        moduleUrl: "https://invalid.example/module.js",
      }).success,
    ).toBe(false);
  });
  it("does not let a preview component or one shared logical component replace all six roles", () => {
    const preview = mapping();
    preview.states.cover!.runtime.id = "folio-cover";
    expect(consumerComponentMappingSchema.safeParse(preview).success).toBe(
      false,
    );
    const reused = mapping();
    reused.states.poster!.runtime.id = reused.states.cover!.runtime.id;
    expect(consumerComponentMappingSchema.safeParse(reused).success).toBe(
      false,
    );
  });
  it("keeps identity metadata strict without implying that a matching executable exists", () => {
    const identity = {
      kind: "consumer-renderer",
      id: "consumer-folio-cabinet",
      version: "1.0.1",
      entrySha256: "a".repeat(64),
    };
    expect(consumerRendererIdentitySchema.parse(identity)).toEqual(identity);
    expect(
      consumerRendererIdentitySchema.safeParse({ ...identity, available: true })
        .success,
    ).toBe(false);
    expect(
      consumerRendererIdentitySchema.safeParse({
        ...identity,
        kind: "renderer",
      }).success,
    ).toBe(false);
  });
});
