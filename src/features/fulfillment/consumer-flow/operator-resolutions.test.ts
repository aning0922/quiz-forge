import { describe, expect, it } from "vitest";
import {
  internalPlayFixture,
  testMoment,
  testUuid,
} from "@/features/product/internal-play/contracts.test-support";
import { internalPlayBindingSha256 } from "@/features/product/internal-play/contracts";
import {
  issueAccessKeyBindingSha256,
  voidUnusedAccessKeyBindingSha256,
  type AccessKeyDetail,
} from "@/features/fulfillment/access/contracts";
import {
  internalPlayResolutionSchema,
  issueAccessKeyResolutionSchema,
  voidUnusedAccessKeyResolutionSchema,
  verifyInternalPlayResolution,
  verifyIssueAccessKeyResolution,
  verifyVoidUnusedAccessKeyResolution,
} from "./operator-resolutions";

async function keyFixture() {
  const binding = {
    schemaVersion: "quizforge.access-key-issue.v1" as const,
    operationKey: testUuid(101),
    keyId: testUuid(102),
    play: {
      productId: "synthetic-consumer",
      playVersionId: testUuid(103),
      playSnapshotSha256: "a".repeat(64),
    },
    credentialDigest: "b".repeat(64),
    validForSeconds: 3600,
  };
  const key: AccessKeyDetail = {
    issue: {
      schemaVersion: "quizforge.access-key-issue-receipt.v1",
      binding,
      bindingSha256: await issueAccessKeyBindingSha256(binding),
      issuedAt: testMoment,
      expiresAt: "2026-10-18T01:00:00.000Z",
      issuedBy: testUuid(104),
    },
    current: {
      observedAt: "2026-10-18T02:00:00.000Z",
      claim: null,
      completion: null,
      voidReceipt: null,
    },
  };
  const voidBinding = {
    schemaVersion: "quizforge.access-key-void-unused.v1" as const,
    productId: binding.play.productId,
    operationKey: testUuid(105),
    keyId: binding.keyId,
    issueBindingSha256: key.issue.bindingSha256,
  };
  const voidReceipt = {
    schemaVersion: "quizforge.access-key-void-unused-receipt.v1" as const,
    binding: voidBinding,
    bindingSha256: await voidUnusedAccessKeyBindingSha256(voidBinding),
    voidedBy: testUuid(104),
    revokedAt: "2026-10-18T00:30:00.000Z",
  };
  return { key, voidBinding, voidReceipt };
}

