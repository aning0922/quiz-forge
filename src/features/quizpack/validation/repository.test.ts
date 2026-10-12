import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { validationKey, assetSetLedgerSchema } from "./repository";
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

describe("asset-set ledger order", () => {
  const resource = (resourceId: string) => ({
    resourceId,
    resourceVersion: "1.0.0",
    productId: "synthetic",
    blobSha256: "a".repeat(64),
    declarationSha256: "b".repeat(64),
  });
  const set = (ids: string[]) => ({
    schemaVersion: "quizpack-candidate-asset-set.v1",
    productId: "synthetic",
    resources: ids.map(resource),
  });
  it("accepts prefix ids in A's field order", () => {
    expect(assetSetLedgerSchema.safeParse(set(["a", "a-cover"])).success).toBe(
      true,
    );
  });
  it("rejects reversed or duplicate fields", () => {
    expect(assetSetLedgerSchema.safeParse(set(["a-cover", "a"])).success).toBe(
      false,
    );
    expect(assetSetLedgerSchema.safeParse(set(["a", "a"])).success).toBe(false);
  });
});
