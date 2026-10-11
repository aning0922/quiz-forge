import { z } from "zod";
import type { Result } from "./api";
import { PACK_LIMITS } from "./limits";

export const packIdSchema = z
  .string()
  .regex(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/)
  .max(80);
export const packVersionSchema = z
  .string()
  .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
  .max(32);
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/);
export const assetPathSchema = z
  .string()
  .regex(/^assets\/[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.(png|jpg|webp)$/)
  .max(96);
export const imageMediaTypeSchema = z.enum([
  "image/png",
  "image/jpeg",
  "image/webp",
]);
export const engineDeclarationSchema = z.strictObject({
  id: z.enum(["dimensions", "archetype"]),
  version: z.literal("1.0.0"),
});
export const componentDeclarationSchema = z.strictObject({
  id: packIdSchema,
  version: packVersionSchema,
  propsSchemaVersion: packVersionSchema,
});
export const quizPackManifestSchema = z.strictObject({
  schemaVersion: z.literal("quizpack.v1"),
  packId: packIdSchema,
  packVersion: packVersionSchema,
  productId: packIdSchema,
  contentSchemaVersion: z.literal("quizpack-content.v1"),
  engine: engineDeclarationSchema,
  components: z.array(componentDeclarationSchema).min(1).max(24),
  files: z
    .array(
      z.strictObject({
        path: z.union([z.literal("content.json"), assetPathSchema]),
        mediaType: z.enum([
          "application/json",
          "image/png",
          "image/jpeg",
          "image/webp",
        ]),
        bytes: z.number().int().positive().max(PACK_LIMITS.resourceBytes),
        sha256: sha256Schema,
      }),
    )
    .min(2)
    .max(PACK_LIMITS.resources + 1),
});
export type QuizPackManifest = z.infer<typeof quizPackManifestSchema>;

export function parseQuizPackManifest(
  input: unknown,
): Result<QuizPackManifest> {
  const parsed = quizPackManifestSchema.safeParse(input);
  if (parsed.success) return { ok: true, value: parsed.data };
  return {
    ok: false,
    issues: parsed.error.issues.map((issue) => ({
      code: "MANIFEST_STRUCTURE",
      path: issue.path.filter(
        (part): part is string | number =>
          typeof part === "string" || typeof part === "number",
      ),
      message: "Value does not satisfy the quizpack.v1 manifest contract.",
    })),
  };
}
export function getQuizPackManifestJsonSchema() {
  return z.toJSONSchema(quizPackManifestSchema, {
    target: "draft-2020-12",
    io: "input",
    unrepresentable: "throw",
  });
}
