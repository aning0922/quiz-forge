import { describe, expect, it } from "vitest";
import {
  ConsumerError,
  CONSUMER_ERROR_STATUS,
  consumerErrorFact,
  consumerErrorResponseSchema,
} from "./errors";
const id = "00000000-0000-4000-8000-000000000001";
describe("consumer finite errors", () => {
  it("never reflects arbitrary fault text, fields or credentials", () => {
    const value = consumerErrorFact(
      Object.assign(new Error("synthetic-secret-sentinel"), {
        code: "OUTCOME_UNKNOWN",
        rawKey: "synthetic-secret-sentinel",
      }),
      id,
    );
    expect(value).toEqual({
      schemaVersion: "quizforge.consumer-error.v1",
      code: "UNAVAILABLE",
      requestId: id,
    });
    expect(JSON.stringify(value)).not.toContain("sentinel");
    expect(
      consumerErrorResponseSchema.safeParse({ ...value, message: "raw-error" })
        .success,
    ).toBe(false);
  });
  it("keeps finite statuses without any not-committed or retry permission in the error", () => {
    for (const code of Object.keys(
      CONSUMER_ERROR_STATUS,
    ) as (keyof typeof CONSUMER_ERROR_STATUS)[]) {
      const value = consumerErrorFact(new ConsumerError(code), id);
      expect(value.code).toBe(code);
      expect(
        consumerErrorResponseSchema.safeParse({ ...value, committed: false })
          .success,
      ).toBe(false);
    }
    expect(
      consumerErrorResponseSchema.safeParse({
        schemaVersion: "quizforge.consumer-error.v1",
        code: "raw-error",
        requestId: id,
      }).success,
    ).toBe(false);
  });
});
