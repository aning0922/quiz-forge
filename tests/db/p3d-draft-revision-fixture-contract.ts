import { z } from "zod";
import {
  draftApplicationScopeSchema,
  draftSummarySchema,
} from "@/features/product/drafts/contracts";
import {
  sha256Schema,
  packVersionSchema,
} from "@/features/quizpack/v1/manifest";
import { previewAnswersSchema } from "@/features/product/preview/contracts";
export const DRAFT_REVISION_FIXTURE_PRIVATE_NAME =
  "draft-revisions-p3d-e2e-fixture.json";
export const DRAFT_REVISION_FIXTURE_MAX_BYTES = 32768;
const actor = z.strictObject({
  identifier: z.uuid(),
  secret: z.string().regex(/^qfo_p2a_[A-Za-z0-9_-]{43}$/),
});
export const draftRevisionFixtureSourceSchema = z.strictObject({
  name: z.enum(["initial", "second", "third", "spare", "alias-initial"]),
  scope: draftApplicationScopeSchema,
  expectedValidationStateRevision: z.number().int().min(1).max(2147483647),
  expectedCandidateSha256: sha256Schema,
  canonicalContentSha256: sha256Schema,
  assetSetSha256: sha256Schema,
  canonicalManifestSha256: sha256Schema,
  packVersion: packVersionSchema,
  witnesses: z
    .array(
      z.strictObject({
        resultId: z.string().min(1).max(80),
        answers: previewAnswersSchema,
      }),
    )
    .min(1)
    .max(32),
});
export const draftRevisionFixtureSchema = z
  .strictObject({
    version: z.literal(1),
    qualification: z.literal("synthetic-db-and-private-pixels-no-native"),
    instanceId: z.string().regex(/^[a-f0-9]{32}$/),
    runId: z.uuid(),
    writerPid: z.number().int().positive(),
    prepared: z.boolean(),
    completed: z.boolean(),
    productId: z.string().regex(/^revisions-[a-f0-9]{8}$/),
    draftId: z.uuid().nullable(),
    initialIdempotencyKey: z.uuid().nullable(),
    initial: draftSummarySchema.nullable(),
    operator: actor,
    readOnly: actor,
    blobs: z
      .array(
        z.strictObject({
          sha256: sha256Schema,
          bytes: z.number().int().positive().max(8388608),
          created: z.boolean(),
        }),
      )
      .max(64),
    sources: z.array(draftRevisionFixtureSourceSchema).max(5),
  })
  .superRefine((v, ctx) => {
    const bad = () =>
      ctx.addIssue({
        code: "custom",
        message: "Draft revision fixture namespace must be exact.",
      });
    if (
      v.productId !== `revisions-${v.runId.slice(0, 8)}` ||
      v.operator.identifier === v.readOnly.identifier ||
      (v.completed && !v.prepared)
    )
      bad();
    if (
      new Set(v.sources.map((s) => s.name)).size !== v.sources.length ||
      new Set(v.sources.map((s) => s.scope.sourceImportId)).size !==
        v.sources.length ||
      new Set(v.sources.map((s) => s.scope.sourceValidationId)).size !==
        v.sources.length ||
      new Set(v.blobs.map((b) => b.sha256)).size !== v.blobs.length
    )
      bad();
    if (v.sources.some((s) => s.scope.productId !== v.productId)) bad();
    if (v.prepared) {
      if (
        !v.draftId ||
        !v.initialIdempotencyKey ||
        !v.initial ||
        v.initial.productId !== v.productId ||
        v.initial.draftId !== v.draftId ||
        v.initial.revision !== 1 ||
        v.initial.createdBy !== v.operator.identifier ||
        v.sources.length !== 5 ||
        v.blobs.length < 1
      )
        bad();
      const initial = v.sources.find((s) => s.name === "initial"),
        alias = v.sources.find((s) => s.name === "alias-initial");
      if (
        !initial ||
        !alias ||
        initial.canonicalManifestSha256 !== alias.canonicalManifestSha256 ||
        initial.canonicalContentSha256 !== alias.canonicalContentSha256 ||
        initial.assetSetSha256 !== alias.assetSetSha256 ||
        initial.packVersion !== alias.packVersion ||
        v.initial?.sourceImportId !== initial.scope.sourceImportId ||
        v.initial?.sourceValidationId !== initial.scope.sourceValidationId ||
        v.initial?.canonicalContentSha256 !== initial.canonicalContentSha256 ||
        v.initial?.assetSetSha256 !== initial.assetSetSha256 ||
        v.initial?.canonicalManifestSha256 !== initial.canonicalManifestSha256
      )
        bad();
      for (const [name, version] of [
        ["initial", "1.0.1"],
        ["second", "1.0.2"],
        ["third", "1.0.3"],
        ["spare", "1.0.4"],
        ["alias-initial", "1.0.1"],
      ])
        if (v.sources.find((s) => s.name === name)?.packVersion !== version)
          bad();
    }
  });
export type DraftRevisionFixture = z.infer<typeof draftRevisionFixtureSchema>;
