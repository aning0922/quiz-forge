import {
  previewPosterExportSchema,
  bindingUsesCurrentRenderer,
  type PreviewPosterExport,
} from "@/features/product/preview/contracts";
import { PREVIEW_POSTER_LIMITS } from "@/features/product/preview/limits";
import {
  PreviewClientError,
  checkpoint,
} from "@/features/studio/preview/client";
import { loadPreviewImage } from "@/features/studio/preview/media";
import { withPreviewFont } from "./font";
import { layoutPreviewPoster, PREVIEW_MARK } from "./layout";

export async function exportPreviewPoster(
  value: PreviewPosterExport,
  signal: AbortSignal,
  current: () => boolean,
): Promise<Blob> {
  const input = previewPosterExportSchema.parse(value);
  const check = () => {
    checkpoint(signal);
    if (!current()) throw new PreviewClientError("PREVIEW_CANCELLED");
  };
  check();
  if (!bindingUsesCurrentRenderer(input.binding))
    throw new PreviewClientError("PREVIEW_BINDING_MISMATCH");
  const p = input.poster,
    texts = [
      p.displayName,
      p.subtitle,
      p.posterLine.text,
      p.posterDisclosure,
      PREVIEW_MARK,
      ...p.dimensions.map((d) => `${d.label}  ${d.normalizedText}`),
    ];
  return withPreviewFont(texts, signal, async (family, active) => {
    const checkActive = () => {
      check();
      checkpoint(active);
    };
    checkActive();
    const portrait = await loadPreviewImage(input.binding, p.portrait, active);
    try {
      checkActive();
      const canvas = document.createElement("canvas");
      canvas.width = PREVIEW_POSTER_LIMITS.width;
      canvas.height = PREVIEW_POSTER_LIMITS.height;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new PreviewClientError("PNG_UNAVAILABLE");
      const font = (size: number) => `600 ${size}px "${family}"`;
      let blocks;
      try {
        blocks = layoutPreviewPoster(input, (text, size) => {
          ctx.font = font(size);
          const m = ctx.measureText(text);
          return Math.max(
            m.width,
            Math.max(0, m.actualBoundingBoxLeft) + m.actualBoundingBoxRight,
          );
        });
      } catch {
        throw new PreviewClientError("POSTER_LIMIT_EXCEEDED");
      }
      checkActive();
      ctx.fillStyle = "#f3ebdd";
      ctx.fillRect(0, 0, 1080, 1920);
      ctx.fillStyle = "#142f2e";
      ctx.fillRect(0, 0, 1080, 1180);
      const frame = { x: 60, y: 70, width: 960, height: 1080 },
        image = portrait.image;
      const scale = Math.min(
        frame.width / image.naturalWidth,
        frame.height / image.naturalHeight,
      );
      ctx.drawImage(
        image,
        frame.x + (frame.width - image.naturalWidth * scale) / 2,
        frame.y + (frame.height - image.naturalHeight * scale) / 2,
        image.naturalWidth * scale,
        image.naturalHeight * scale,
      );
      ctx.strokeStyle = "#887044";
      ctx.lineWidth = 2;
      ctx.strokeRect(42, 42, 996, 1836);
      ctx.fillStyle = "#292d29";
      ctx.textBaseline = "top";
      let previousInkBottom = 1220;
      for (const block of blocks) {
        ctx.font = font(block.size);
        // Check actual font ink bounds too, not just advance width or codepoints.
        const m = ctx.measureText(block.text);
        const inkTop = block.y - m.actualBoundingBoxAscent,
          inkBottom = block.y + m.actualBoundingBoxDescent;
        if (
          ![
            m.width,
            m.actualBoundingBoxLeft,
            m.actualBoundingBoxRight,
            inkTop,
            inkBottom,
          ].every(Number.isFinite) ||
          inkTop < previousInkBottom ||
          m.width > block.maxWidth ||
          block.x +
            Math.max(0, m.actualBoundingBoxLeft) +
            m.actualBoundingBoxRight >
            990 ||
          block.y - m.actualBoundingBoxAscent < 1220 ||
          block.y + Math.max(block.size, m.actualBoundingBoxDescent) > 1868
        )
          throw new PreviewClientError("POSTER_LIMIT_EXCEEDED");
        previousInkBottom = inkBottom;
        ctx.fillText(
          block.text,
          block.x + Math.max(0, m.actualBoundingBoxLeft),
          block.y,
        );
      }
      checkActive();
      const blob = await new Promise<Blob>((resolve, reject) => {
        let settled = false;
        const abort = () => finish(undefined);
        const timer = setTimeout(abort, 15000);
        const finish = (blob: Blob | null | undefined) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          active.removeEventListener("abort", abort);
          if (blob?.type === "image/png" && blob.size > 0) resolve(blob);
          else reject(new PreviewClientError("PNG_UNAVAILABLE"));
        };
        active.addEventListener("abort", abort, { once: true });
        try {
          canvas.toBlob(finish, "image/png");
        } catch {
          finish(undefined);
        }
        if (active.aborted) abort();
      });
      checkActive();
      return blob;
    } finally {
      portrait.release();
    }
  });
}
