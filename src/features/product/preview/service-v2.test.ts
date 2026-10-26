import { afterEach, beforeAll, expect, it, vi } from "vitest";
import type { P2aDatabase } from "@/lib/db/client";
import * as auth from "./auth";
import * as repository from "./repository-v2";
import { StudioError } from "@/lib/http-security/errors";
import { currentProductPreviewService as service } from "./service-v2";
import { temporaryPreviewFixtureV2 } from "./v2.test-support";
import { temporaryPreviewRequestV2Schema } from "./contracts-v2";
let f: Awaited<ReturnType<typeof temporaryPreviewFixtureV2>>;
beforeAll(async () => {
  f = await temporaryPreviewFixtureV2();
});
afterEach(() => vi.restoreAllMocks());
const budget = () => ({
  signal: new AbortController().signal,
  deadlineMonotonicMs: performance.now() + 15000,
});
function mocks() {
  const db = {} as P2aDatabase;
  vi.spyOn(auth, "authorizedPreviewRead").mockImplementation(
    async (_db, _credentials, work) => work({} as never, {} as never),
  );
  vi.spyOn(auth, "assertPreviewCsrf").mockImplementation(() => undefined);
  const reauthorize = vi
    .spyOn(auth, "reauthorizePreview")
    .mockResolvedValue(undefined);
  const read = vi
    .spyOn(repository, "readCurrentPreviewSource")
    .mockResolvedValue({
      mode: "structured",
      content: f.content,
      binding: f.binding,
    });
  return { db, reauthorize, read };
}
it("reads an exact entry and computes temporary six volumes without any consumer protocol", async () => {
  const { db, reauthorize } = mocks();
  const selection = await service.entry(
    db,
    { sessionToken: "synthetic" },
    f.scope,
    budget(),
  );
  expect(selection.mode).toBe("structured");
  const result = await service.score(
    db,
    { sessionToken: "synthetic" },
    f.scope,
    f.request,
    budget(),
  );
  expect(result.result.body.volumes).toHaveLength(6);
  expect(result.result.body.answers).toHaveLength(24);
  expect(result.kind).toBe("temporary-preview");
  expect(result.result.exports).toEqual({
    posterPng: false,
    fullReportPng: false,
  });
  expect(Object.keys(result)).toEqual([
    "kind",
    "binding",
    "requestId",
    "result",
  ]);
  expect(JSON.stringify(result)).not.toMatch(
    /consumer-session|completionKey|reportSnapshotSha256|csrfToken/,
  );
  expect(reauthorize).toHaveBeenCalledTimes(2);
});
it("rejects changed binding, unchosen preference, incomplete answers and foreign preference policy", async () => {
  const { db } = mocks();
  expect(
    temporaryPreviewRequestV2Schema.safeParse({
      ...f.request,
      matchingContext: null,
    }).success,
  ).toBe(false);
  await expect(
    service.score(
      db,
      { sessionToken: "synthetic" },
      f.scope,
      { ...f.request, binding: { ...f.binding, revision: 2 } },
      budget(),
    ),
  ).rejects.toMatchObject({ code: "PREVIEW_BINDING_MISMATCH" });
  await expect(
    service.score(
      db,
      { sessionToken: "synthetic" },
      f.scope,
      { ...f.request, answers: f.request.answers.slice(1) },
      budget(),
    ),
  ).rejects.toMatchObject({ code: "PREVIEW_INVALID_ANSWERS" });
  await expect(
    service.score(
      db,
      { sessionToken: "synthetic" },
      f.scope,
      {
        ...f.request,
        matchingContext: {
          ...f.request.matchingContext,
          policyRef: { ...f.request.matchingContext.policyRef, id: "foreign" },
        },
      },
      budget(),
    ),
  ).rejects.toMatchObject({ code: "PREVIEW_INVALID_ANSWERS" });
});
it("discards a computed result when current permission or cancellation no longer holds", async () => {
  const { db, reauthorize, read } = mocks();
  reauthorize.mockRejectedValueOnce(new StudioError("CAPABILITY_DENIED"));
  await expect(
    service.score(
      db,
      { sessionToken: "synthetic" },
      f.scope,
      f.request,
      budget(),
    ),
  ).rejects.toMatchObject({ code: "CAPABILITY_DENIED" });
  const active = new AbortController();
  active.abort();
  read.mockClear();
  await expect(
    service.entry(db, { sessionToken: "synthetic" }, f.scope, {
      ...budget(),
      signal: active.signal,
    }),
  ).rejects.toMatchObject({ code: "PREVIEW_CANCELLED" });
  expect(read).not.toHaveBeenCalled();
});
