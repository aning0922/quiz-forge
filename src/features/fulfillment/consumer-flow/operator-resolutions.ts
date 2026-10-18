import { z } from "zod";
import { CONSUMER_LIMITS_V1 as L } from "@/lib/consumer-contract/v1/limits";
import { consumerSha256Schema as sha } from "@/lib/consumer-contract/v1/primitives";
import {
  sameConsumerFact,
  withinConsumerBytes,
} from "@/lib/consumer-contract/v1/integrity";
import {
  createInternalPlayBindingSchema,
  internalPlayReceiptSchema,
  internalPlayBindingSha256,
} from "@/features/product/internal-play/contracts";
import {
  issueAccessKeyBindingSchema,
  issueAccessKeyBindingSha256,
  voidUnusedAccessKeyBindingSchema,
  voidUnusedAccessKeyBindingSha256,
  accessKeyDetailSchema,
  verifyAccessKeyDetail,
} from "@/features/fulfillment/access/contracts";

const same = (a: unknown, b: unknown) =>
  sameConsumerFact(a, b, L.operationReceiptBytes);
const reject = (ctx: z.RefinementCtx) =>
  ctx.addIssue({
    code: "custom",
    message: "Contradictory operator observation.",
  });
const playOriginal = {
  schemaVersion: z.literal("quizforge.internal-play-resolution.v1"),
  binding: createInternalPlayBindingSchema,
  bindingSha256: sha,
};
/** Deliberately no absence proof from head, capacity, time, an error or an empty list. */
export const internalPlayResolutionSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("applied"),
      ...playOriginal,
      play: internalPlayReceiptSchema,
    }),
    z.strictObject({
      kind: z.literal("operation-conflict"),
      ...playOriginal,
      play: internalPlayReceiptSchema,
    }),
    z.strictObject({ kind: z.literal("unresolved"), ...playOriginal }),
  ])
  .superRefine((v, ctx) => {
    if (!withinConsumerBytes(v, L.operationReceiptBytes)) reject(ctx);
    if (v.kind === "unresolved") return;
    if (
      v.binding.parent.productId !== v.play.binding.parent.productId ||
      v.binding.operationKey !== v.play.binding.operationKey
    )
      reject(ctx);
    const exact = same(v.binding, v.play.binding);
    if (
      (v.kind === "applied" &&
        (!exact || v.bindingSha256 !== v.play.bindingSha256)) ||
      (v.kind === "operation-conflict" && exact)
    )
      reject(ctx);
  });
const issueOriginal = {
  schemaVersion: z.literal("quizforge.access-key-issue-resolution.v1"),
  binding: issueAccessKeyBindingSchema,
  bindingSha256: sha,
};
export const issueAccessKeyResolutionSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({
      kind: z.literal("applied"),
      ...issueOriginal,
      key: accessKeyDetailSchema,
    }),
    z.strictObject({
      kind: z.literal("operation-conflict"),
      ...issueOriginal,
      key: accessKeyDetailSchema,
    }),
    z.strictObject({ kind: z.literal("unresolved"), ...issueOriginal }),
  ])
  .superRefine((v, ctx) => {
    if (!withinConsumerBytes(v, L.operationReceiptBytes)) reject(ctx);
    if (v.kind === "unresolved") return;
    if (
      v.binding.play.productId !== v.key.issue.binding.play.productId ||
      v.binding.operationKey !== v.key.issue.binding.operationKey
    )
      reject(ctx);
    const exact = same(v.binding, v.key.issue.binding);
    if (
      (v.kind === "applied" &&
        (!exact || v.bindingSha256 !== v.key.issue.bindingSha256)) ||
      (v.kind === "operation-conflict" && exact)
    )
      reject(ctx);
  });
const voidOriginal = {
  schemaVersion: z.literal("quizforge.access-key-void-resolution.v1"),
  binding: voidUnusedAccessKeyBindingSchema,
  bindingSha256: sha,
  key: accessKeyDetailSchema,
};
/** Claims/void receipts are permanent facts; raw loss or ordinary expiry is not one. */
export const voidUnusedAccessKeyResolutionSchema = z
  .discriminatedUnion("kind", [
    z.strictObject({ kind: z.literal("applied"), ...voidOriginal }),
    z.strictObject({ kind: z.literal("voided-other"), ...voidOriginal }),
    z.strictObject({ kind: z.literal("claimed"), ...voidOriginal }),
    z.strictObject({ kind: z.literal("unresolved"), ...voidOriginal }),
  ])
  .superRefine((v, ctx) => {
    if (
      !withinConsumerBytes(v, L.operationReceiptBytes) ||
      v.binding.productId !== v.key.issue.binding.play.productId ||
      v.binding.keyId !== v.key.issue.binding.keyId ||
      v.binding.issueBindingSha256 !== v.key.issue.bindingSha256
    )
      reject(ctx);
    const voided = v.key.current.voidReceipt;
    if (v.kind === "claimed") {
      if (v.key.current.claim === null) reject(ctx);
    } else if (v.kind === "unresolved") {
      if (voided !== null || v.key.current.claim !== null) reject(ctx);
    } else {
      if (!voided) {
        reject(ctx);
        return;
      }
      const exact = same(v.binding, voided.binding);
      const sameKey = v.binding.operationKey === voided.binding.operationKey;
      if (
        (v.kind === "applied" &&
          (!exact || v.bindingSha256 !== voided.bindingSha256)) ||
        (v.kind === "voided-other" && sameKey)
      )
        reject(ctx);
    }
  });

export async function verifyInternalPlayResolution(
  input: unknown,
  expectedInput: unknown,
) {
  const v = internalPlayResolutionSchema.parse(input);
  if (
    !same(v.binding, createInternalPlayBindingSchema.parse(expectedInput)) ||
    (await internalPlayBindingSha256(v.binding)) !== v.bindingSha256 ||
    ("play" in v &&
      (await internalPlayBindingSha256(v.play.binding)) !==
        v.play.bindingSha256)
  )
    throw Error("CONSUMER_OPERATOR_RESOLUTION_MISMATCH");
  return v;
}
export async function verifyIssueAccessKeyResolution(
  input: unknown,
  expectedInput: unknown,
) {
  const v = issueAccessKeyResolutionSchema.parse(input);
  if (
    !same(v.binding, issueAccessKeyBindingSchema.parse(expectedInput)) ||
    (await issueAccessKeyBindingSha256(v.binding)) !== v.bindingSha256
  )
    throw Error("CONSUMER_OPERATOR_RESOLUTION_MISMATCH");
  if ("key" in v) await verifyAccessKeyDetail(v.key);
  return v;
}
export async function verifyVoidUnusedAccessKeyResolution(
  input: unknown,
  expectedInput: unknown,
) {
  const v = voidUnusedAccessKeyResolutionSchema.parse(input);
  if (
    !same(v.binding, voidUnusedAccessKeyBindingSchema.parse(expectedInput)) ||
    (await voidUnusedAccessKeyBindingSha256(v.binding)) !== v.bindingSha256
  )
    throw Error("CONSUMER_OPERATOR_RESOLUTION_MISMATCH");
  await verifyAccessKeyDetail(v.key);
  return v;
}
export type InternalPlayResolution = z.infer<
  typeof internalPlayResolutionSchema
>;
export type IssueAccessKeyResolution = z.infer<
  typeof issueAccessKeyResolutionSchema
>;
export type VoidUnusedAccessKeyResolution = z.infer<
  typeof voidUnusedAccessKeyResolutionSchema
>;
