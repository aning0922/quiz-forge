import { z } from "zod";

export const assessmentIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .max(80);
export const assessmentVersionSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  .max(32);
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const engineDeclarationSchema = z.strictObject({
  id: z.enum(["dimensions", "archetype"]),
  version: z.literal("1.0.0"),
});

export const assessmentReferenceSchema = z.strictObject({
  id: assessmentIdSchema,
  productId: assessmentIdSchema,
  version: assessmentVersionSchema,
});
export type AssessmentReference = z.infer<typeof assessmentReferenceSchema>;
