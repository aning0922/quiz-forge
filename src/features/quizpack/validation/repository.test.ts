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

import { isCurrentValidation, requireCurrentValidation } from "./repository";
import {
  runtimeIdentity,
  supportedRuntimeIdentity,
} from "../server/validation/identity";
import { canonicalP1Json } from "../v1/canonical";
import {
  ARCHIVE_POLICY_VERSION,
  archivePolicySha256,
  LEGACY_ARCHIVE_POLICY_VERSION,
  legacyArchivePolicySha256,
} from "./policy";
const runtime = {
  schema: "quizpack-media-runtime-binding.v1",
  platform: "darwin-arm64",
  componentId: "a".repeat(64),
  deploymentId: "b".repeat(64),
  runtimeBundleHash: "c".repeat(64),
  limitsHash: "d".repeat(64),
} as const;
it("current admission binds the full policy and identity, while historical identity remains readable", () => {
  const current = supportedRuntimeIdentity(runtime),
    old = runtimeIdentity(runtime);
  const row = {
    archive_policy_version: ARCHIVE_POLICY_VERSION,
    archive_policy_sha256: archivePolicySha256,
    identity_text: canonicalP1Json(current),
    identity_sha256: current.identitySha256,
  };
  expect(isCurrentValidation(row)).toBe(true);
  for (const changed of [
    { ...row, archive_policy_sha256: "f".repeat(64) },
    {
      ...row,
      identity_text: canonicalP1Json(old),
      identity_sha256: old.identitySha256,
    },
    {
      ...row,
      archive_policy_version: LEGACY_ARCHIVE_POLICY_VERSION,
      archive_policy_sha256: legacyArchivePolicySha256,
      identity_text: canonicalP1Json(old),
      identity_sha256: old.identitySha256,
    },
    { ...row, identity_sha256: "e".repeat(64) },
    { ...row, identity_text: "{" },
  ]) {
    expect(isCurrentValidation(changed)).toBe(false);
    expect(() => requireCurrentValidation(changed)).toThrow(
      "VALIDATION_REVALIDATION_REQUIRED",
    );
  }
});
