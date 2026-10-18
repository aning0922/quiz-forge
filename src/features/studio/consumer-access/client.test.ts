import { expect, it, vi } from "vitest";
import {
  internalPlayFixture,
  testUuid,
  testMoment,
} from "@/features/product/internal-play/contracts.test-support";
import { issueAccessKeyBindingSha256 } from "@/features/fulfillment/access/contracts";
import { internalPlayBindingSha256 } from "@/features/product/internal-play/contracts";
import { newStudioIssueV1 } from "./pending";
import {
  issueStudioKeyV1,
  createStudioPlayV1,
  resolveStudioPlayV1,
  readStudioKeysV1,
  readStudioParentVersionsV1,
} from "./client";
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "content-type": "application/json" },
  });
it("issues digest-only JSON with independent Studio CSRF and verifies the exact original receipt", async () => {
  const { play } = await internalPlayFixture(),
    issue = await newStudioIssueV1({
      productId: play.snapshot.parent.productId,
      playVersionId: play.play.id,
      playSnapshotSha256: play.play.snapshotSha256,
    });
  const key = {
    issue: {
      schemaVersion: "quizforge.access-key-issue-receipt.v1",
      binding: issue.binding,
      bindingSha256: await issueAccessKeyBindingSha256(issue.binding),
      issuedBy: testUuid(1),
      issuedAt: testMoment,
      expiresAt: new Date(
        Date.parse(testMoment) + issue.binding.validForSeconds * 1000,
      ).toISOString(),
    },
    current: {
      observedAt: testMoment,
      claim: null,
      completion: null,
      voidReceipt: null,
    },
  };
  const fetcher = vi.fn<typeof fetch>(async () =>
    json({ created: true, key }, 201),
  );
  const result = await issueStudioKeyV1(issue.binding, {
    signal: new AbortController().signal,
    csrf: "synthetic-studio-csrf",
    fetcher,
  });
  expect(result.key.issue.binding).toEqual(issue.binding);
  const options = fetcher.mock.calls[0]![1]!;
  expect(options.body).not.toContain(issue.raw!);
  expect(JSON.parse(String(options.body))).toEqual(issue.binding);
  expect(options.headers).toMatchObject({
    "x-csrf-token": "synthetic-studio-csrf",
  });
  expect(options.headers).not.toHaveProperty("x-quizforge-consumer-csrf");
  await expect(
    issueStudioKeyV1(
      { ...issue.binding, keyId: testUuid(5) },
      { signal: new AbortController().signal, csrf: "synthetic", fetcher },
    ),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
});
it("create status follows created; resolve binds the original operation rather than current metadata", async () => {
  const { play } = await internalPlayFixture(),
    c = { signal: new AbortController().signal, csrf: "synthetic" };
  expect(
    (
      await createStudioPlayV1(play.play.binding, {
        ...c,
        fetcher: async () => json({ created: true, play: play.play }, 201),
      })
    ).play,
  ).toEqual(play.play);
  await expect(
    createStudioPlayV1(play.play.binding, {
      ...c,
      fetcher: async () => json({ created: true, play: play.play }, 200),
    }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  const other = { ...play.play.binding, operationKey: testUuid(100) };
  await expect(
    resolveStudioPlayV1(play.play.binding, {
      ...c,
      fetcher: async () =>
        json({
          schemaVersion: "quizforge.internal-play-resolution.v1",
          kind: "unresolved",
          binding: other,
          bindingSha256: await internalPlayBindingSha256(other),
        }),
    }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
});
it("read pages expose no consumer/Studio CSRF header and reject cross-product or ambiguous cursors", async () => {
  const fetcher = vi.fn<typeof fetch>(async () =>
    json({ productId: "synthetic", keys: [], nextCursor: null }),
  );
  const context = {
    signal: new AbortController().signal,
    csrf: "synthetic",
    fetcher,
  };
  expect((await readStudioKeysV1("synthetic", context)).keys).toEqual([]);
  const options = fetcher.mock.calls[0]![1]!;
  expect(options.headers).toEqual({ Accept: "application/json" });
  await expect(readStudioKeysV1("other", context)).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(() =>
    readStudioKeysV1("synthetic", context, {
      productId: "other",
      keyId: testUuid(1),
      issuedAt: testMoment,
    }),
  ).toThrow("INVALID_REQUEST");
});

it("reads the frozen parent-list envelope without the old draft response graph and revokes on old auth errors", async () => {
  const revoked = vi.fn(),
    context = {
      signal: new AbortController().signal,
      csrf: "synthetic",
      onAuthorityFailure: revoked,
    };
  expect(
    await readStudioParentVersionsV1("synthetic", {
      ...context,
      fetcher: async () =>
        json({ ok: true, value: { productId: "synthetic", versions: [] } }),
    }),
  ).toEqual({ productId: "synthetic", versions: [] });
  await expect(
    readStudioParentVersionsV1("synthetic", {
      ...context,
      fetcher: async () =>
        json({ code: "UNAUTHENTICATED", requestId: testUuid(1) }, 401),
    }),
  ).rejects.toMatchObject({ code: "ACCESS_DENIED" });
  expect(revoked).toHaveBeenCalledOnce();
});
