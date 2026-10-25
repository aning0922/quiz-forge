import { describe, expect, it } from "vitest";
import {
  ownedPendingStorage,
  hasUnownedPending,
  legacyPendingKeys,
} from "./owned-storage";
import { passwordProblem } from "./presentation";

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
    const key = legacyPendingKeys[0];
    values.set(key, original);
    const a = ownedPendingStorage(storage, "account-a"),
      b = ownedPendingStorage(storage, "account-b");
    expect(hasUnownedPending(storage)).toBe(true);
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
  it("preserves malformed legacy bytes as an actionable unowned record", () => {
    const storage = {
      getItem: (key: string) =>
        key === legacyPendingKeys[0] ? "{unreadable" : null,
    };
    expect(hasUnownedPending(storage)).toBe(true);
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
