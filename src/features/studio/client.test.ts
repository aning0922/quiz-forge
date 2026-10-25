import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { studioFetch } from "./client";
import { advanceStudioRequestEpoch } from "./authority-events";
let invalidations = 0;
beforeEach(() => {
  const target = new EventTarget();
  target.addEventListener(
    "quizforge:studio-authority-invalidated:v1",
    () => invalidations++,
  );
  invalidations = 0;
  vi.stubGlobal("window", target);
});
afterEach(() => vi.unstubAllGlobals());
it.each(["response", "body", "success-body"])(
  "discards a late %s read without revoking the new generation",
  async (stage) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.stubGlobal("fetch", async () => {
      if (stage === "response") await held;
      const response = Response.json(
        stage === "success-body"
          ? { value: "obsolete" }
          : { code: "UNAUTHENTICATED" },
        { status: stage === "success-body" ? 200 : 401 },
      );
      if (stage !== "response") {
        const json = response.json.bind(response);
        response.json = async () => {
          await held;
          return json();
        };
      }
      return response;
    });
    const result = studioFetch("/synthetic/metadata", {});
    await Promise.resolve();
    advanceStudioRequestEpoch();
    release();
    await expect(result).rejects.toMatchObject({
      code: "STUDIO_REQUEST_STALE",
    });
    expect(invalidations).toBe(0);
  },
);
it("retains UNKNOWN for an obsolete write receipt", async () => {
  let release!: (value: Response) => void;
  vi.stubGlobal(
    "fetch",
    () =>
      new Promise<Response>((resolve) => {
        release = resolve;
      }),
  );
  const result = studioFetch("/synthetic/write", { method: "POST" }, true);
  advanceStudioRequestEpoch();
  release(Response.json({ status: "completed" }));
  await expect(result).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
  expect(invalidations).toBe(0);
});
it("still revokes a genuinely current 401", async () => {
  vi.stubGlobal("fetch", async () =>
    Response.json({ code: "UNAUTHENTICATED" }, { status: 401 }),
  );
  await expect(studioFetch("/synthetic/current", {})).rejects.toMatchObject({
    code: "UNAUTHENTICATED",
    httpStatus: 401,
  });
  expect(invalidations).toBe(1);
});
it.each([429, 503])(
  "preserves actual HTTP %s for endpoint-specific rejection handling",
  async (status) => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ code: "RATE_LIMITED" }, { status }),
    );
    await expect(
      studioFetch("/synthetic/account", { method: "POST" }, true),
    ).rejects.toMatchObject({ code: "RATE_LIMITED", httpStatus: status });
    expect(invalidations).toBe(0);
  },
);
