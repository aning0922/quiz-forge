import { z } from "zod";
import {
  previewScopeSchema,
  previewBindingSchema,
  previewAnswersSchema,
} from "@/features/product/preview/contracts";

export const PREVIEW_FIXTURE_PRIVATE_NAME = "preview-p3c-e2e-fixture.json";
const actor = z.strictObject({
  identifier: z.uuid(),
  secret: z.string().regex(/^qfo_p2a_[A-Za-z0-9_-]{43}$/),
});
const sourceSchema = z.strictObject({
  scope: previewScopeSchema,
  binding: previewBindingSchema,
  engine: z.enum(["archetype", "dimensions"]),
  sourceImportId: z.uuid(),
  sourceValidationId: z.uuid(),
  canonicalContentSha256: z.string().regex(/^[a-f0-9]{64}$/),
  questionIds: z.array(z.string()).min(1).max(100),
  witnesses: z
    .array(
      z.strictObject({ resultId: z.string(), answers: previewAnswersSchema }),
    )
    .min(1)
    .max(32),
  blobs: z
    .array(
      z.strictObject({
        sha256: z.string().regex(/^[a-f0-9]{64}$/),
        bytes: z.number().int().positive().max(8388608),
        created: z.boolean(),
      }),
    )
    .min(1)
    .max(64),
});
export const previewFixtureSchema = z
  .strictObject({
    version: z.literal(1),
    qualification: z.literal("synthetic-db-and-private-pixels-no-native"),
    instanceId: z.string().regex(/^[a-f0-9]{32}$/),
    runId: z.uuid(),
    writerPid: z.number().int().positive(),
    prepared: z.boolean(),
    completed: z.boolean(),
    operator: actor,
    readOnly: actor,
    sources: z.array(sourceSchema).max(2),
  })
  .superRefine((value, ctx) => {
    const bad = () =>
      ctx.addIssue({
        code: "custom",
        message: "Preview fixture namespace must be exact.",
      });
    if (value.operator.identifier === value.readOnly.identifier) bad();
    if (
      value.prepared &&
      (value.sources.length !== 2 ||
        new Set(value.sources.map((s) => s.engine)).size !== 2)
    )
      bad();
    for (const s of value.sources) {
      if (
        s.scope.productId !==
          `preview-${value.runId.slice(0, 8)}-${s.engine}` ||
        s.scope.productId !== s.binding.productId ||
        s.scope.draftId !== s.binding.draftId ||
        s.scope.revision !== 1 ||
        s.binding.revision !== 1 ||
        s.canonicalContentSha256 !== s.binding.canonicalContentSha256 ||
        new Set(s.blobs.map((b) => b.sha256)).size !== s.blobs.length
      )
        bad();
    }
  });
export type PreviewFixture = z.infer<typeof previewFixtureSchema>;
