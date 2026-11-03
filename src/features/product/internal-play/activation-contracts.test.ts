import { expect, it } from "vitest";
import {
  activateConsumerProductBindingSchema,
  consumerAttemptIdentitySchema,
  consumerProductActivationBindingText,
  verifyConsumerProductActivationReceipt,
} from "./activation-contracts";
import { consumerTextSha256 } from "@/lib/consumer-contract/v1/integrity";

const id = "01000000-0000-4000-8000-000000000001";
const binding = {
  schemaVersion: "quizforge.consumer-product-activate.v1",
  productId: "qianzai-tongxin",
  operationKey: id,
  expectedGeneration: 0,
  playVersionId: id,
  playSnapshotSha256: "a".repeat(64),
};

it("rejects implicit selection, extra authority and generation reuse inputs", () => {
  for (const change of [
    { expectedGeneration: -1 },
    { expectedGeneration: 2_147_483_647 },
    { expectedGeneration: 1.5 },
    { latest: true },
    { publicationApproved: true },
    { playSnapshotSha256: null },
  ])
    expect(
      activateConsumerProductBindingSchema.safeParse({ ...binding, ...change })
        .success,
    ).toBe(false);
  expect(
    consumerAttemptIdentitySchema.safeParse({
      sessionId: id,
      keyId: id,
      productId: binding.productId,
      activationGeneration: 0,
      issuedPlayVersionId: id,
      issuedPlaySnapshotSha256: "b".repeat(64),
      playVersionId: id,
      playSnapshotSha256: "a".repeat(64),
    }).success,
  ).toBe(false);
});

it("verifies an original receipt independently of a later current head", async () => {
  const receipt = {
    schemaVersion: "quizforge.consumer-product-activation-receipt.v1",
    id,
    binding,
    bindingSha256: await consumerTextSha256(
      consumerProductActivationBindingText(binding),
    ),
    generation: 1,
    activatedBy: id,
    activatedAt: "2026-11-03T10:00:00.000Z",
  };
  expect(await verifyConsumerProductActivationReceipt(receipt)).toEqual(
    receipt,
  );
  await expect(
    verifyConsumerProductActivationReceipt({
      ...receipt,
      binding: { ...binding, expectedGeneration: 1 },
      generation: 2,
    }),
  ).rejects.toThrow("ACTIVATION_RECEIPT_INTEGRITY");
  await expect(
    verifyConsumerProductActivationReceipt({ ...receipt, generation: 2 }),
  ).rejects.toThrow();
});
