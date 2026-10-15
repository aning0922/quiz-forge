import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { canonicalP1Json } from "../../v1/canonical";
import { computeCandidateSha256 } from "./candidate-hash";

const input = Object.freeze({
  archiveSha256: "a".repeat(64),
  canonicalManifestSha256: "b".repeat(64),
  canonicalContentSha256: "c".repeat(64),
  assetSetSha256: "d".repeat(64),
  identitySha256: "e".repeat(64),
});
it("preserves the exact existing six-field candidate protocol digest", () => {
  const legacyText = canonicalP1Json({
    schemaVersion: "quizpack-candidate-hash.v1",
    ...input,
  });
  expect(computeCandidateSha256(input)).toBe(
    createHash("sha256").update(legacyText, "utf8").digest("hex"),
  );
  for (const name of Object.keys(input) as (keyof typeof input)[])
    expect(
      computeCandidateSha256({ ...input, [name]: "f".repeat(64) }),
    ).not.toBe(computeCandidateSha256(input));
});
it("rejects wide input or a caller-supplied protocol rather than hashing unknown fields", () => {
  for (const extra of [{ schemaVersion: "other" }, { productId: "other" }])
    expect(() => computeCandidateSha256({ ...input, ...extra })).toThrow();
  expect(() =>
    computeCandidateSha256({ ...input, identitySha256: "A".repeat(64) }),
  ).toThrow();
});
