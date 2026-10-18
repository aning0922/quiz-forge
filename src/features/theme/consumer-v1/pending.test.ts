import { expect, it } from "vitest";
import { ConsumerAuthorityV1 } from "./authority";
import {
  prepareConsumerPendingV1 as prepare,
  markConsumerBeforeSendV1 as mark,
  readConsumerPendingV1,
  removeExactConsumerPendingV1 as remove,
  type ConsumerPendingStorage,
} from "./pending";
const prepareConsumerPendingV1 = (
  storage: ConsumerPendingStorage,
  operation: Parameters<typeof prepare>[1],
) => prepare(storage, operation, () => true);
const markConsumerBeforeSendV1 = (
  storage: ConsumerPendingStorage,
  pending: Parameters<typeof mark>[1],
) => mark(storage, pending, () => true);
const removeExactConsumerPendingV1 = (
  storage: ConsumerPendingStorage,
  pending: Parameters<typeof remove>[1],
) => remove(storage, pending, () => true);
import {
  consumerAnswersSha256,
  consumerProgressSha256,
  type ConsumerSaveInput,
} from "@/lib/consumer-contract/v1/state";

const uuid = (n: number) =>
  `11111111-1111-4111-8111-${String(n).padStart(12, "0")}`;
const session = {
  productId: "synthetic",
  keyId: uuid(1),
  sessionId: uuid(2),
  playVersionId: uuid(3),
  playSnapshotSha256: "a".repeat(64),
};
function storage(): ConsumerPendingStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => {
      m.set(k, v);
    },
    removeItem: (k) => {
      m.delete(k);
    },
  };
}
async function input(): Promise<ConsumerSaveInput> {
  const answers = [{ questionId: "first", optionId: "first-option" }],
    progress = { questionId: "first" };
  return {
    binding: {
      schemaVersion: "quizforge.consumer-save.v1",
      session,
      expectedStateRevision: 0,
      consumerStateAnswersSha256: await consumerAnswersSha256(answers),
      progressSha256: await consumerProgressSha256(progress),
    },
    answers,
    progress,
  };
}
it("persists and reads back before send; UNKNOWN does not remove or replace original binding", async () => {
  const s = storage(),
    i = await input(),
    pending = await prepareConsumerPendingV1(s, { kind: "save", input: i });
  expect(pending.mayHaveBeenSent).toBe(false);
  const sent = await markConsumerBeforeSendV1(s, pending);
  expect(sent.mayHaveBeenSent).toBe(true);
  expect(await readConsumerPendingV1(s, session)).toEqual(sent);
  await expect(
    prepareConsumerPendingV1(s, { kind: "save", input: i }),
  ).rejects.toMatchObject({ code: "PENDING_EXISTS" });
  await expect(removeExactConsumerPendingV1(s, pending)).rejects.toMatchObject({
    code: "PENDING_CHANGED",
  });
  await removeExactConsumerPendingV1(s, sent);
  expect(await readConsumerPendingV1(s, session)).toBeNull();
});
it("failed write/readback or wrong answer hash grants no sent anchor", async () => {
  const i = await input(),
    s = storage();
  s.setItem = () => {};
  await expect(
    prepareConsumerPendingV1(s, { kind: "save", input: i }),
  ).rejects.toMatchObject({ code: "PENDING_CHANGED" });
  i.binding.consumerStateAnswersSha256 = "f".repeat(64);
  await expect(
    prepareConsumerPendingV1(storage(), { kind: "save", input: i }),
  ).rejects.toMatchObject({ code: "PENDING_CORRUPT" });
});
it("full binding scope and current exact pending protect replacement anchors", async () => {
  const s = storage(),
    old = await prepareConsumerPendingV1(s, {
      kind: "save",
      input: await input(),
    });
  await expect(
    readConsumerPendingV1(s, {
      ...session,
      playSnapshotSha256: "f".repeat(64),
    }),
  ).rejects.toMatchObject({ code: "PENDING_CORRUPT" });
  await removeExactConsumerPendingV1(s, old);
  const i = await input();
  i.binding.expectedStateRevision = 1;
  const replacement = await prepareConsumerPendingV1(s, {
    kind: "save",
    input: i,
  });
  await expect(markConsumerBeforeSendV1(s, old)).rejects.toMatchObject({
    code: "PENDING_CHANGED",
  });
  expect(await readConsumerPendingV1(s, session)).toEqual(replacement);
});
it("revoked/switched authorization cannot be revived by old or forged tickets", () => {
  const a = new ConsumerAuthorityV1(session),
    old = a.ticket();
  expect(a.current(old)).toBe(true);
  expect(a.current({ ...old })).toBe(false);
  a.revoke();
  expect(a.current(old)).toBe(false);
  a.adopt(session);
  expect(a.current(old)).toBe(false);
  const fresh = a.ticket();
  expect(a.current(fresh)).toBe(true);
  a.adopt({ ...session, sessionId: uuid(4) });
  expect(a.current(fresh)).toBe(false);
});
it("revocation during async pending verification prevents both send marking and removal", async () => {
  const s = storage(),
    pending = await prepareConsumerPendingV1(s, {
      kind: "save",
      input: await input(),
    });
  for (const operation of [mark, remove]) {
    const authority = new ConsumerAuthorityV1(session),
      ticket = authority.ticket();
    const proxy: ConsumerPendingStorage = {
      ...s,
      getItem(key) {
        authority.revoke();
        return s.getItem(key);
      },
    };
    await expect(
      operation(proxy, pending, () => authority.current(ticket)),
    ).rejects.toMatchObject({ code: "PENDING_CHANGED" });
    expect(await readConsumerPendingV1(s, session)).toEqual(pending);
  }
});
