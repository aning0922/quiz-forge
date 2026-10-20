import { z } from "zod";
import {
  draftApplicationScopeSchema,
  validationStateRevisionSchema,
} from "../../src/features/product/drafts/contracts";
import { sha256Schema } from "../../src/features/quizpack/v1/manifest";
const actor = z.strictObject({
  identifier: z.uuid(),
  secret: z.string().min(40).max(256),
});
export const studioDraftFixtureSchema = z.strictObject({
  version: z.literal(1),
  runId: z.uuid(),
  qualification: z.literal("synthetic-db-only-no-media"),
  completed: z.boolean(),
  operator: actor,
  readOnly: actor,
  sources: z
    .array(
      z.strictObject({
        ...draftApplicationScopeSchema.shape,
        stateRevision: validationStateRevisionSchema,
        candidateSha256: sha256Schema,
        canonicalContentSha256: sha256Schema,
        canonicalContentBytes: z.number().int().positive().max(2097152),
      }),
    )
    .length(2),
});
export type StudioDraftFixture = z.infer<typeof studioDraftFixtureSchema>;
