import { z } from "zod";
import {
  consumerIdSchema,
  consumerUuidSchema,
  consumerSha256Schema,
  consumerMomentSchema,
} from "@/lib/consumer-contract/v1/primitives";
import {
  consumerCanonicalText,
  consumerTextSha256,
} from "@/lib/consumer-contract/v1/integrity";

/** Explicit activation, independent of upload/sealing order. No default head. */
export const activateConsumerProductBindingSchema = z.strictObject({
  schemaVersion: z.literal("quizforge.consumer-product-activate.v1"),
  productId: consumerIdSchema,
  operationKey: consumerUuidSchema,
  expectedGeneration: z.number().int().min(0).max(2_147_483_646),
  playVersionId: consumerUuidSchema,
  playSnapshotSha256: consumerSha256Schema,
});
export type ActivateConsumerProductBinding = z.infer<
  typeof activateConsumerProductBindingSchema
>;

export const consumerProductActivationReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal(
      "quizforge.consumer-product-activation-receipt.v1",
    ),
    id: consumerUuidSchema,
    binding: activateConsumerProductBindingSchema,
    bindingSha256: consumerSha256Schema,
    generation: z.number().int().min(1).max(2_147_483_647),
    activatedBy: consumerUuidSchema,
    activatedAt: consumerMomentSchema,
  })
  .refine((r) => r.generation === r.binding.expectedGeneration + 1);

/** Read this separately from an original operation receipt during ACK recovery. */
export const consumerProductHeadSchema = z.strictObject({
  productId: consumerIdSchema,
  generation: z.number().int().min(1).max(2_147_483_647),
  playVersionId: consumerUuidSchema,
  playSnapshotSha256: consumerSha256Schema,
});

export const consumerAttemptIdentitySchema = z.strictObject({
  sessionId: consumerUuidSchema,
  keyId: consumerUuidSchema,
  productId: consumerIdSchema,
  activationGeneration: z.number().int().min(1).max(2_147_483_647),
  issuedPlayVersionId: consumerUuidSchema,
  issuedPlaySnapshotSha256: consumerSha256Schema,
  playVersionId: consumerUuidSchema,
  playSnapshotSha256: consumerSha256Schema,
});

export function consumerProductActivationBindingText(input: unknown) {
  return consumerCanonicalText(
    activateConsumerProductBindingSchema.parse(input),
    4096,
  );
}

export async function verifyConsumerProductActivationReceipt(input: unknown) {
  const receipt = consumerProductActivationReceiptSchema.parse(input);
  if (
    (await consumerTextSha256(
      consumerProductActivationBindingText(receipt.binding),
    )) !== receipt.bindingSha256
  )
    throw new Error("ACTIVATION_RECEIPT_INTEGRITY");
  return receipt;
}
