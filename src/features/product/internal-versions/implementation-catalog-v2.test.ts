import { describe, expect, it } from "vitest";
import { verifyV2Implementations } from "../../../../scripts/verify-v2-implementations";
import { IMPLEMENTATION_AVAILABILITY_V2 as internal } from "./implementation-catalog-v2";
import {
  resolveEngineImplementationV2,
  resolveRendererServerV2,
} from "./implementation-server-v2";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY_V2 as consumer } from "../internal-play/implementation-catalog-v2";
import { resolveConsumerImplementationV2 } from "../internal-play/implementation-server-v2";
import { resolveConsumerExperienceRuntimeV2 } from "../internal-play/implementation-client-v2";

describe("compiled structured v2 implementation registration", () => {
  it("checks actual source, pinned dependencies and build input bytes for all three bindings", async () => {
    expect(await verifyV2Implementations(process.cwd())).toMatchObject({
      available: 3,
    });
  });
  it("resolves exact identities and rejects modified identity, mapping or capabilities", () => {
    expect(resolveEngineImplementationV2(internal.engine)).not.toBeNull();
    expect(resolveRendererServerV2(internal.renderer)).not.toBeNull();
    const runtime = resolveConsumerImplementationV2(consumer.structured)!;
    const facts = {
      renderer: runtime.identity,
      mapping: runtime.descriptor.mapping,
      font: runtime.descriptor.font,
    };
    expect(
      resolveConsumerExperienceRuntimeV2(facts)?.descriptor.presentationMode,
    ).toBe("structured-only");
    expect(
      resolveEngineImplementationV2({
        ...internal.engine,
        entrySha256: "0".repeat(64),
      }),
    ).toBeNull();
    expect(
      resolveRendererServerV2({ ...internal.renderer, version: "1.0.1" }),
    ).toBeNull();
    expect(
      resolveConsumerImplementationV2({
        ...consumer.structured,
        entrySha256: "0".repeat(64),
      }),
    ).toBeNull();
    const changed = structuredClone(facts);
    changed.mapping.states.cover.runtime.id = "consumer-unregistered-cover";
    expect(resolveConsumerExperienceRuntimeV2(changed)).toBeNull();
    expect(
      resolveConsumerExperienceRuntimeV2({
        ...facts,
        font: { kind: "system-structured", pngAvailable: true },
      }),
    ).toBeNull();
  });
});
