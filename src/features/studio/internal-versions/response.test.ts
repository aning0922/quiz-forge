import { describe, expect, it } from "vitest";
import { INTERNAL_VERSION_LIMITS as L } from "@/features/product/internal-versions/contracts";
import { readInternalResponse } from "./response";
const budget = () => ({
  signal: new AbortController().signal,
  deadlineMonotonicMs: performance.now() + 1000,
});
describe("finite original-deadline internal response bytes", () => {
  it.each([L.errorResponseBytes, L.responseBytes, L.listResponseBytes])(
    "accepts exactly %i raw bytes and rejects one extra byte",
    async (maximum) => {
      const json = "{}" + " ".repeat(maximum - 2);
      const headers = { "content-type": "application/json" };
      expect(
        await readInternalResponse(
          new Response(json, { headers }),
          maximum,
          budget(),
        ),
      ).toEqual({});
      await expect(
        readInternalResponse(
          new Response(json + " ", { headers }),
          maximum,
          budget(),
        ),
      ).rejects.toThrow();
    },
  );
  it("rejects fatal UTF-8, wrong MIME and a previously expired absolute deadline", async () => {
    await expect(
      readInternalResponse(
        new Response(new Uint8Array([123, 34, 120, 34, 58, 34, 255, 34, 125]), {
          headers: { "content-type": "application/json" },
        }),
        L.responseBytes,
        budget(),
      ),
    ).rejects.toThrow();
    await expect(
      readInternalResponse(new Response("{}"), L.responseBytes, budget()),
    ).rejects.toThrow();
    await expect(
      readInternalResponse(Response.json({}), L.responseBytes, {
        ...budget(),
        deadlineMonotonicMs: performance.now() - 1,
      }),
    ).rejects.toThrow();
  });
  it("cancels an indefinitely stalled body on abort and rejects unregistered budgets", async () => {
    const controller = new AbortController();
    let cancelled = false;
    const response = new Response(
      new ReadableStream({
        pull: () => new Promise(() => {}),
        cancel: () => {
          cancelled = true;
        },
      }),
      { headers: { "content-type": "application/json" } },
    );
    const task = readInternalResponse(response, L.responseBytes, {
      signal: controller.signal,
      deadlineMonotonicMs: performance.now() + 1000,
    });
    controller.abort();
    await expect(task).rejects.toThrow();
    expect(cancelled).toBe(true);
    expect(() =>
      readInternalResponse(Response.json({}), 42, budget()),
    ).toThrow();
  });
});
