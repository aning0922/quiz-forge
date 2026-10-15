import { expect, it } from "vitest";
import { z } from "zod";
import { output, snapshot, shapeFailure } from "./boundary";
import { scoringFailureSchema } from "@/lib/assessment-contract/scoring-api-v1";
it("checks the actual serialized whole output including escaping and UTF-8, without returning truncated success", () => {
  const value = { a: '汉"\\', b: '字"\\' };
  const bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  expect(output(z.unknown(), value, bytes)).toEqual({ ok: true, value });
  expect(output(z.unknown(), value, bytes - 1)).toMatchObject({
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
