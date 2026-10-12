import { describe, expect, it, vi } from "vitest";
import {
  acquirePair,
  addPrepared,
  cancelPrepared,
  markBeforeStart,
  readPending,
  removeExact,
} from "./pending";
import { memoryStorage, tuple } from "./fixtures.test-support";
describe("single per-tab validation pending bucket", () => {
  it("persists false, marks true only under a synchronous gate, and forbids re-send", () => {
    const storage = memoryStorage();
    addPrepared(storage, tuple);
    expect(readPending(storage)[0]?.mayHaveBeenSent).toBe(false);
    expect(() => markBeforeStart(storage, tuple)).toThrow();
    const release = acquirePair(tuple);
    try {
      expect(() => acquirePair(tuple)).toThrow();
      expect(() => cancelPrepared(storage, tuple)).toThrow();
      markBeforeStart(storage, tuple);
      expect(() => markBeforeStart(storage, tuple)).toThrow();
    } finally {
      release();
    }
    expect(readPending(storage)[0]?.mayHaveBeenSent).toBe(true);
    expect(() => addPrepared(storage, tuple)).toThrow();
    expect(cancelPrepared(storage, tuple)).toBe(false);
  });
  it("retains conflicting tuples and does full compare-remove without touching another pair", () => {
    const storage = memoryStorage();
    addPrepared(storage, tuple);
    const second = { ...tuple, productId: "second" };
    addPrepared(storage, second);
    expect(() =>
      addPrepared(storage, { ...tuple, expectedValidationKey: "f".repeat(64) }),
    ).toThrow();
    expect(removeExact(storage, { ...tuple, archiveBytes: 124 }, false)).toBe(
      false,
    );
    expect(readPending(storage)).toHaveLength(2);
    expect(cancelPrepared(storage, tuple)).toBe(true);
    expect(readPending(storage)[0]?.tuple).toEqual(second);
  });
  it("allows exactly sixteen pairs and never evicts unknowns", () => {
    const storage = memoryStorage();
    for (let n = 0; n < 16; n++)
      addPrepared(storage, { ...tuple, productId: `synthetic-${n}` });
    const before = storage.value;
    expect(() =>
      addPrepared(storage, { ...tuple, productId: "seventeenth" }),
    ).toThrow();
    expect(storage.value).toBe(before);
    expect(readPending(storage)).toHaveLength(16);
  });
  it.each([
    "{",
    JSON.stringify({ schemaVersion: "future", entries: [] }),
    JSON.stringify({
      schemaVersion: "quizforge-validation-pending.v1",
      entries: [],
      secret: true,
    }),
    JSON.stringify({
      schemaVersion: "quizforge-validation-pending.v1",
      entries: [
        { tuple, mayHaveBeenSent: true },
        { tuple, mayHaveBeenSent: false },
      ],
    }),
    " ".repeat(65537),
    "界".repeat(30000),
    JSON.stringify({
      schemaVersion: "quizforge-validation-pending.v1",
      entries: [
        {
          tuple: { ...tuple, productId: "x".repeat(4097) },
          mayHaveBeenSent: false,
        },
      ],
    }),
  ])("preserves unreadable/oversized contents", (value) => {
    const storage = memoryStorage();
    storage.value = value;
    expect(() => readPending(storage)).toThrow();
    expect(() => addPrepared(storage, tuple)).toThrow();
    expect(storage.value).toBe(value);
  });
  it("does not roll back a failed readback that actually persisted true", () => {
    const storage = memoryStorage();
    addPrepared(storage, tuple);
    const get = storage.getItem.bind(storage);
    let reads = 0;
    storage.getItem = () => {
      reads++;
      return reads === 2 ? null : get("quizforge-validation-pending.v1");
    };
    const release = acquirePair(tuple);
    try {
      expect(() => markBeforeStart(storage, tuple)).toThrow();
    } finally {
      release();
    }
    storage.getItem = get;
    expect(readPending(storage)[0]?.mayHaveBeenSent).toBe(true);
  });
  it("blocks on getter/quota exceptions without clearing the bucket", () => {
    const storage = memoryStorage();
    addPrepared(storage, tuple);
    const before = storage.value;
    storage.setItem = vi.fn(() => {
      throw new Error("QuotaExceededError");
    });
    expect(() => cancelPrepared(storage, tuple)).toThrow();
    expect(storage.value).toBe(before);
    storage.getItem = vi.fn(() => {
      throw new Error("denied");
    });
    expect(() => readPending(storage)).toThrow();
    expect(storage.value).toBe(before);
  });
});
