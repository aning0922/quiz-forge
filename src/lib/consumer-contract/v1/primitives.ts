import { z } from "zod";
import {
  assessmentIdSchema,
  assessmentVersionSchema,
  sha256Schema,
} from "@/lib/assessment-contract/primitives";
import { CONSUMER_LIMITS_V1 as L } from "./limits";

export const consumerIdSchema = assessmentIdSchema.refine(
  (value) => !/[\r\n]/.test(value),
);
export const consumerVersionSchema = assessmentVersionSchema.refine(
  (value) => !/[\r\n]/.test(value),
);
export const consumerSha256Schema = sha256Schema.length(64);
export const consumerUuidSchema = z
  .uuid()
  .regex(/^[0-9a-f-]{36}$/)
  .length(36);
export const consumerMomentSchema = z.iso.datetime({ precision: 3 });
export const consumerStateRevisionSchema = z
  .number()
  .int()
  .min(0)
  .max(L.maximumStateRevision);
export const consumerKeyLifetimeSchema = z
  .number()
  .int()
  .min(L.minimumKeyLifetimeSeconds)
  .max(L.maximumKeyLifetimeSeconds);

/** A selector is never a bearer credential. Every application service checks its full ownership. */
export const internalPlayRefSchema = z.strictObject({
  productId: consumerIdSchema,
  playVersionId: consumerUuidSchema,
  playSnapshotSha256: consumerSha256Schema,
});
export const consumerSessionRefSchema = internalPlayRefSchema.extend({
  keyId: consumerUuidSchema,
  sessionId: consumerUuidSchema,
});
export const internalParentVersionRefSchema = z.strictObject({
  productId: consumerIdSchema,
  versionId: consumerUuidSchema,
  snapshotSha256: consumerSha256Schema,
});
export type InternalPlayRef = z.infer<typeof internalPlayRefSchema>;
export type ConsumerSessionRef = z.infer<typeof consumerSessionRefSchema>;
export type InternalParentVersionRef = z.infer<
  typeof internalParentVersionRefSchema
>;
