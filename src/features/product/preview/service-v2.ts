import "server-only";
import type { P2aDatabase, DatabaseBudget } from "@/lib/db/client";
import { StudioError } from "@/lib/http-security/errors";
import {
  authorizedPreviewRead,
  assertPreviewCsrf,
  reauthorizePreview,
  type PreviewCredentials,
} from "./auth";
import { previewScopeSchema } from "./contracts";
import { previewCheckpoint } from "./service";
import { readCurrentPreviewSource } from "./repository-v2";
import {
  currentPreviewResponseSchema,
  temporaryPreviewRequestV2Schema,
  temporaryPreviewResultResponseV2Schema,
  samePreviewBindingV2,
  PREVIEW_LIMITS_V2,
} from "./contracts-v2";
import {
  projectContentEntryV3,
  projectPreparedResultV3,
} from "@/features/theme/preview/v3-projection";
import { prepareContentV3 } from "@/features/quizpack/content/v3-scoring-adapter";
import type { PreviewScope } from "./contracts";
type Credentials = PreviewCredentials;
export const currentProductPreviewService = {
  async entry(
    db: P2aDatabase,
    credentials: Credentials,
    scopeInput: PreviewScope,
    budget: DatabaseBudget,
  ) {
    const parsedScope = previewScopeSchema.safeParse(scopeInput);
    if (!parsedScope.success) throw new StudioError("INVALID_REQUEST");
    const scope = parsedScope.data;
    previewCheckpoint(budget);
    const fixed = await authorizedPreviewRead(db, credentials, (tx) =>
      readCurrentPreviewSource(tx, scope),
    );
    previewCheckpoint(budget);
    let selection;
    if (fixed.mode === "legacy")
      selection = { mode: "legacy" as const, binding: fixed.binding };
    else {
      const projected = projectContentEntryV3(
        fixed.content,
        fixed.binding.canonicalContentSha256,
      );
      previewCheckpoint(budget);
      if (!projected.ok) throw new StudioError("PREVIEW_UNSUPPORTED");
      selection = {
        mode: "structured" as const,
        value: {
          kind: "temporary-preview" as const,
          binding: fixed.binding,
          entry: projected.value,
        },
      };
    }
    const result = currentPreviewResponseSchema.safeParse({
      ok: true,
      value: selection,
    });
    if (!result.success) throw new StudioError("PREVIEW_LIMIT_EXCEEDED");
    await reauthorizePreview(db, credentials);
    previewCheckpoint(budget);
    return result.data.value;
  },
  async score(
    db: P2aDatabase,
    credentials: Credentials,
    scopeInput: PreviewScope,
    input: unknown,
    budget: DatabaseBudget,
  ) {
    assertPreviewCsrf(credentials);
    const scoped = previewScopeSchema.safeParse(scopeInput),
      request = temporaryPreviewRequestV2Schema.safeParse(input);
    if (!scoped.success || !request.success)
      throw new StudioError("INVALID_REQUEST");
    if (
      Buffer.byteLength(JSON.stringify(request.data), "utf8") >
        PREVIEW_LIMITS_V2.scoreRequestBytes ||
      Buffer.byteLength(JSON.stringify(request.data.answers), "utf8") >
        PREVIEW_LIMITS_V2.answersBytes
    )
      throw new StudioError("PREVIEW_LIMIT_EXCEEDED");
    previewCheckpoint(budget);
    const fixed = await authorizedPreviewRead(db, credentials, (tx) =>
      readCurrentPreviewSource(tx, scoped.data),
    );
    if (
      fixed.mode !== "structured" ||
      !samePreviewBindingV2(fixed.binding, request.data.binding)
    )
      throw new StudioError("PREVIEW_BINDING_MISMATCH");
    previewCheckpoint(budget);
    const prepared = prepareContentV3(fixed.content);
    if (!prepared.ok) throw new StudioError("PREVIEW_UNSUPPORTED");
    previewCheckpoint(budget);
    const projected = projectPreparedResultV3(prepared.value, {
      schemaVersion: "quiz-scoring-input.v2",
      answers: request.data.answers,
      matchingContext: request.data.matchingContext,
    });
    previewCheckpoint(budget);
    if (!projected.ok) throw new StudioError("PREVIEW_INVALID_ANSWERS");
    const result = temporaryPreviewResultResponseV2Schema.safeParse({
      ok: true,
      value: {
        kind: "temporary-preview",
        binding: fixed.binding,
        requestId: request.data.requestId,
        result: projected.value.display,
      },
    });
    if (!result.success) throw new StudioError("PREVIEW_LIMIT_EXCEEDED");
    await reauthorizePreview(db, credentials);
    previewCheckpoint(budget);
    return result.data.value;
  },
};
