import { z } from "zod";

/** foundation.v1 declarations only; no byte, registry, or licensing authority. */
export const foundationIdSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
export const foundationVersionSchema = z
  .string()
  .max(32)
  .regex(/^(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})\.(0|[1-9][0-9]{0,5})$/);
export const foundationTextSchema = z
  .string()
  .min(1)
  .max(2000)
  .regex(/\S/)
  .regex(/^[^<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/);
export const foundationReferenceSchema = z.strictObject({
  id: foundationIdSchema,
  productId: foundationIdSchema,
  version: foundationVersionSchema,
});

export const foundationResourceSchema = z.strictObject({
  id: foundationIdSchema,
  version: foundationVersionSchema,
  owner: z.strictObject({
    kind: z.literal("product"),
    productId: foundationIdSchema,
  }),
  purpose: z.enum([
    "cover",
    "portrait",
    "question",
    "report",
    "poster",
    "font",
  ]),
  path: z
    .string()
    .min(1)
    .max(240)
    .regex(
      /^(?:[a-z0-9][a-z0-9_-]*\/){0,8}[a-z0-9][a-z0-9_-]*\.(?:png|jpg|jpeg|webp|woff2)$/,
    ),
  mediaType: z.enum(["image/png", "image/jpeg", "image/webp", "font/woff2"]),
  sha256: z
    .string()
    .length(64)
    .regex(/^[a-f0-9]{64}$/),
  bytes: z
    .number()
    .int()
    .min(1)
    .max(20 * 1024 * 1024),
  source: z.strictObject({
    kind: z.enum(["synthetic", "original", "licensed"]),
    declaration: foundationTextSchema,
  }),
  licenseClaim: z.strictObject({
    status: z.enum(["pending", "approved", "rejected"]),
    commercialUse: z.enum([
      "unverified",
      "claimed-permitted",
      "claimed-prohibited",
    ]),
    evidence: foundationTextSchema,
  }),
});
export type FoundationResource = z.infer<typeof foundationResourceSchema>;