describe("operator resolution evidence", () => {
  it("requires the exact original play binding and distinguishes a persisted operation collision", async () => {
    const { play } = await internalPlayFixture();
    const applied = {
      schemaVersion: "quizforge.internal-play-resolution.v1",
      kind: "applied",
      binding: play.play.binding,
      bindingSha256: play.play.bindingSha256,
      play: play.play,
    };
    expect(
      await verifyInternalPlayResolution(applied, play.play.binding),
    ).toEqual(applied);
    expect(
      internalPlayResolutionSchema.safeParse({
        ...applied,
        kind: "operation-conflict",
      }).success,
    ).toBe(false);
    const other = {
      ...play.play.binding,
      renderer: { ...play.play.binding.renderer, entrySha256: "a".repeat(64) },
    };
    const conflict = {
      ...applied,
      kind: "operation-conflict",
      binding: other,
      bindingSha256: await internalPlayBindingSha256(other),
    };
    expect(await verifyInternalPlayResolution(conflict, other)).toEqual(
      conflict,
    );
    await expect(
      verifyInternalPlayResolution(conflict, play.play.binding),
    ).rejects.toThrow("CONSUMER_OPERATOR_RESOLUTION_MISMATCH");
    expect(
      internalPlayResolutionSchema.safeParse({
        ...conflict,
        binding: { ...other, operationKey: testUuid(200) },
      }).success,
    ).toBe(false);
    const { play: _receipt, ...unresolved } = applied;
    void _receipt;
    expect(
      await verifyInternalPlayResolution(
        { ...unresolved, kind: "unresolved" },
        applied.binding,
      ),
    ).toBeDefined();
    for (const kind of [
      "not-applied",
      "expired",
      "obsolete",
      "capacity-exhausted",
    ])
      expect(
        internalPlayResolutionSchema.safeParse({ ...unresolved, kind }).success,
      ).toBe(false);
  });
  it("does not renew or hide a voided or expired issue when returning its original success", async () => {
    const { key, voidReceipt } = await keyFixture();
    key.current.voidReceipt = voidReceipt;
    const value = {
      schemaVersion: "quizforge.access-key-issue-resolution.v1",
      kind: "applied",
      binding: key.issue.binding,
      bindingSha256: key.issue.bindingSha256,
      key,
    };
    expect(
      await verifyIssueAccessKeyResolution(value, key.issue.binding),
    ).toEqual(value);
    const other = { ...key.issue.binding, credentialDigest: "c".repeat(64) };
    const conflict = {
      ...value,
      kind: "operation-conflict",
      binding: other,
      bindingSha256: await issueAccessKeyBindingSha256(other),
    };
    expect(await verifyIssueAccessKeyResolution(conflict, other)).toEqual(
      conflict,
    );
    expect(
      issueAccessKeyResolutionSchema.safeParse({ ...conflict, kind: "applied" })
        .success,
    ).toBe(false);
    const cross = {
      ...value,
      binding: {
        ...value.binding,
        play: { ...value.binding.play, productId: "other-product" },
      },
    };
    expect(issueAccessKeyResolutionSchema.safeParse(cross).success).toBe(false);
  });
  it("allows only a bound same-Key claim or void fact to close a void request", async () => {
    const { key, voidBinding: binding, voidReceipt } = await keyFixture();
    const base = {
      schemaVersion: "quizforge.access-key-void-resolution.v1",
      binding,
      bindingSha256: voidReceipt.bindingSha256,
      key,
    };
    expect(
      await verifyVoidUnusedAccessKeyResolution(
        { ...base, kind: "unresolved" },
        binding,
      ),
    ).toBeDefined();
    for (const kind of ["applied", "voided-other", "claimed", "expired"])
      expect(
        voidUnusedAccessKeyResolutionSchema.safeParse({ ...base, kind })
          .success,
      ).toBe(false);
    const claimed = {
      ...base,
      kind: "claimed",
      key: {
        ...key,
        current: {
          ...key.current,
          claim: {
            sessionId: testUuid(106),
            claimedAt: "2026-10-18T00:10:00.000Z",
          },
        },
      },
    };
    expect(await verifyVoidUnusedAccessKeyResolution(claimed, binding)).toEqual(
      claimed,
    );
    const applied = {
      ...base,
      kind: "applied",
      key: { ...key, current: { ...key.current, voidReceipt } },
    };
    expect(await verifyVoidUnusedAccessKeyResolution(applied, binding)).toEqual(
      applied,
    );
    const otherBinding = { ...binding, operationKey: testUuid(107) };
    const other = {
      ...applied,
      kind: "voided-other",
      binding: otherBinding,
      bindingSha256: await voidUnusedAccessKeyBindingSha256(otherBinding),
    };
    expect(
      await verifyVoidUnusedAccessKeyResolution(other, otherBinding),
    ).toEqual(other);
    expect(
      voidUnusedAccessKeyResolutionSchema.safeParse({
        ...other,
        kind: "applied",
      }).success,
    ).toBe(false);
    expect(
      voidUnusedAccessKeyResolutionSchema.safeParse({
        ...claimed,
        binding: { ...binding, keyId: testUuid(108) },
      }).success,
    ).toBe(false);
    await expect(
      verifyVoidUnusedAccessKeyResolution(
        { ...applied, bindingSha256: "a".repeat(64) },
        binding,
      ),
    ).rejects.toThrow();
  });
});
