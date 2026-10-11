import { afterEach, describe, expect, it, vi } from "vitest";
import { StudioClientError, studioFetch } from "../client";

afterEach(() => vi.unstubAllGlobals());

describe("workspace client write outcomes", () => {
  it("keeps an authorized bounded currentRevision on conflict", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue(
          Response.json(
            { code: "METADATA_REVISION_CONFLICT", currentRevision: 7 },
            { status: 409 },
          ),
        ),
    );
    await expect(
      studioFetch("/api/studio/products/example", { method: "PATCH" }, true),
    ).rejects.toMatchObject({
      code: "METADATA_REVISION_CONFLICT",
      currentRevision: 7,
    });
  });
  it.each([0, -1, 1.1, 2147483648, "7", null])(
    "does not retain invalid revision %s",
    async (currentRevision) => {
      vi.stubGlobal(
        "fetch",
        vi
          .fn()
          .mockResolvedValue(
            Response.json(
              { code: "TAXONOMY_REVISION_CONFLICT", currentRevision },
              { status: 409 },
            ),
          ),
      );
      await expect(
        studioFetch("/api/studio/tags/example", { method: "PATCH" }, true),
      ).rejects.toMatchObject({
        code: "TAXONOMY_REVISION_CONFLICT",
        currentRevision: undefined,
      });
    },
  );
  it("does not expose revision on unrelated errors", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json(
          {
            code: "INVALID_REQUEST",
            currentRevision: 7,
            arbitrary: "hidden",
          },
          { status: 400 },
        ),
      ),
    );
    await expect(
      studioFetch("/api/studio/products", {}, true),
    ).rejects.toMatchObject({
      code: "INVALID_REQUEST",
      currentRevision: undefined,
    });
  });
  it("classifies lost writes as unknown without replaying", async () => {
    const fetch = vi.fn().mockRejectedValue(new Error("private detail"));
    vi.stubGlobal("fetch", fetch);
    await expect(
      studioFetch("/api/studio/products", { method: "POST" }, true),
    ).rejects.toEqual(new StudioClientError("WRITE_OUTCOME_UNKNOWN"));
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([200, 502])(
    "classifies unreadable write response %s as unknown",
    async (status) => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue(new Response("unreadable", { status })),
      );
      await expect(
        studioFetch("/api/studio/products", { method: "POST" }, true),
      ).rejects.toMatchObject({ code: "WRITE_OUTCOME_UNKNOWN" });
    },
  );
  it("keeps ordinary read network failures unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(new Error("private detail")),
    );
    await expect(studioFetch("/api/studio/products", {})).rejects.toMatchObject(
      { code: "STUDIO_UNAVAILABLE" },
    );
  });
});
