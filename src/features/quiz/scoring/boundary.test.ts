import { expect, it } from "vitest";
import { z } from "zod";
import { output, snapshot, shapeFailure } from "./boundary";
import {
  SCORING_API_LIMITS,
  scoringFailureSchema,
} from "@/lib/assessment-contract/scoring-api-v1";
it("checks the actual serialized whole output including escaping and UTF-8, without returning truncated success", () => {
  const value = { a: '汉"\\', b: '字"\\' };
  const bytes = Buffer.byteLength(JSON.stringify({ ok: true, value }), "utf8");
  expect(
    output(z.strictObject({ a: z.string(), b: z.string() }), value, bytes),
  ).toEqual({ ok: true, value });
  expect(output(z.unknown(), value, bytes - 1)).toMatchObject({
    ok: false,
    issues: [{ code: "INPUT_LIMIT_EXCEEDED" }],
  });
});
it.each(["", '汉字🙂"\\\n\t'])(
  "bounds the complete 64KiB result exactly, including UTF-8 and escaping: %j",
  (text) => {
    const schema = z.strictObject({ padding: z.string() });
    const limit = SCORING_API_LIMITS.scoreBytes;
    const overhead = Buffer.byteLength(
      JSON.stringify({ ok: true, value: { padding: text } }),
      "utf8",
    );
    const value = { padding: text + "a".repeat(limit - overhead) };
    const result = output(schema, value, limit);
    expect(result).toEqual({ ok: true, value });
    expect(Buffer.byteLength(JSON.stringify(result), "utf8")).toBe(limit);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.ok) expect(Object.isFrozen(result.value)).toBe(true);
    const plusOne = { padding: value.padding + "a" };
    expect(
      Buffer.byteLength(JSON.stringify({ ok: true, value: plusOne }), "utf8"),
    ).toBe(limit + 1);
    expect(output(schema, plusOne, limit)).toMatchObject({
      ok: false,
      issues: [{ code: "INPUT_LIMIT_EXCEEDED" }],
    });
  },
);
it("rejects a payload that fits 64KiB by itself but exceeds the public envelope budget", () => {
  const schema = z.strictObject({ padding: z.string() });
  const limit = SCORING_API_LIMITS.scoreBytes;
  const payloadOverhead = Buffer.byteLength(
    JSON.stringify({ padding: "" }),
    "utf8",
  );
  const value = { padding: "a".repeat(limit - payloadOverhead) };
  expect(Buffer.byteLength(JSON.stringify(value), "utf8")).toBe(limit);
  expect(Buffer.byteLength(JSON.stringify({ ok: true, value }), "utf8")).toBe(
    limit + 20,
  );
  expect(output(schema, value, limit)).toMatchObject({
    ok: false,
    issues: [{ code: "INPUT_LIMIT_EXCEEDED" }],
  });
});
it("rejects depth overflow before parsing and emits only bounded fixed-path issues", () => {
  let value: unknown = 0;
  for (let i = 0; i < 33; i++) value = { nested: value };
  expect(snapshot(value, 2097152, "INVALID_DEFINITION")).toMatchObject({
    ok: false,
    issues: [{ code: "INPUT_LIMIT_EXCEEDED" }],
  });
  const parsed = z
    .array(z.strictObject({ id: z.literal("allowed") }))
    .safeParse(Array.from({ length: 100 }, () => ({ id: "private" })));
  if (parsed.success) throw new Error("TEST_EXPECTED_SHAPE_ERROR");
  const result = shapeFailure(parsed.error, "INVALID_DEFINITION");
  expect(scoringFailureSchema.safeParse(result).success).toBe(true);
  expect(result).toMatchObject({ ok: false, issuesTruncated: true });
  if (!result.ok) expect(result.issues).toHaveLength(32);
  expect(JSON.stringify(result)).not.toContain("private");
});
