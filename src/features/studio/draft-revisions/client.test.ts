import { afterEach, describe, it, expect, vi } from "vitest";
import {
  checkAppendResult,
  checkRevisionResolution,
  checkRevisionHistory,
  checkedRevisionFetch,
} from "./client";
import { parseRevisionHistoryQuery } from "./urls";
import { DRAFT_REVISION_LIMITS } from "@/features/product/draft-revisions/contracts";
import { tuple, receipt, observation, base } from "./fixtures.test-support";
afterEach(() => vi.unstubAllGlobals());
describe("fixed append and history response checking", () => {
  it("checks the entire target and original success status", async () => {
    const application = await receipt();
    expect(
      (await checkAppendResult({ created: true, application }, 201, tuple))
        .application.revision,
    ).toBe(2);
    await expect(
      checkAppendResult({ created: true, application }, 200, tuple),
    ).rejects.toThrow();
    for (const patch of [
      { draftId: "77777777-7777-4777-8777-777777777777" },
      { expectedAssetSetSha256: "f".repeat(64) },
      { expectedCanonicalContentSha256: "e".repeat(64) },
    ])
      await expect(
        checkAppendResult(
          {
            created: false,
            application: {
              ...application,
              target: { ...application.target, ...patch },
            },
          },
          200,
          tuple,
        ),
      ).rejects.toThrow();
  });
  it("requires a locally recomputed fingerprint and exact source for every resolve kind", async () => {
    const result = await observation("not-applied-obsolete");
    expect((await checkRevisionResolution(result, tuple)).kind).toBe(
      "not-applied-obsolete",
    );
    await expect(
      checkRevisionResolution(
        { ...result, fingerprint: "f".repeat(64) },
        tuple,
      ),
    ).rejects.toThrow();
    await expect(
      checkRevisionResolution(
        {
          ...result,
          binding: {
            ...tuple,
            sourceValidationId: "77777777-7777-4777-8777-777777777777",
          },
        },
        tuple,
      ),
    ).rejects.toThrow();
  });
  it.each([
    "?pageSize=0",
    "?pageSize=51",
    "?pageSize=01",
    "?pageSize=+2",
    "?pageSize=2&pageSize=2",
    "?beforeRevision=2",
    "?anchorRevision=1&beforeRevision=3",
    "?x=1",
    "?anchorRevision=",
  ])("rejects noncanonical or incoherent query %s", (q) => {
    expect(() =>
      parseRevisionHistoryQuery(new URL("http://local/" + q)),
    ).toThrow();
  });
  it("allows the exact anchor100/before101 ceiling and validates requested page identity", () => {
    expect(
      parseRevisionHistoryQuery(
        new URL(
          "http://local/?anchorRevision=100&beforeRevision=101&pageSize=50",
        ),
      ),
    ).toEqual({ anchorRevision: 100, beforeRevision: 101, pageSize: 50 });
    const page = {
      productId: tuple.productId,
      draftId: base.draftId,
      anchorRevision: 1,
      beforeRevision: 2,
      pageSize: 20,
      items: [base],
      nextBeforeRevision: null,
    };
    expect(
      checkRevisionHistory(page, tuple.productId, base.draftId, {
        pageSize: 20,
      }).items,
    ).toHaveLength(1);
    expect(() =>
      checkRevisionHistory(page, tuple.productId, base.draftId, {
        pageSize: 1,
      }),
    ).toThrow();
  });
  it("finite new 409 errors remain finite; read-only resolve never gains write UNKNOWN", async () => {
    for (const code of [
      "DRAFT_BASE_CONFLICT",
      "DRAFT_SOURCE_ALREADY_APPLIED",
      "DRAFT_REVISION_LIMIT",
    ]) {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () =>
          Response.json(
            { code, requestId: tuple.idempotencyKey },
            { status: 409 },
          ),
        ),
      );
      await expect(
        checkedRevisionFetch("/synthetic", {}, (v) => v, "append"),
      ).rejects.toThrow(code);
    }
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json(
          { code: "WRITE_OUTCOME_UNKNOWN", requestId: tuple.idempotencyKey },
          { status: 503 },
        ),
      ),
    );
    await expect(
      checkedRevisionFetch("/synthetic", {}, (v) => v, "resolve"),
    ).rejects.toThrow("STUDIO_UNAVAILABLE");
  });
  it("measures the complete original wire bytes: history128KiB exact/+1, small64KiB exact/+1", async () => {
    for (const operation of ["append", "history"] as const) {
      const cap =
        operation === "append"
          ? DRAFT_REVISION_LIMITS.responseBytes
          : DRAFT_REVISION_LIMITS.historyResponseBytes;
      for (const extra of [0, 1]) {
        const body = "{}" + " ".repeat(cap - 2 + extra);
        vi.stubGlobal(
          "fetch",
          vi.fn(
            async () =>
              new Response(body, {
                headers: { "content-type": "application/json" },
              }),
          ),
        );
        const task = checkedRevisionFetch(
          "/synthetic",
          {},
          (v) => v,
          operation,
        );
        if (extra)
          await expect(task).rejects.toThrow(
            operation === "append"
              ? "WRITE_OUTCOME_UNKNOWN"
              : "STUDIO_UNAVAILABLE",
          );
        else expect(await task).toEqual({});
      }
    }
  });
});
