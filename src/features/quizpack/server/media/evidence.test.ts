import { describe, expect, it } from "vitest";
import { classifyMediaFailure } from "./contracts";
import { parseLaunchResult, parseMediaRuntimeBinding } from "./evidence";
const hash = "a".repeat(64);
const runId = "626e311b-4211-4f35-b874-a39d801b2df6";
const binding = {
  schema: "quizpack-media-runtime-binding.v1",
  platform: "darwin-arm64",
  componentId: hash,
  deploymentId: hash,
  runtimeBundleHash: hash,
  limitsHash: hash,
};
const failed = {
  outcome: "failed",
  runId,
  profileId: hash,
  code: "STOP_UNCONFIRMED",
  stopped: "unknown",
};
const json = (value: unknown) => Buffer.from(JSON.stringify(value));
describe("bounded media evidence", () => {
  it("parses a strict safe runtime binding", () => {
    expect(parseMediaRuntimeBinding(json(binding))).toEqual({
      ok: true,
      value: binding,
    });
  });
  it.each([
    { ...binding, root: "/synthetic/root" },
    { ...binding, componentId: "short" },
    { ...binding, platform: "unknown" },
  ])("rejects extra, invalid or unknown binding facts", (value) => {
    expect(parseMediaRuntimeBinding(json(value)).ok).toBe(false);
  });
  it("rejects oversized bytes, invalid UTF-8, duplicate keys and BOM", () => {
    for (const bytes of [
      Buffer.alloc(1025),
      Buffer.from([255]),
      Buffer.from('{"schema":1,"schema":2}'),
      Buffer.concat([Buffer.from([239, 187, 191]), json(binding)]),
    ])
      expect(parseMediaRuntimeBinding(bytes).ok).toBe(false);
  });
  it("retains unknown stop evidence and rejects inconsistent claims", () => {
    expect(parseLaunchResult(json(failed))).toEqual({
      ok: true,
      value: failed,
    });
    for (const value of [
      { ...failed, stopped: "confirmed" },
      { ...failed, code: "DECODE_REJECTED" },
      { ...failed, rawError: "synthetic error" },
    ])
      expect(parseLaunchResult(json(value)).ok).toBe(false);
  });
  it("decoded facts require actual confirmed stop and bounded pixel facts", () => {
    const value = {
      outcome: "decoded",
      runId,
      profileId: hash,
      stopped: "confirmed",
      facts: {
        mediaType: "image/png",
        width: 2,
        height: 2,
        frames: 1,
        mediaDecoded: true,
      },
    };
    const result = parseLaunchResult(json(value));
    expect(result).toEqual({ ok: true, value });
    if (result.ok && result.value.outcome === "decoded")
      expect(Object.isFrozen(result.value.facts)).toBe(true);
    expect(parseLaunchResult(json({ ...value, stopped: "unknown" })).ok).toBe(
      false,
    );
    expect(
      parseLaunchResult(
        json({
          ...value,
          facts: { ...value.facts, width: 8192, height: 8192 },
        }),
      ).ok,
    ).toBe(false);
  });
  it("classifies content rejection separately from recoverable runtime failure", () => {
    expect(classifyMediaFailure("DECODE_REJECTED")).toBe("content-rejected");
    for (const code of [
      "INVALID_INPUT",
      "WORKER_FAILED",
      "OUTPUT_INVALID",
      "STOP_UNCONFIRMED",
      "ISOLATION_UNAVAILABLE",
      "CANCELLED",
      "DEADLINE_EXCEEDED",
    ] as const)
      expect(classifyMediaFailure(code)).toBe("interrupted");
  });
});
