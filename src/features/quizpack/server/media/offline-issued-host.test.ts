import { describe, expect, it } from "vitest";
import {
  initialIssuedDeadline,
  isOwnIssuedRecord,
  planIssuedInterruption,
} from "../../../../../scripts/quizpack-media-preflight/macos/deadline-host";

const record = (change: Record<string, unknown> = {}) =>
  Buffer.from(
    JSON.stringify({
      schema: "mac-media-active.v1",
      runId: "11111111-2222-4333-8444-555555555555",
      profileId: "a".repeat(64),
      phase: "issued",
      pid: null,
      workerStart: null,
      ownerPid: 123,
      createdAt: "2026-10-12T00:00:00.000Z",
      ...change,
    }),
  );
describe("offline issued persistence interruption barrier", () => {
  it("retains the absolute target deadline after slow asynchronous initialization", () => {
    const deadline = initialIssuedDeadline(1000, true);
    expect(deadline).toBe(6000);
    for (const now of [1001, 5800, 6001]) {
      expect(
        planIssuedInterruption(record(), 123, "deadline", deadline, now, true),
      ).toEqual({
        observed: true,
        interrupt: "deadline",
        untilMonotonicMs: 6200,
      });
      expect(deadline).toBe(6000);
    }
  });
  it("aborts at the same issued barrier without adding or resetting a deadline", () => {
    const deadline = initialIssuedDeadline(1000, true);
    expect(
      planIssuedInterruption(record(), 123, "abort", deadline, 5800, true),
    ).toEqual({ observed: true, interrupt: "abort" });
    expect(deadline).toBe(6000);
  });
  it("preserves the legacy 500ms context and 700ms persistence delay", () => {
    expect(initialIssuedDeadline(1000, false)).toBe(1500);
    expect(
      planIssuedInterruption(record(), 123, "deadline", 1500, 1200, false),
    ).toEqual({
      observed: true,
      interrupt: "deadline",
      untilMonotonicMs: 1900,
    });
  });
  it.each([
    { ownerPid: 124 },
    { phase: "prepared" },
    { phase: "spawned" },
    { phase: "unknown" },
    { pid: 456 },
    { workerStart: { sec: 1, usec: 0 } },
    { schema: "other" },
    { profileId: "invalid" },
    { runId: "invalid" },
    { createdAt: "invalid" },
    { unknown: true },
  ])("never observes an unrelated or malformed record: %j", (change) => {
    expect(isOwnIssuedRecord(record(change), 123)).toBe(false);
    expect(
      planIssuedInterruption(record(change), 123, "deadline", 6000, 5000, true),
    ).toEqual({ observed: false });
  });
  it("rejects truncated, oversized, duplicate-key and invalid UTF-8 record bytes", () => {
    for (const bytes of [
      Buffer.from("{"),
      Buffer.alloc(16385),
      Buffer.from([0xff]),
      Buffer.from(
        record()
          .toString()
          .replace('"ownerPid":123', '"ownerPid":124,"ownerPid":123'),
      ),
    ]) {
      expect(isOwnIssuedRecord(bytes, 123)).toBe(false);
    }
    expect(isOwnIssuedRecord(record(), 0)).toBe(false);
    expect(isOwnIssuedRecord(record(), Number.NaN)).toBe(false);
    expect(isOwnIssuedRecord(record(), 123)).toBe(true);
  });
  it.each([Number.NaN, Infinity, -1])(
    "rejects invalid original clock values: %s",
    (value) => {
      expect(() => initialIssuedDeadline(value, true)).toThrow(
        "INVALID_SYNTHETIC_CONTEXT",
      );
      expect(() =>
        planIssuedInterruption(record(), 123, "deadline", value, 1000, true),
      ).toThrow("INVALID_SYNTHETIC_CONTEXT");
      expect(() =>
        planIssuedInterruption(record(), 123, "deadline", 6000, value, true),
      ).toThrow("INVALID_SYNTHETIC_CONTEXT");
    },
  );
});
