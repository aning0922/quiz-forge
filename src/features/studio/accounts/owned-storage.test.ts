import { describe, expect, it } from "vitest";
import { ownedPendingStorage } from "./owned-storage";
import { isSetupReceipt, passwordProblem } from "./presentation";

describe("account-owned pending records", () => {
  it("retains exact tuple bytes and never adopts/deletes legacy or another account's bucket", () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const original =
      '{"entries":[{"tuple":{"key":"original"},"mayHaveBeenSent":true}]}';
    const key = "quizforge.studio.draft-applications.v1";
    values.set(key, original);
    const a = ownedPendingStorage(storage, "account-a"),
      b = ownedPendingStorage(storage, "account-b");
    expect(a.getItem(key)).toBeNull();
    expect(b.getItem(key)).toBeNull();
    a.setItem(key, original);
    expect(a.getItem(key)).toBe(original);
    expect(b.getItem(key)).toBeNull();
    b.setItem(key, '{"entries":[]}');
    expect(a.getItem(key)).toBe(original);
    expect(storage.getItem(key)).toBe(original);
    const ownedKey = [...values.keys()].find((k) => k.includes("account-a:"))!;
    const envelope = JSON.parse(values.get(ownedKey)!);
    envelope.operatorId = "account-b";
    values.set(ownedKey, JSON.stringify(envelope));
    expect(() => a.getItem(key)).toThrow("PENDING_OWNER_MISMATCH");
    expect(storage.getItem(key)).toBe(original);
  });
  it("reads only the current owner's envelope and leaves unowned malformed bytes untouched", () => {
    const values = new Map([
      ["quizforge.studio.draft-applications.v1", "{unreadable"],
      ["unrelated-old-bucket", "old bytes"],
    ]);
    const reads: string[] = [];
    const storage = {
      getItem: (key: string) => {
        reads.push(key);
        return values.get(key) ?? null;
      },
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
    };
    const owned = ownedPendingStorage(storage, "account-a");
    const key = "quizforge.studio.draft-applications.v1";
    expect(owned.getItem(key)).toBeNull();
    expect(reads).toEqual(["quizforge.studio.owned.v1:account-a:" + key]);
    expect([...values]).toEqual([
      [key, "{unreadable"],
      ["unrelated-old-bucket", "old bytes"],
    ]);
  });
});
it("checks NFC code points and byte bounds without trimming or truncation", () => {
  expect(passwordProblem(" ".repeat(15))).toBeNull();
  expect(passwordProblem("e\u0301".repeat(15))).toBeNull();
  expect(passwordProblem("😀".repeat(256))).toBeNull();
  expect(passwordProblem("😀".repeat(257))).not.toBeNull();
  expect(passwordProblem("x".repeat(14))).not.toBeNull();
  expect(passwordProblem("x".repeat(14) + "\ud800")).not.toBeNull();
});

it("only a finite matching bearer setup receipt may end UNKNOWN", () => {
  const id = "00000000-0000-4000-8000-000000000001";
  const receipt = {
    operationId: id,
    action: "password-setup",
    actorId: null,
    targetId: id,
    status: "completed",
    errorCode: null,
    createdAt: "2026-10-25T00:00:00.000Z",
  };
  expect(isSetupReceipt(receipt, id)).toBe(true);
  for (const changed of [
    { status: "unknown" },
    { actorId: "invalid" },
    { operationId: "different" },
    { targetId: "" },
    { createdAt: "invalid" },
  ])
    expect(isSetupReceipt({ ...receipt, ...changed }, id)).toBe(false);
});
