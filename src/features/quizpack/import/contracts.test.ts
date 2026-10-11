import { expect, it } from "vitest";
import {
  createImportIntentSchema,
  importListQuerySchema,
  recoverReceiveSchema,
} from "./contracts";
import { createReceiveContext, remainingReceiveMs } from "./context";
it("rejects extra fields, noncanonical keys, invalid sizes and recovery revisions", () => {
  const input = {
    expectedArchiveSha256: "a".repeat(64),
    expectedArchiveBytes: 1,
    target: { kind: "new-draft" },
  };
  expect(createImportIntentSchema.safeParse(input).success).toBe(true);
  for (const bad of [
    { ...input, extra: true },
    { ...input, expectedArchiveBytes: 0 },
    { ...input, expectedArchiveBytes: 33554433 },
    { ...input, target: { kind: "new-draft", code: "x" } },
  ])
    expect(createImportIntentSchema.safeParse(bad).success).toBe(false);
  expect(
    importListQuerySchema.safeParse({
      idempotencyKey: "AAAAAAAA-AAAA-AAAA-AAAA-AAAAAAAAAAAA",
    }).success,
  ).toBe(false);
  expect(importListQuerySchema.safeParse({ unknown: true }).success).toBe(
    false,
  );
  expect(
    recoverReceiveSchema.safeParse({ expectedStateRevision: 2147483648 })
      .success,
  ).toBe(false);
});
it("keeps handler deadline across layers and combines cancellation", () => {
  const controller = new AbortController();
  const { context, dispose } = createReceiveContext(
    controller.signal,
    performance.now() - 60001,
  );
  expect(() => remainingReceiveMs(context)).toThrow("RECEIVE_TIMEOUT");
  dispose();
  const current = createReceiveContext(controller.signal);
  expect(remainingReceiveMs(current.context)).toBeGreaterThan(0);
  controller.abort();
  expect(() => remainingReceiveMs(current.context)).toThrow("RECEIVE_TIMEOUT");
  current.dispose();
});
