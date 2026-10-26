import { beforeAll, describe, expect, it, vi } from "vitest";
import { readConsumerProtocol } from "./client";
import { consumerSessionFixtureV2 } from "../consumer-v2/session.test-support";
import { consumerHostFixtureV1 } from "../consumer-v1/host.test-support";
let v2: Awaited<ReturnType<typeof consumerSessionFixtureV2>>,
  v1: Awaited<ReturnType<typeof consumerHostFixtureV1>>;
beforeAll(async () => {
  [v2, v1] = await Promise.all([
    consumerSessionFixtureV2(),
    consumerHostFixtureV1(),
  ]);
});
const json = (value: unknown) =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
describe("current consumer protocol selection", () => {
  it("selects only a verified v1/v2 session, including completed deep-link observations", async () => {
    for (const [version, id, view] of [
      ["v1", v1.session.sessionId, v1.view],
      ["v2", v2.session.sessionId, v2.view],
      ["v2", v2.session.sessionId, v2.completedView],
    ] as const) {
      const fetcher = vi.fn<typeof fetch>(async () => json(view));
      expect(
        await readConsumerProtocol(id, {
          signal: new AbortController().signal,
          fetcher,
        }),
      ).toBe(version);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0]![1]?.method).toBe("GET");
    }
  });
  it("rejects corrupted, cross-session and unknown protocols without a fallback request", async () => {
    for (const value of [
      { ...v2.view, schemaVersion: "unknown" },
      {
        ...v2.view,
        outcome: {
          kind: "editable",
          state: { ...v2.initial, matchingContextSha256: "0".repeat(64) },
        },
      },
      v1.view,
    ]) {
      const fetcher = vi.fn<typeof fetch>(async () => json(value));
      const id =
        value === v1.view
          ? "00000000-0000-4000-8000-000000000999"
          : v2.session.sessionId;
      await expect(
        readConsumerProtocol(id, {
          signal: new AbortController().signal,
          fetcher,
        }),
      ).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("cancels an unmounted selection without installing its late response", async () => {
    const active = new AbortController();
    let release!: () => void;
    const fetcher: typeof fetch = async () => {
      await new Promise<void>((r) => {
        release = r;
      });
      return json(v2.view);
    };
    const result = readConsumerProtocol(v2.session.sessionId, {
      signal: active.signal,
      fetcher,
    });
    active.abort();
    release();
    await expect(result).rejects.toThrow();
  });
});
