import { describe, expect, it } from "vitest";
import { resolveConsumerRendererClientV2 } from "./implementation-client-v2";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY_V2 } from "./implementation-catalog-v2";

describe("registered Qianzai presentation runtime", () => {
  it("keeps the mounted component identity across equivalent verified facts", () => {
    const identity = CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.qianzai!;
    const first = resolveConsumerRendererClientV2(identity)!;
    const reread = resolveConsumerRendererClientV2({ ...identity })!;
    expect(first.identity).toEqual(identity);
    expect(reread.Experience).toBe(first.Experience);
  });
  it("does not bind a new profile to an old or unknown renderer entry", () => {
    const identity = CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.qianzai!;
    expect(
      resolveConsumerRendererClientV2({ ...identity, version: "1.1.0" }),
    ).toBeNull();
    expect(
      resolveConsumerRendererClientV2({
        ...identity,
        entrySha256: "0".repeat(64),
      }),
    ).toBeNull();
  });
});
