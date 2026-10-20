import { z } from "zod";
import {
  consumerIdSchema as id,
  consumerSha256Schema as sha,
  consumerUuidSchema as uuid,
  consumerMomentSchema as moment,
  consumerKeyLifetimeSchema,
  internalPlayRefSchema,
} from "@/lib/consumer-contract/v1/primitives";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import {
  consumerCanonicalText,
  consumerTextSha256,
  withinConsumerBytes,
} from "@/lib/consumer-contract/v1/integrity";

/** A digest shape is not a bearer credential. Raw/CSRF/Cookie codecs belong to the shared protocol. */
export const issueAccessKeyBindingSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.access-key-issue.v1"),
    operationKey: uuid,
    keyId: uuid,
    play: internalPlayRefSchema,
    credentialDigest: sha,
    validForSeconds: consumerKeyLifetimeSchema,
  })
  .refine((v) => withinConsumerBytes(v, L.operationRequestBytes));
export const issueAccessKeyReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.access-key-issue-receipt.v1"),
    binding: issueAccessKeyBindingSchema,
    bindingSha256: sha,
    issuedBy: uuid,
    issuedAt: moment,
    expiresAt: moment,
  })
  .refine(
    (v) =>
      Date.parse(v.expiresAt) - Date.parse(v.issuedAt) ===
        v.binding.validForSeconds * 1000 &&
      withinConsumerBytes(v, L.operationReceiptBytes),
  );
export const voidUnusedAccessKeyBindingSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.access-key-void-unused.v1"),
    productId: id,
    operationKey: uuid,
    keyId: uuid,
    issueBindingSha256: sha,
  })
  .refine((v) => withinConsumerBytes(v, L.operationRequestBytes));
export const voidUnusedAccessKeyReceiptSchema = z
  .strictObject({
    schemaVersion: z.literal("quizforge.access-key-void-unused-receipt.v1"),
    binding: voidUnusedAccessKeyBindingSchema,
    bindingSha256: sha,
    voidedBy: uuid,
    revokedAt: moment,
  })
  .refine((v) => withinConsumerBytes(v, L.operationReceiptBytes));

/** Fresh independent observations; neither expiration nor an empty list proves an original write absent. */
export const accessKeyCurrentStateSchema = z
  .strictObject({
    observedAt: moment,
    claim: z.strictObject({ sessionId: uuid, claimedAt: moment }).nullable(),
    completion: z
      .strictObject({ reportId: uuid, completedAt: moment })
      .nullable(),
    voidReceipt: voidUnusedAccessKeyReceiptSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    const observed = Date.parse(v.observedAt);
    if (
      (v.completion !== null && v.claim === null) ||
      (v.voidReceipt !== null && (v.claim !== null || v.completion !== null)) ||
      (v.claim && Date.parse(v.claim.claimedAt) > observed) ||
      (v.completion &&
        (Date.parse(v.completion.completedAt) > observed ||
          Date.parse(v.completion.completedAt) <
            Date.parse(v.claim!.claimedAt))) ||
      (v.voidReceipt && Date.parse(v.voidReceipt.revokedAt) > observed)
    )
      ctx.addIssue({
        code: "custom",
        message: "Contradictory Key observations.",
      });
  });
export const accessKeyDetailSchema = z
  .strictObject({
    issue: issueAccessKeyReceiptSchema,
    current: accessKeyCurrentStateSchema,
  })
  .superRefine((v, ctx) => {
    const issued = Date.parse(v.issue.issuedAt);
    const revoked = v.current.voidReceipt;
    if (
      Date.parse(v.current.observedAt) < issued ||
      (v.current.claim && Date.parse(v.current.claim.claimedAt) < issued) ||
      (revoked &&
        (revoked.binding.keyId !== v.issue.binding.keyId ||
          revoked.binding.productId !== v.issue.binding.play.productId ||
          revoked.binding.issueBindingSha256 !== v.issue.bindingSha256 ||
          Date.parse(revoked.revokedAt) < issued)) ||
      !withinConsumerBytes(v, L.operationReceiptBytes)
    )
      ctx.addIssue({
        code: "custom",
        message: "Key issue and current facts disagree.",
      });
  });

