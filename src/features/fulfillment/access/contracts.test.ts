import { describe, expect, it } from "vitest";
import {
  issueAccessKeyBindingSchema,
  issueAccessKeyBindingSha256,
  issueAccessKeyReceiptSchema,
  voidUnusedAccessKeyBindingSha256,
  accessKeyDetailSchema,
  accessKeyListSchema,
  verifyAccessKeyDetail,
  verifyIssueAccessKeyReceipt,
  type IssueAccessKeyReceipt,
  type VoidUnusedAccessKeyReceipt,
} from "./contracts";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
const sha = "a".repeat(64);
const issuedAt = "2026-10-18T00:00:00.123Z";
async function fixture() {
  const binding = {
    schemaVersion: "quizforge.access-key-issue.v1" as const,
    operationKey: uuid(1),
    keyId: uuid(2),
    play: {
      productId: "test-product",
      playVersionId: uuid(3),
      playSnapshotSha256: sha,
    },
    credentialDigest: sha,
    validForSeconds: 3600,
  };
  const issue: IssueAccessKeyReceipt = {
    schemaVersion: "quizforge.access-key-issue-receipt.v1",
    binding,
    bindingSha256: await issueAccessKeyBindingSha256(binding),
    issuedBy: uuid(4),
    issuedAt,
    expiresAt: "2026-10-18T01:00:00.123Z",
  };
  const voidBinding = {
    schemaVersion: "quizforge.access-key-void-unused.v1" as const,
    productId: "test-product",
    operationKey: uuid(5),
    keyId: binding.keyId,
    issueBindingSha256: issue.bindingSha256,
  };
  const voidReceipt: VoidUnusedAccessKeyReceipt = {
    schemaVersion: "quizforge.access-key-void-unused-receipt.v1",
    binding: voidBinding,
    bindingSha256: await voidUnusedAccessKeyBindingSha256(voidBinding),
    voidedBy: uuid(4),
    revokedAt: "2026-10-18T00:01:00.000Z",
  };
  const current = {
    observedAt: "2026-10-18T02:00:00.000Z",
    claim: null,
    completion: null,
    voidReceipt: null,
  };
  return { issue, voidReceipt, detail: { issue, current } };
}
describe("access issue and unused-void contract draft", () => {
  it("fixes duration at issue instead of a client-chosen expiry and keeps expired historical receipt valid", async () => {
    const { detail, issue } = await fixture();
    expect(await verifyAccessKeyDetail(detail)).toEqual(detail);
    expect(
      issueAccessKeyBindingSchema.safeParse({
        ...issue.binding,
        expiresAt: issue.expiresAt,
      }).success,
    ).toBe(false);
    expect(
      issueAccessKeyReceiptSchema.safeParse({
        ...issue,
        expiresAt: "2026-10-18T01:00:00.124Z",
      }).success,
    ).toBe(false);
    for (const validForSeconds of [3599, 2592001, 3600.5])
      expect(
        issueAccessKeyBindingSchema.safeParse({
          ...issue.binding,
          validForSeconds,
        }).success,
      ).toBe(false);
    for (const validForSeconds of [3600, 2592000])
      expect(
        issueAccessKeyBindingSchema.safeParse({
          ...issue.binding,
          validForSeconds,
        }).success,
      ).toBe(true);
  });
  it("does not accept raw, URLs, extra capabilities or a digest with invalid shape", async () => {
    const { issue } = await fixture();
    for (const extra of [
      { rawKey: "synthetic-not-a-key" },
      { recoveryUrl: "/access#key=synthetic" },
      { active: true },
    ])
      expect(
        issueAccessKeyBindingSchema.safeParse({ ...issue.binding, ...extra })
          .success,
      ).toBe(false);
    expect(
      issueAccessKeyBindingSchema.safeParse({
        ...issue.binding,
        credentialDigest: "A".repeat(64),
      }).success,
    ).toBe(false);
    await expect(
      verifyIssueAccessKeyReceipt({
        ...issue,
        binding: { ...issue.binding, validForSeconds: 7200 },
        expiresAt: "2026-10-18T02:00:00.123Z",
      }),
    ).rejects.toThrow("ACCESS_KEY_CONTRACT_MISMATCH");
  });
  it("keeps void as an independently bound terminal fact and forbids void plus claim/report", async () => {
    const { detail, voidReceipt } = await fixture();
    const revoked = { ...detail, current: { ...detail.current, voidReceipt } };
    expect(await verifyAccessKeyDetail(revoked)).toEqual(revoked);
    const claim = { sessionId: uuid(6), claimedAt: "2026-10-18T00:00:30.000Z" };
    expect(
      accessKeyDetailSchema.safeParse({
        ...revoked,
        current: { ...revoked.current, claim },
      }).success,
    ).toBe(false);
    expect(
      accessKeyDetailSchema.safeParse({
        ...detail,
        current: {
          ...detail.current,
          completion: {
            reportId: uuid(7),
            completedAt: "2026-10-18T00:02:00.000Z",
          },
        },
      }).success,
    ).toBe(false);
    const cross = structuredClone(revoked);
    cross.current.voidReceipt.binding.keyId = uuid(8);
    expect(accessKeyDetailSchema.safeParse(cross).success).toBe(false);
    const damaged = structuredClone(revoked);
    damaged.current.voidReceipt.bindingSha256 = "f".repeat(64);
    await expect(verifyAccessKeyDetail(damaged)).rejects.toThrow(
      "ACCESS_KEY_CONTRACT_MISMATCH",
    );
  });
  it("bounds and orders Key pages with a selector cursor and rejects cross-product/duplicate entries", async () => {
    const { detail } = await fixture();
    const cursor = {
      productId: "test-product",
      issuedAt,
      keyId: detail.issue.binding.keyId,
    };
    const page = {
      productId: "test-product",
      keys: [detail],
      nextCursor: cursor,
    };
    expect(accessKeyListSchema.safeParse(page).success).toBe(true);
    expect(accessKeyListSchema.safeParse({ ...page, keys: [] }).success).toBe(
      false,
    );
    expect(
      accessKeyListSchema.safeParse({ ...page, keys: Array(51).fill(detail) })
        .success,
    ).toBe(false);
    expect(
      accessKeyListSchema.safeParse({ ...page, productId: "other-product" })
        .success,
    ).toBe(false);
    expect(
      accessKeyListSchema.safeParse({
        ...page,
        nextCursor: { ...cursor, keyId: uuid(9) },
      }).success,
    ).toBe(false);
    expect(
      accessKeyListSchema.safeParse({ ...page, keys: [detail, detail] })
        .success,
    ).toBe(false);
  });
});
