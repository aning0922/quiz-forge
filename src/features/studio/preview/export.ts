import {
  previewPosterExportSchema,
  bindingUsesCurrentRenderer,
  type PreviewPosterExport,
} from "@/features/product/preview/contracts";
import { PREVIEW_FONT_ASSET } from "@/features/product/preview/descriptor";
import { exportDisplayPoster } from "@/features/report/preview/export";
import { PreviewClientError, checkpoint } from "./client";
import { createPreviewResourceTransport } from "./media";

/** Studio scope is checked here; the report renderer receives display data only. */
export async function exportPreviewPoster(
  value: PreviewPosterExport,
  signal: AbortSignal,
  current: () => boolean,
): Promise<Blob> {
  const input = previewPosterExportSchema.parse(value);
  checkpoint(signal);
  if (!current()) throw new PreviewClientError("PREVIEW_CANCELLED");
  if (!bindingUsesCurrentRenderer(input.binding))
    throw new PreviewClientError("PREVIEW_BINDING_MISMATCH");
  const body = {
    answersHash: input.answersHash,
    logicHash: input.logicHash,
    selectedResultRef: input.selectedResultRef,
    reportTemplateRef: input.reportTemplateRef,
    poster: input.poster,
  };
  return exportDisplayPoster(
    body,
    createPreviewResourceTransport(input.binding),
    PREVIEW_FONT_ASSET,
    signal,
    current,
  );
}