/** Cursor only selects a page; it conveys no authorization or immutable page boundary. */
export const accessKeyCursorSchema = z.strictObject({
  productId: id,
  issuedAt: moment,
  keyId: uuid,
});
export const accessKeyListSchema = z
  .strictObject({
    productId: id,
    keys: accessKeyDetailSchema.array().max(L.keysPerPage),
    nextCursor: accessKeyCursorSchema.nullable(),
  })
  .superRefine((v, ctx) => {
    const last = v.keys.at(-1)?.issue;
    if (
      !withinConsumerBytes(v, L.keyListResponseBytes) ||
      new Set(v.keys.map((k) => k.issue.binding.keyId)).size !==
        v.keys.length ||
      v.keys.some((k, i) => {
        const prev = v.keys[i - 1]?.issue;
        return (
          k.issue.binding.play.productId !== v.productId ||
          (prev &&
            (k.issue.issuedAt > prev.issuedAt ||
              (k.issue.issuedAt === prev.issuedAt &&
                k.issue.binding.keyId >= prev.binding.keyId)))
        );
      }) ||
      (v.nextCursor &&
        (!last ||
          v.nextCursor.productId !== v.productId ||
          v.nextCursor.keyId !== last.binding.keyId ||
          v.nextCursor.issuedAt !== last.issuedAt))
    )
      ctx.addIssue({ code: "custom", message: "Invalid Key page." });
  });

export const issueAccessKeyBindingText = (input: unknown) =>
  consumerCanonicalText(
    issueAccessKeyBindingSchema.parse(input),
    L.operationRequestBytes,
  );
export const issueAccessKeyBindingSha256 = (input: unknown) =>
  consumerTextSha256(issueAccessKeyBindingText(input));
export const voidUnusedAccessKeyBindingText = (input: unknown) =>
  consumerCanonicalText(
    voidUnusedAccessKeyBindingSchema.parse(input),
    L.operationRequestBytes,
  );
export const voidUnusedAccessKeyBindingSha256 = (input: unknown) =>
  consumerTextSha256(voidUnusedAccessKeyBindingText(input));
export async function verifyIssueAccessKeyReceipt(input: unknown) {
  const value = issueAccessKeyReceiptSchema.parse(input);
  if (
    (await issueAccessKeyBindingSha256(value.binding)) !== value.bindingSha256
  )
    throw Error("ACCESS_KEY_CONTRACT_MISMATCH");
  return value;
}
export async function verifyVoidUnusedAccessKeyReceipt(input: unknown) {
  const value = voidUnusedAccessKeyReceiptSchema.parse(input);
  if (
    (await voidUnusedAccessKeyBindingSha256(value.binding)) !==
    value.bindingSha256
  )
    throw Error("ACCESS_KEY_CONTRACT_MISMATCH");
  return value;
}
export async function verifyAccessKeyDetail(input: unknown) {
  const value = accessKeyDetailSchema.parse(input);
  await verifyIssueAccessKeyReceipt(value.issue);
  if (value.current.voidReceipt)
    await verifyVoidUnusedAccessKeyReceipt(value.current.voidReceipt);
  return value;
}

export type IssueAccessKeyBinding = z.infer<typeof issueAccessKeyBindingSchema>;
export type IssueAccessKeyReceipt = z.infer<typeof issueAccessKeyReceiptSchema>;
export type VoidUnusedAccessKeyBinding = z.infer<
  typeof voidUnusedAccessKeyBindingSchema
>;
export type VoidUnusedAccessKeyReceipt = z.infer<
  typeof voidUnusedAccessKeyReceiptSchema
>;
export type AccessKeyDetail = z.infer<typeof accessKeyDetailSchema>;
export type AccessKeyCursor = z.infer<typeof accessKeyCursorSchema>;
