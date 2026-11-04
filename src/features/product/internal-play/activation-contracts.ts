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
  sameConsumerFact,
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

export const consumerActivationResolutionSchema = z
  .strictObject({
    schemaVersion: z.literal(
      "quizforge.consumer-product-activation-resolution.v1",
    ),
    binding: activateConsumerProductBindingSchema,
    bindingSha256: consumerSha256Schema,
    kind: z.enum(["applied", "operation-conflict", "unresolved"]),
    receipt: consumerProductActivationReceiptSchema.nullable(),
    head: consumerProductHeadSchema.nullable(),
  })
  .refine((v) => v.head === null || v.head.productId === v.binding.productId)
  .refine((v) =>
    v.kind === "unresolved"
      ? v.receipt === null
      : v.receipt !== null &&
        v.receipt.binding.productId === v.binding.productId &&
        v.receipt.binding.operationKey === v.binding.operationKey &&
        (v.kind === "applied") ===
          sameConsumerFact(v.receipt.binding, v.binding, 4096),
  );
export type ConsumerActivationResolution = z.infer<
  typeof consumerActivationResolutionSchema
>;
export async function verifyConsumerActivationResolution(
  input: unknown,
  expected: unknown,
) {
  const result = consumerActivationResolutionSchema.parse(input),
    binding = activateConsumerProductBindingSchema.parse(expected);
  if (
    !sameConsumerFact(result.binding, binding, 4096) ||
    result.bindingSha256 !==
      (await consumerTextSha256(consumerProductActivationBindingText(binding)))
  )
    throw Error("ACTIVATION_RESOLUTION_MISMATCH");
  if (result.receipt)
    await verifyConsumerProductActivationReceipt(result.receipt);
  return result;
}
