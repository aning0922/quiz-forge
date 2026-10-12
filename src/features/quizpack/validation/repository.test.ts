import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { validationKey } from "./repository";
const input = {
  productId: "synthetic",
  importId: "00000000-0000-0000-0000-000000000001",
  archiveSha256: "a".repeat(64),
  archiveBytes: 1,
  identitySha256: "b".repeat(64),
  archivePolicyVersion: "quizpack-private-archive.v1",
  archivePolicySha256: "c".repeat(64),
};
describe("validation key binding", () => {
  it("is stable and binds each authoritative input", () => {
    expect(validationKey(input)).toBe(validationKey({ ...input }));
    expect(validationKey({ ...input, archiveBytes: 2 })).not.toBe(
      validationKey(input),
    );
  });
  it("rejects unknown fields and schema override", () => {
    const override = { ...input, schemaVersion: "attacker" };
    expect(() => validationKey(override)).toThrow("INVALID_REQUEST");
    const wide = { ...input, extra: true };
    expect(() => validationKey(wide)).toThrow("INVALID_REQUEST");
  });
});
