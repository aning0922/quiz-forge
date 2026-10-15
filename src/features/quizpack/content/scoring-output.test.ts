import { expect, it, vi } from "vitest";
import { z } from "zod";
import { contentScoringOutput } from "./scoring-output";

it.each([
  ["score", 65536],
  ["evidence", 2097152],
] as const)(
  "bounds the complete %s envelope, including escaped UTF-8 and wrapper overhead",
  (kind, budget) => {
    const schema = z.strictObject({ text: z.string() });
    const overhead = Buffer.byteLength(
      JSON.stringify({ ok: true, value: { text: "" } }),
    );
    const prefix = '文\\"',
      prefixBytes = Buffer.byteLength(JSON.stringify(prefix)) - 2;
    const exact = {
      text: prefix + "x".repeat(budget - overhead - prefixBytes),
    };
    expect(Buffer.byteLength(JSON.stringify({ ok: true, value: exact }))).toBe(
      budget,
    );
    const accepted = contentScoringOutput(schema, exact, kind);
    expect(accepted.ok).toBe(true);
    expect(Object.isFrozen(accepted)).toBe(true);
    if (accepted.ok) expect(Object.isFrozen(accepted.value)).toBe(true);
    const excessive = { text: exact.text + "x" };
    expect(Buffer.byteLength(JSON.stringify(excessive))).toBeLessThanOrEqual(
      budget,
    );
    expect(contentScoringOutput(schema, excessive, kind)).toMatchObject({
      ok: false,
      issues: [{ code: "INPUT_LIMIT_EXCEEDED" }],
    });
  },
);
it("does not evaluate accessors or leak custom fields during output checks", () => {
  const get = vi.fn(),
    value = {};
  Object.defineProperty(value, "text", { get, enumerable: true });
  expect(
    contentScoringOutput(z.strictObject({ text: z.string() }), value, "score"),
  ).toMatchObject({ ok: false, issues: [{ code: "INVALID_DEFINITION" }] });
  expect(get).not.toHaveBeenCalled();
  const rejected = contentScoringOutput(
    z.strictObject({ text: z.string() }),
    { text: "okay", secret: "SECRET" },
    "score",
  );
  expect(rejected.ok).toBe(false);
  expect(JSON.stringify(rejected)).not.toContain("SECRET");
});
