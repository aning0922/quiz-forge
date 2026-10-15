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

import type postgres from "postgres";
import { legacyValidationActivity, validationPolicyRow } from "./repository";
it("legacy quiescence scan is bounded and selects only stopping metadata across every old policy", async () => {
  const query = vi.fn(
    async (_parts: TemplateStringsArray, ..._values: unknown[]) => {
      void _parts;
      void _values;
      return [];
    },
  );
  await legacyValidationActivity(query as unknown as postgres.TransactionSql);
  const [parts, ...values] = query.mock.calls[0]!;
  const sql = parts.join("?");
  expect(sql).toBe(
    "SELECT status,storage_condition,reserved_bytes,lease_until,attempts_text,archive_policy_version FROM qf.quizpack_validation WHERE archive_policy_version<>? OR archive_policy_sha256<>? ORDER BY id LIMIT ?",
  );
  expect(values).toEqual([ARCHIVE_POLICY_VERSION, archivePolicySha256, 1025]);
  expect(sql).not.toMatch(
    /SELECT \*|canonical_|evidence_|report_text|identity_text/,
  );
});
it("pre-IO policy metadata query is scoped and has no body projection; missing scope fails closed", async () => {
  const row = {
    archive_policy_version: ARCHIVE_POLICY_VERSION,
    archive_policy_sha256: archivePolicySha256,
    identity_text: canonicalP1Json(supportedRuntimeIdentity(runtime)),
    identity_sha256: supportedRuntimeIdentity(runtime).identitySha256,
  };
  const query = vi.fn(
    async (_parts: TemplateStringsArray, ..._values: unknown[]) => {
      void _parts;
      void _values;
      return [row];
    },
  );
  const tx = query as unknown as postgres.TransactionSql;
  expect(
    await validationPolicyRow(tx, "synthetic", input.importId, input.importId),
  ).toBe(row);
  const [parts, ...values] = query.mock.calls[0]!;
  expect(parts.join("?")).toBe(
    "SELECT archive_policy_version,archive_policy_sha256,identity_text,identity_sha256 FROM qf.quizpack_validation WHERE product_id=? AND import_id=? AND id=?",
  );
  expect(values).toEqual(["synthetic", input.importId, input.importId]);
  query.mockResolvedValueOnce([]);
  await expect(
    validationPolicyRow(tx, "synthetic", input.importId, input.importId),
  ).rejects.toThrow("VALIDATION_NOT_FOUND");
});
