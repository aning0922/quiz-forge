import { describe, expect, it } from "vitest";
import {
  historicalDemoQuestions,
  historicalDemoVersion,
  readHistoricalDemoProgress,
} from "./historical-demo";

describe("historical demo local-progress adapter", () => {
  it("accepts only a versioned answer set from the controlled question list", () => {
    const saved = readHistoricalDemoProgress(
      JSON.stringify({
        version: historicalDemoVersion,
        answers: { pace: 1 },
        updatedAt: "2026-10-11T10:00:00.000Z",
      }),
    );
    expect(saved?.answers).toEqual({ pace: 1 });
    expect(historicalDemoQuestions).toHaveLength(12);
  });
  it("rejects corrupt, stale, unknown and out-of-range local values without normalizing them", () => {
    for (const value of [
      "not-json",
      JSON.stringify({
        version: 0,
        answers: {},
        updatedAt: new Date().toISOString(),
      }),
      JSON.stringify({
        version: historicalDemoVersion,
        answers: { unknown: 0 },
        updatedAt: new Date().toISOString(),
      }),
      JSON.stringify({
        version: historicalDemoVersion,
        answers: { pace: 9 },
        updatedAt: new Date().toISOString(),
      }),
      JSON.stringify({
        version: historicalDemoVersion,
        answers: [],
        updatedAt: new Date().toISOString(),
      }),
      JSON.stringify({
        version: historicalDemoVersion,
        answers: { pace: 1.5 },
        updatedAt: new Date().toISOString(),
      }),
      JSON.stringify({
        version: historicalDemoVersion,
        answers: { pace: 1 },
        updatedAt: "not-a-date",
      }),
    ])
      expect(() => readHistoricalDemoProgress(value)).toThrow(
        "Invalid saved progress",
      );
  });
});
