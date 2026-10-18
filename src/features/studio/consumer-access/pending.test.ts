import { expect, it } from "vitest";
import { digestConsumerToken } from "@/lib/consumer-contract/v1/credentials";
import {
  newStudioIssueV1,
  prepareStudioConsumerPendingV1 as prepare,
  readStudioConsumerPendingV1 as read,
  markStudioConsumerBeforeSendV1 as mark,
  removeExactStudioConsumerPendingV1 as remove,
  type StudioConsumerScopeV1,
} from "./pending";
import type { ConsumerPendingStorage } from "@/features/theme/consumer-v1/pending";
const scope: StudioConsumerScopeV1 = {
  origin: "http://127.0.0.1:3201",
  instanceId: "a".repeat(32),
  issuerId: "11111111-1111-4111-8111-111111111111",
  productId: "synthetic",
};
const play = {
  productId: scope.productId,
  playVersionId: "11111111-1111-4111-8111-111111111112",
  playSnapshotSha256: "a".repeat(64),
};
function storage() {
  const values = new Map<string, string>();
  return {
    values,
    api: {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
      removeItem: (k: string) => {
        values.delete(k);
      },
    } satisfies ConsumerPendingStorage,
  };
}
it("mints one local raw/digest and requires complete escrow/readback before sent marking", async () => {
  const s = storage(),
    issue = await newStudioIssueV1(play);
  expect(issue.binding.validForSeconds).toBe(604800);
  expect(await digestConsumerToken(issue.raw, "access-key")).toBe(
    issue.binding.credentialDigest,
  );
  const pending = await prepare(s.api, scope, issue, () => true);
  expect(pending.mayHaveBeenSent).toBe(false);
  const sent = await mark(s.api, pending, () => true);
  expect(sent.mayHaveBeenSent).toBe(true);
  expect(await read(s.api, scope)).toEqual(sent);
  await expect(
    prepare(s.api, scope, await newStudioIssueV1(play), () => true),
  ).rejects.toThrow("STUDIO_CONSUMER_PENDING_UNAVAILABLE");
  await expect(remove(s.api, pending, () => true)).rejects.toThrow();
  expect(await read(s.api, scope)).toEqual(sent);
});
it("issuer, instance and product isolate buckets; origin is checked inside each record", async () => {
  const s = storage();
  await prepare(s.api, scope, await newStudioIssueV1(play), () => true);
  expect(
    await read(s.api, { ...scope, issuerId: play.playVersionId }),
  ).toBeNull();
  expect(
    await read(s.api, { ...scope, instanceId: "b".repeat(32) }),
  ).toBeNull();
  expect(await read(s.api, { ...scope, productId: "other" })).toBeNull();
  await expect(
    read(s.api, { ...scope, origin: "http://127.0.0.1:3202" }),
  ).rejects.toThrow();
});
it("raw loss never reconstructs a secret or permits issue replay; original binding remains readable", async () => {
  const s = storage(),
    pending = await prepare(
      s.api,
      scope,
      await newStudioIssueV1(play),
      () => true,
    );
  const sent = await mark(s.api, pending, () => true),
    storageKey = [...s.values.keys()][0]!;
  const stored = JSON.parse(s.values.get(storageKey)!);
  stored.operation.raw = null;
  s.values.set(storageKey, JSON.stringify(stored));
  const missing = await read(s.api, scope);
  expect(missing?.operation.kind).toBe("issue");
  if (missing?.operation.kind !== "issue") throw Error("synthetic fixture");
  expect(missing.operation.raw).toBeNull();
  expect(missing.operation.binding).toEqual(sent.operation.binding);
  await expect(mark(s.api, missing, () => true)).rejects.toThrow();
});
it("failed write, mismatched raw/digest and async authority loss permit no sent anchor", async () => {
  const s = storage(),
    issue = await newStudioIssueV1(play);
  s.api.setItem = () => {};
  await expect(prepare(s.api, scope, issue, () => true)).rejects.toThrow();
  const t = storage();
  await expect(
    prepare(
      t.api,
      scope,
      {
        ...issue,
        binding: { ...issue.binding, credentialDigest: "f".repeat(64) },
      },
      () => true,
    ),
  ).rejects.toThrow();
  expect(t.values.size).toBe(0);
  const original = await prepare(t.api, scope, issue, () => true);
  let current = true;
  const proxy: ConsumerPendingStorage = {
    ...t.api,
    getItem(k) {
      current = false;
      return t.api.getItem(k);
    },
  };
  await expect(mark(proxy, original, () => current)).rejects.toThrow();
  expect((await read(t.api, scope))?.mayHaveBeenSent).toBe(false);
});
it("exact pending comparison blocks deletion/replacement after a newer original is prepared", async () => {
  const s = storage(),
    original = await prepare(
      s.api,
      scope,
      await newStudioIssueV1(play),
      () => true,
    );
  await remove(s.api, original, () => true);
  const newer = await prepare(
    s.api,
    scope,
    await newStudioIssueV1(play),
    () => true,
  );
  await expect(remove(s.api, original, () => true)).rejects.toThrow();
  expect(await read(s.api, scope)).toEqual(newer);
});
