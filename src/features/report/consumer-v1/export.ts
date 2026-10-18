import {
  displayPosterExportBodyV1Schema,
  type DisplayPosterExportBodyV1,
  type DisplayFontDescriptorV1,
  type DisplayResourceTransport,
} from "@/lib/assessment-contract/display-v1";
import { DISPLAY_POSTER_LIMITS_V1 as PREVIEW_POSTER_LIMITS } from "@/lib/assessment-contract/display-limits-v1";
import { DisplayClientError, checkpoint } from "@/lib/browser/display-task";
import { loadVerifiedImage } from "@/lib/browser/display-assets";
import { withPreviewFont } from "@/features/report/preview/font";
import { layoutConsumerPosterV1, CONSUMER_REPORT_MARK } from "./layout";

export async function exportConsumerPosterV1(
  value: DisplayPosterExportBodyV1,
  transport: DisplayResourceTransport,
  font: DisplayFontDescriptorV1,
  signal: AbortSignal,
  current: () => boolean,
): Promise<Blob> {
  const input = displayPosterExportBodyV1Schema.parse(value);
  const check = () => {
    checkpoint(signal);
    if (!current()) throw new DisplayClientError("PREVIEW_CANCELLED");
  };
  check();
  const p = input.poster,
    texts = [
      p.displayName,
      p.subtitle,
      p.posterLine.text,
      p.posterDisclosure,
      CONSUMER_REPORT_MARK,
      ...p.dimensions.map((d) => `${d.label}  ${d.normalizedText}`),
    ];
  return withPreviewFont(
    font,
    texts,
    signal,
    async (family, active, deadline) => {
      const checkActive = () => {
        check();
        checkpoint(active);
      };
      checkActive();
      const portrait = await loadVerifiedImage(
        p.portrait,
        transport,
        active,
        deadline,
      );
      try {
        checkActive();
        const canvas = document.createElement("canvas");
        canvas.width = PREVIEW_POSTER_LIMITS.width;
        canvas.height = PREVIEW_POSTER_LIMITS.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new DisplayClientError("PNG_UNAVAILABLE");
        const font = (size: number) => `600 ${size}px "${family}"`;
        let blocks;
        try {
          blocks = layoutConsumerPosterV1(input, (text, size) => {
            ctx.font = font(size);
            const m = ctx.measureText(text);
            return Math.max(
              m.width,
              Math.max(0, m.actualBoundingBoxLeft) + m.actualBoundingBoxRight,
            );
          });
        } catch {
          throw new DisplayClientError("POSTER_LIMIT_EXCEEDED");
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
            throw new DisplayClientError("POSTER_LIMIT_EXCEEDED");
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
            else reject(new DisplayClientError("PNG_UNAVAILABLE"));
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
    },
  );
}
