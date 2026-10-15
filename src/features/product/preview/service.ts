import "server-only";
import type { DatabaseBudget } from "@/lib/db/client";
import { StudioError } from "@/lib/http-security/errors";
import {
  authorizedPreviewRead,
  assertPreviewCsrf,
  reauthorizePreview,
} from "./auth";
import { readFixedPreviewSource } from "./repository";
import {
  previewScopeSchema,
  previewScoreRequestSchema,
  samePreviewBinding,
  previewEntryResponseSchema,
  previewRevealResponseSchema,
} from "./contracts";
import type { PreviewProjection } from "./projection-contract";
import type { ProductPreviewService } from "./service-contract";
import { PREVIEW_LIMITS } from "./limits";
export function previewCheckpoint(budget: DatabaseBudget): void {
  if (performance.now() >= budget.deadlineMonotonicMs)
    throw new StudioError("PREVIEW_TIMEOUT");
  if (budget.signal.aborted) throw new StudioError("PREVIEW_CANCELLED");
}
export function createProductPreviewService(
  projection: PreviewProjection,
): ProductPreviewService {
  const source: typeof readFixedPreviewSource = readFixedPreviewSource;
  return {
    async entry(db, credentials, scopeInput, budget) {
      const parsed = previewScopeSchema.safeParse(scopeInput);
      if (!parsed.success) throw new StudioError("INVALID_REQUEST");
      previewCheckpoint(budget);
      const fixed = await authorizedPreviewRead(db, credentials, (tx) =>
        source(tx, parsed.data),
      );
      previewCheckpoint(budget);
      const prepared = projection.preparePreviewContent(
        fixed.content,
        fixed.binding,
      );
      previewCheckpoint(budget);
      if (!prepared.ok) throw new StudioError(prepared.code);
      const response = previewEntryResponseSchema.safeParse({
        ok: true,
        value: prepared.value.entry,
      });
      if (
        !response.success ||
        !samePreviewBinding(prepared.value.entry.binding, fixed.binding)
      )
        throw new StudioError("PREVIEW_LIMIT_EXCEEDED");
      await reauthorizePreview(db, credentials);
      previewCheckpoint(budget);
      return response.data.value;
    },
    async score(db, credentials, scopeInput, inputValue, budget) {
      assertPreviewCsrf(credentials);
      const scoped = previewScopeSchema.safeParse(scopeInput),
        input = previewScoreRequestSchema.safeParse(inputValue);
      if (!scoped.success || !input.success)
        throw new StudioError("INVALID_REQUEST");
      if (
        Buffer.byteLength(JSON.stringify(input.data.answers), "utf8") >
        PREVIEW_LIMITS.answersBytes
      )
        throw new StudioError("PREVIEW_LIMIT_EXCEEDED");
      previewCheckpoint(budget);
      const fixed = await authorizedPreviewRead(db, credentials, (tx) =>
        source(tx, scoped.data),
      );
      if (!samePreviewBinding(fixed.binding, input.data.binding))
        throw new StudioError("PREVIEW_BINDING_MISMATCH");
      previewCheckpoint(budget);
      const prepared = projection.preparePreviewContent(
        fixed.content,
        fixed.binding,
      );
      if (!prepared.ok) throw new StudioError(prepared.code);
      previewCheckpoint(budget);
      const scored = projection.scorePreview(
        prepared.value.prepared,
        input.data.answers,
        input.data.requestId,
      );
      previewCheckpoint(budget);
      if (!scored.ok) throw new StudioError(scored.code);
      const response = previewRevealResponseSchema.safeParse({
        ok: true,
        value: scored.value,
      });
      if (
        !response.success ||
        !samePreviewBinding(scored.value.binding, fixed.binding) ||
        scored.value.requestId !== input.data.requestId
      )
        throw new StudioError("PREVIEW_LIMIT_EXCEEDED");
      await reauthorizePreview(db, credentials);
      previewCheckpoint(budget);
      return response.data.value;
    },
  };
}
