import { qianzaiSnapshotDocument } from "./presentation";
import { privateTestAssetMatches } from "@/features/quizpack/content/private-test";
import { composedReportBodyV1Schema } from "@/lib/assessment-contract/composed-report-v1";
import {
  loadVerifiedImageV2 as loadVerifiedImage,
  type VerifiedImage,
} from "@/lib/browser/display-assets-v2";
import { checkpoint } from "@/lib/browser/display-task";
import { withPreviewFont } from "./export-font";
import {
  QIANZAI_EXPORT_LIMITS as L,
  QianzaiExportError,
  type QianzaiExportKind,
  type QianzaiExportScope,
} from "./contracts";
import {
  layoutQianzaiExport,
  qianzaiExportText,
  qianzaiExportBrushText,
  type ExportOperation,
} from "./layout";
import { QIANZAI_EDITORIAL_FONTS } from "@/features/theme/qianzai-tongxin/editorial-fonts";
import { qianzaiArtworkCrop } from "@/features/theme/qianzai-tongxin/art-framing";

export const qianzaiExportFailure = (error: unknown) => {
  if (error instanceof QianzaiExportError) return error;
  const code =
    error instanceof Error && "code" in error ? String(error.code) : "";
  return new QianzaiExportError(
    code === "FONT_COVERAGE"
      ? "FONT_COVERAGE"
      : code === "FONT_UNAVAILABLE"
        ? "FONT_UNAVAILABLE"
        : code === "PREVIEW_CANCELLED"
          ? "CANCELLED"
          : code.startsWith("RESOURCE_") ||
              code === "PREVIEW_RESOURCE_UNAVAILABLE"
            ? "RESOURCE_UNAVAILABLE"
            : "PNG_UNAVAILABLE",
  );
};
/** Rendering is read-only. Only the runtime owner constructs the scope and publishes URLs. */
export async function renderQianzaiExport(
  kind: QianzaiExportKind,
  scope: QianzaiExportScope,
  signal: AbortSignal,
): Promise<Readonly<{ blob: Blob; width: number; height: number }>> {
  const check = (active = signal, deadline = Infinity) => {
    checkpoint(active, deadline);
    if (!scope.current()) throw new QianzaiExportError("AUTHORITY_LOST");
  };
  try {
    check();
    const body = composedReportBodyV1Schema.parse(scope.body);
    const privateNote =
      scope.portrait.approval === "private-test-only"
        ? "测试素材 · 候选正文"
        : null;
    const texts = [
      ...qianzaiExportText(body, kind, scope.presentation),
      ...(privateNote ? [privateNote] : []),
    ];
    if (
      body.dimensions.length !== 5 ||
      texts.reduce((n, s) => n + Array.from(s).length, 0) > L.maxTextCodepoints
    )
      throw new QianzaiExportError("CONTENT_LIMIT");
    const assets = [
      scope.portrait,
      scope.nameArt,
      ...(scope.paper ? [scope.paper] : []),
      ...(scope.border ? [scope.border] : []),
    ];
    const unique = [
      ...new Map(
        assets.map((a) => [JSON.stringify(a.resourceRef), a]),
      ).values(),
    ];
    if (
      unique.some(
        (a) =>
          (a.approval !== "approved" && !privateTestAssetMatches(a)) ||
          !Number.isSafeInteger(a.width * a.height),
      ) ||
      unique.reduce((n, a) => n + a.width * a.height, 0) > L.maxImagePixels
    )
      throw new QianzaiExportError("CONTENT_LIMIT");
    const doc = qianzaiSnapshotDocument(body, undefined, scope.presentation);
    const consumerEdition =
      "consumerEdition" in doc && doc.consumerEdition === true;
    const bodyFont = consumerEdition
      ? QIANZAI_EDITORIAL_FONTS.literary
      : scope.font;
    return await withPreviewFont(
      bodyFont,
      texts,
      signal,
      async (family, parentActive, parentDeadline) =>
        withPreviewFont(
          QIANZAI_EDITORIAL_FONTS.brush,
          qianzaiExportBrushText(body, kind, scope.presentation),
          parentActive,
          async (brushFamily, active, brushDeadline) => {
            const deadline = Math.min(parentDeadline, brushDeadline);
            check(active, deadline);
            // A one-pixel measurement surface precedes any output canvas allocation.
            const scratch = document.createElement("canvas");
            scratch.width = 1;
            scratch.height = 1;
            const measure = scratch.getContext("2d");
            if (!measure) throw new QianzaiExportError("PNG_UNAVAILABLE");
            let layout;
            try {
              layout = layoutQianzaiExport(
                body,
                kind,
                (text, size, style) => {
                  measure.font = `${style === "brush" ? 400 : bodyFont.weight} ${size}px "${style === "brush" ? brushFamily : family}"`;
                  const m = measure.measureText(text);
                  return {
                    width: m.width,
                    left: m.actualBoundingBoxLeft,
                    right: m.actualBoundingBoxRight,
                    ascent: m.actualBoundingBoxAscent,
                    descent: m.actualBoundingBoxDescent,
                  };
                },
                () => check(active, deadline),
                {
                  ...(privateNote ? { annotation: privateNote } : {}),
                  ...(scope.presentation
                    ? { presentation: scope.presentation }
                    : {}),
                },
              );
            } finally {
              scratch.width = 0;
              scratch.height = 0;
            }
            check(active, deadline);
            const loaded = new Map<string, VerifiedImage>();
            let canvas: HTMLCanvasElement | undefined;
            try {
              for (const asset of unique) {
                check(active, deadline);
                const image = await loadVerifiedImage(
                  asset,
                  async (...args) => {
                    check(active, deadline);
                    return scope.transport(...args);
                  },
                  active,
                  deadline,
                );
                loaded.set(JSON.stringify(asset.resourceRef), image);
                check(active, deadline);
              }
              check(active, deadline);
              canvas = document.createElement("canvas");
              canvas.width = layout.width;
              canvas.height = layout.height;
              const ctx = canvas.getContext("2d");
              if (!ctx) throw new QianzaiExportError("PNG_UNAVAILABLE");
              ctx.fillStyle = "#f6ead2";
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              if (scope.paper) {
                const paper = loaded.get(
                  JSON.stringify(scope.paper.resourceRef),
                )!;
                const pattern = ctx.createPattern(paper.image, "repeat");
                if (pattern) {
                  ctx.save();
                  ctx.globalAlpha = 0.08;
                  ctx.fillStyle = pattern;
                  ctx.fillRect(0, 0, canvas.width, canvas.height);
                  ctx.restore();
                }
              }
              if (scope.border) {
                const border = loaded.get(
                  JSON.stringify(scope.border.resourceRef),
                )!;
                drawLandscape(
                  ctx,
                  border.image,
                  canvas.width,
                  canvas.height,
                  kind,
                  consumerEdition ? 480 : undefined,
                );
              }
              drawOrnateFrame(ctx, {
                x: 18,
                y: 18,
                width: canvas.width - 36,
                height: canvas.height - 36,
              });
              for (let i = 0; i < layout.operations.length; i++) {
                if (i % 32 === 0) {
                  check(active, deadline);
                  await new Promise<void>((resolve) => setTimeout(resolve, 0));
                  check(active, deadline);
                }
                drawOperation(
                  ctx,
                  layout.operations[i]!,
                  family,
                  brushFamily,
                  bodyFont.weight,
                  scope,
                  loaded,
                  canvas.width,
                );
              }
              check(active, deadline);
              const blob = await encode(canvas, active, () =>
                check(active, deadline),
              );
              check(active, deadline);
              if (blob.size > L.maxPngBytes)
                throw new QianzaiExportError("CONTENT_LIMIT");
              return { blob, width: layout.width, height: layout.height };
            } finally {
              for (const image of loaded.values()) image.release();
              if (canvas) {
                canvas.width = 0;
                canvas.height = 0;
              }
            }
          },
        ),
    );
  } catch (error) {
    throw qianzaiExportFailure(error);
  }
}
function encode(
  canvas: HTMLCanvasElement,
  signal: AbortSignal,
  check: () => void,
): Promise<Blob> {
  check();
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (blob: Blob | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", abort);
      try {
        check();
        if (!blob?.size || blob.type !== "image/png")
          throw new QianzaiExportError("PNG_UNAVAILABLE");
        resolve(blob);
      } catch (error) {
        reject(error);
      }
    };
    const abort = () => finish(null);
    const timer = setTimeout(abort, 15000);
    signal.addEventListener("abort", abort, { once: true });
    try {
      canvas.toBlob(finish, "image/png");
    } catch {
      finish(null);
    }
    if (signal.aborted) abort();
  });
}
type FrameBox = { x: number; y: number; width: number; height: number };
function drawOrnateFrame(ctx: CanvasRenderingContext2D, b: FrameBox) {
  ctx.save();
  ctx.strokeStyle = "#ae7c38";
  ctx.lineWidth = 1.2;
  const cut = Math.min(16, b.width / 8, b.height / 8);
  for (const inset of [0, 4]) {
    const x = b.x + inset,
      y = b.y + inset,
      w = b.width - inset * 2,
      h = b.height - inset * 2;
    ctx.beginPath();
    ctx.moveTo(x + cut, y);
    ctx.lineTo(x + w - cut, y);
    ctx.quadraticCurveTo(x + w - cut, y + cut, x + w, y + cut);
    ctx.lineTo(x + w, y + h - cut);
    ctx.quadraticCurveTo(x + w - cut, y + h - cut, x + w - cut, y + h);
    ctx.lineTo(x + cut, y + h);
    ctx.quadraticCurveTo(x + cut, y + h - cut, x, y + h - cut);
    ctx.lineTo(x, y + cut);
    ctx.quadraticCurveTo(x + cut, y + cut, x + cut, y);
    ctx.stroke();
  }
  for (const x of [b.x, b.x + b.width])
    for (const y of [b.y, b.y + b.height]) {
      ctx.beginPath();
      ctx.arc(x, y, cut * 0.42, 0, Math.PI * 2);
      ctx.stroke();
    }
  ctx.restore();
}
function drawLandscape(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  width: number,
  height: number,
  kind: QianzaiExportKind,
  openingHeight?: number,
) {
  const sw = image.naturalWidth,
    sh = image.naturalHeight;
  if (kind === "poster") {
    ctx.drawImage(image, 0, 0, sw, sh, 0, 0, width, height);
    return;
  }
  // The center is an unlettered paper sample; only the decorative edge strips repeat.
  const paper = document.createElement("canvas");
  paper.width = 240;
  paper.height = 140;
  try {
    const p = paper.getContext("2d");
    if (!p) throw new QianzaiExportError("PNG_UNAVAILABLE");
    p.drawImage(
      image,
      sw * 0.16,
      sh * 0.24,
      sw * 0.12,
      sh * 0.035,
      0,
      0,
      240,
      140,
    );
    const pattern = ctx.createPattern(paper, "repeat");
    if (pattern) {
      ctx.save();
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = pattern;
      ctx.fillRect(0, 0, width, height);
      ctx.restore();
    }
  } finally {
    paper.width = 0;
    paper.height = 0;
  }
  const top = Math.min(openingHeight ?? width * 1.02, height),
    bottom = Math.min(width * 0.22, height - top);
  ctx.drawImage(image, 0, 0, sw, sh * 0.55, 0, 0, width, top);
  const side = width * 0.065,
    tileHeight = width * 0.65;
  const strip = document.createElement("canvas");
  strip.width = Math.ceil(side);
  strip.height = Math.ceil(tileHeight);
  try {
    const p = strip.getContext("2d");
    if (!p) throw new QianzaiExportError("PNG_UNAVAILABLE");
    for (const right of [false, true]) {
      p.clearRect(0, 0, strip.width, strip.height);
      p.globalCompositeOperation = "source-over";
      p.drawImage(
        image,
        right ? sw * 0.885 : 0,
        sh * 0.48,
        sw * 0.115,
        sh * 0.28,
        0,
        0,
        side,
        tileHeight,
      );
      p.globalCompositeOperation = "destination-in";
      const inward = p.createLinearGradient(0, 0, side, 0);
      inward.addColorStop(right ? 1 : 0, "#000");
      inward.addColorStop(right ? 0 : 1, "#0000");
      p.fillStyle = inward;
      p.fillRect(0, 0, side, tileHeight);
      const ends = p.createLinearGradient(0, 0, 0, tileHeight);
      ends.addColorStop(0, "#0000");
      ends.addColorStop(0.12, "#000");
      ends.addColorStop(0.88, "#000");
      ends.addColorStop(1, "#0000");
      p.fillStyle = ends;
      p.fillRect(0, 0, side, tileHeight);
      for (
        let y = top - tileHeight * 0.12;
        y < height - bottom;
        y += tileHeight * 0.8
      )
        ctx.drawImage(strip, right ? width - side : 0, y, side, tileHeight);
    }
  } finally {
    strip.width = 0;
    strip.height = 0;
  }
  ctx.drawImage(
    image,
    0,
    sh * 0.78,
    sw,
    sh * 0.22,
    0,
    height - bottom,
    width,
    bottom,
  );
}
function drawOperation(
  ctx: CanvasRenderingContext2D,
  op: ExportOperation,
  family: string,
  brushFamily: string,
  bodyWeight: 400 | 600,
  scope: QianzaiExportScope,
  loaded: Map<string, VerifiedImage>,
  width: number,
) {
  if (op.kind === "text") {
    ctx.font = `${op.style === "brush" ? 400 : bodyWeight} ${op.size}px "${op.style === "brush" ? brushFamily : family}"`;
    ctx.fillStyle = op.color;
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    ctx.fillText(op.text, op.x, op.y);
    return;
  }
  if (op.kind === "rule") {
    const g = ctx.createLinearGradient(40, 0, width - 40, 0);
    g.addColorStop(0, "#b58a4c22");
    g.addColorStop(0.5, "#b58a4c");
    g.addColorStop(1, "#b58a4c22");
    ctx.fillStyle = g;
    ctx.fillRect(40, op.y, width - 80, 2);
    return;
  }
  if (op.kind === "bar") {
    if (op.prototypeScale && op.scale) {
      const r = op.prototypeScale,
        h = 7 * r,
        centerY = op.y + h / 2,
        bandX = op.x + (op.width * op.scale.bandStartPercent) / 100,
        bandWidth = (op.width * op.scale.bandWidthPercent) / 100,
        pearlX = op.x + (op.width * op.scale.positionPercent) / 100;
      ctx.save();
      const track = ctx.createLinearGradient(op.x, 0, op.x + op.width, 0);
      track.addColorStop(0, "#d6cec1");
      track.addColorStop(0.5, "#e6d5b5");
      track.addColorStop(1, "#d5c5a7");
      ctx.fillStyle = track;
      ctx.beginPath();
      ctx.roundRect(op.x, op.y, op.width, h, h / 2);
      ctx.fill();
      // A restrained inner edge replaces the flat rectangular bar.
      ctx.save();
      ctx.clip();
      ctx.strokeStyle = "#58452e21";
      ctx.lineWidth = 2 * r;
      ctx.stroke();
      ctx.restore();
      const band = ctx.createLinearGradient(bandX, 0, bandX + bandWidth, 0);
      band.addColorStop(0, "#557c89eb");
      band.addColorStop(1, "#c29c64eb");
      if (bandWidth > 0) {
        ctx.fillStyle = band;
        ctx.beginPath();
        ctx.roundRect(bandX, op.y, bandWidth, h, Math.min(h, bandWidth) / 2);
        ctx.fill();
      }
      const midpointX = op.x + (op.width * op.scale.midpointPercent) / 100;
      ctx.fillStyle = "#ac916de6";
      ctx.beginPath();
      ctx.roundRect(midpointX - r, op.y - 4 * r, 2 * r, 15 * r, r);
      ctx.fill();
      ctx.shadowColor = "#79613e66";
      ctx.shadowBlur = 4 * r;
      ctx.shadowOffsetY = r;
      ctx.beginPath();
      ctx.arc(pearlX, centerY, 8.5 * r, 0, Math.PI * 2);
      ctx.fillStyle = "#fff7e6";
      ctx.fill();
      ctx.shadowColor = "transparent";
      const pearl = ctx.createRadialGradient(
        pearlX - 2.2 * r,
        centerY - 3 * r,
        r,
        pearlX,
        centerY,
        7 * r,
      );
      pearl.addColorStop(0, "#fffcf3");
      pearl.addColorStop(0.17, "#fffcf3");
      pearl.addColorStop(0.42, "#efd49e");
      pearl.addColorStop(0.93, "#bb8e50");
      ctx.fillStyle = pearl;
      ctx.strokeStyle = "#a57a44";
      ctx.lineWidth = r;
      ctx.beginPath();
      ctx.arc(pearlX, centerY, 7 * r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return;
    }
    ctx.fillStyle = "#e1c99b";
    ctx.fillRect(op.x, op.y, op.width, 12);
    if (op.scale) {
      ctx.save();
      const bandX = op.x + (op.width * op.scale.bandStartPercent) / 100;
      const bandWidth = (op.width * op.scale.bandWidthPercent) / 100;
      const band = ctx.createLinearGradient(op.x, 0, op.x + op.width, 0);
      band.addColorStop(0, "#80999b");
      band.addColorStop(1, "#c29a5d");
      ctx.fillStyle = band;
      ctx.fillRect(bandX, op.y, bandWidth, 12);
      ctx.fillStyle = "#9d7a43";
      ctx.fillRect(
        op.x + (op.width * op.scale.midpointPercent) / 100 - 1,
        op.y - 5,
        2,
        22,
      );
      const x = op.x + (op.width * op.scale.positionPercent) / 100;
      const pearl = ctx.createRadialGradient(
        x - 3,
        op.y + 2,
        1,
        x,
        op.y + 6,
        10,
      );
      pearl.addColorStop(0, "#fff9dd");
      pearl.addColorStop(0.5, "#dcb978");
      pearl.addColorStop(1, "#9d7037");
      ctx.fillStyle = pearl;
      ctx.strokeStyle = "#fff5db";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(x, op.y + 6, 10, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
      return;
    }
    const g = ctx.createLinearGradient(op.x, 0, op.x + op.width, 0);
    g.addColorStop(0, "#a9c0c1");
    g.addColorStop(1, "#3d6674");
    ctx.fillStyle = g;
    ctx.fillRect(op.x, op.y, (op.width * op.score) / 100, 12);
    const x = op.x + (op.width * op.score) / 100;
    ctx.fillStyle = "#bd9149";
    ctx.beginPath();
    ctx.moveTo(x, op.y - 5);
    ctx.lineTo(x + 7, op.y + 6);
    ctx.lineTo(x, op.y + 17);
    ctx.lineTo(x - 7, op.y + 6);
    ctx.closePath();
    ctx.fill();
    return;
  }
  if (op.kind === "ornament") {
    if (op.style === "heading") {
      const b = op.box,
        cx = b.x + b.width / 2,
        cy = b.y + b.height / 2;
      ctx.save();
      ctx.strokeStyle = "#ac7732";
      ctx.lineWidth = 1.2;
      for (const scale of [1, 0.68]) {
        ctx.beginPath();
        ctx.moveTo(cx, cy - (b.height / 2) * scale);
        ctx.lineTo(cx + (b.width / 2) * scale, cy);
        ctx.lineTo(cx, cy + (b.height / 2) * scale);
        ctx.lineTo(cx - (b.width / 2) * scale, cy);
        ctx.closePath();
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(cx, cy - b.height * 0.8);
      ctx.lineTo(cx, cy + b.height * 0.8);
      ctx.moveTo(cx - b.width * 0.8, cy);
      ctx.lineTo(cx + b.width * 0.8, cy);
      ctx.stroke();
      ctx.restore();
    } else drawOrnateFrame(ctx, op.box);
    return;
  }
  if (op.kind === "seal") {
    const b = op.box;
    ctx.save();
    ctx.fillStyle = "#ad3025";
    ctx.beginPath();
    ctx.moveTo(b.x + 6, b.y + 4);
    ctx.lineTo(b.x + b.width * 0.7, b.y);
    ctx.lineTo(b.x + b.width, b.y + 9);
    ctx.lineTo(b.x + b.width - 3, b.y + b.height - 9);
    ctx.lineTo(b.x + b.width * 0.6, b.y + b.height);
    ctx.lineTo(b.x + 3, b.y + b.height - 6);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = "#e2b073";
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();
    return;
  }
  if (op.kind === "card") {
    ctx.save();
    ctx.fillStyle = op.dark ? "#e9d5adcc" : "#fff7e6b0";
    ctx.fillRect(op.box.x, op.box.y, op.box.width, op.box.height);
    drawOrnateFrame(ctx, op.box);
    ctx.restore();
    return;
  }
  if (op.kind === "image") {
    const asset = op.role === "portrait" ? scope.portrait : scope.nameArt;
    const image = loaded.get(JSON.stringify(asset.resourceRef))!.image,
      b = op.box;
    const source = (op.role === "portrait"
      ? qianzaiArtworkCrop(asset)
      : undefined) ?? {
      x: 0,
      y: 0,
      width: image.naturalWidth,
      height: image.naturalHeight,
    };
    const layer = document.createElement("canvas");
    layer.width = Math.ceil(b.width);
    layer.height = Math.ceil(b.height);
    try {
      const paint = layer.getContext("2d");
      if (!paint) throw new QianzaiExportError("PNG_UNAVAILABLE");
      const scale = (op.fit === "cover" ? Math.max : Math.min)(
          b.width / source.width,
          b.height / source.height,
        ),
        w = source.width * scale * (op.blend ? 1.28 : 1),
        h = source.height * scale * (op.blend ? 1.28 : 1);
      paint.drawImage(
        image,
        source.x,
        source.y,
        source.width,
        source.height,
        (b.width - w) / 2,
        op.role === "portrait" && op.fit === "cover" ? 0 : (b.height - h) / 2,
        w,
        h,
      );
      if (op.ink) {
        paint.globalCompositeOperation = "source-in";
        paint.fillStyle = op.ink;
        paint.fillRect(0, 0, b.width, b.height);
      }
      if (op.role === "portrait") {
        // A feathered watercolor silhouette removes the photographic corners and
        // keeps the common landscape visible around the actual character pixels.
        const mask = document.createElement("canvas");
        mask.width = layer.width;
        mask.height = layer.height;
        try {
          const m = mask.getContext("2d");
          if (!m) throw new QianzaiExportError("PNG_UNAVAILABLE");
          m.filter = "blur(7px)";
          m.fillStyle = "#000";
          m.beginPath();
          if (op.blend && b.height > b.width) {
            // Follow the tall portrait's hair crown rather than admitting the
            // sky above it; the common landscape keeps its complete moon.
            m.moveTo(b.width * 0.27, b.height * 0.13);
            m.bezierCurveTo(
              b.width * 0.32,
              b.height * 0.035,
              b.width * 0.49,
              b.height * 0.01,
              b.width * 0.59,
              b.height * 0.075,
            );
            m.bezierCurveTo(
              b.width * 0.66,
              b.height * 0.11,
              b.width * 0.7,
              b.height * 0.16,
              b.width * 0.72,
              b.height * 0.24,
            );
            m.bezierCurveTo(
              b.width * 0.77,
              b.height * 0.44,
              b.width * 0.97,
              b.height * 0.65,
              b.width * 0.97,
              b.height * 0.9,
            );
            m.lineTo(b.width * 0.9, b.height * 1.03);
            m.lineTo(b.width * 0.02, b.height * 1.03);
            m.bezierCurveTo(
              b.width * 0.03,
              b.height * 0.65,
              b.width * 0.16,
              b.height * 0.51,
              b.width * 0.25,
              b.height * 0.35,
            );
            m.bezierCurveTo(
              b.width * 0.24,
              b.height * 0.26,
              b.width * 0.22,
              b.height * 0.2,
              b.width * 0.27,
              b.height * 0.13,
            );
          } else if (op.blend) {
            m.moveTo(b.width * 0.38, b.height * 0.02);
            m.bezierCurveTo(
              b.width * 0.57,
              -b.height * 0.04,
              b.width * 0.76,
              b.height * 0.08,
              b.width * 0.78,
              b.height * 0.24,
            );
            m.bezierCurveTo(
              b.width * 0.79,
              b.height * 0.44,
              b.width * 0.97,
              b.height * 0.65,
              b.width * 0.97,
              b.height * 0.9,
            );
            m.lineTo(b.width * 0.9, b.height * 1.03);
            m.lineTo(b.width * 0.02, b.height * 1.03);
            m.bezierCurveTo(
              b.width * 0.03,
              b.height * 0.65,
              b.width * 0.16,
              b.height * 0.51,
              b.width * 0.25,
              b.height * 0.35,
            );
            m.bezierCurveTo(
              b.width * 0.26,
              b.height * 0.17,
              b.width * 0.25,
              b.height * 0.07,
              b.width * 0.38,
              b.height * 0.02,
            );
          } else {
            m.moveTo(b.width * 0.23, b.height * 0.04);
            m.bezierCurveTo(
              b.width * 0.52,
              -b.height * 0.06,
              b.width * 0.84,
              b.height * 0.05,
              b.width * 0.95,
              b.height * 0.27,
            );
            m.lineTo(b.width * 0.98, b.height * 0.8);
            m.lineTo(b.width * 0.88, b.height * 0.99);
            m.lineTo(b.width * 0.07, b.height * 0.98);
            m.lineTo(b.width * 0.01, b.height * 0.3);
            m.closePath();
          }
          m.closePath();
          m.fill();
          paint.globalCompositeOperation = "destination-in";
          paint.drawImage(mask, 0, 0, b.width, b.height);
        } finally {
          mask.width = 0;
          mask.height = 0;
        }
        // Fade alpha into the actual landscape beneath, never a beige rectangle.
        paint.globalCompositeOperation = "destination-in";
        const horizontal = paint.createLinearGradient(0, 0, b.width, 0);
        horizontal.addColorStop(0, "#0000");
        horizontal.addColorStop(op.blend ? 0.25 : 0.13, "#000");
        horizontal.addColorStop(0.96, "#000");
        horizontal.addColorStop(1, "#0000");
        paint.fillStyle = horizontal;
        paint.fillRect(0, 0, b.width, b.height);
        const vertical = paint.createLinearGradient(0, 0, 0, b.height);
        vertical.addColorStop(0, "#0000");
        vertical.addColorStop(0.06, "#000");
        vertical.addColorStop(op.blend ? 0.7 : 0.8, "#000");
        vertical.addColorStop(1, "#0000");
        paint.fillStyle = vertical;
        paint.fillRect(0, 0, b.width, b.height);
      }
      ctx.drawImage(layer, b.x, b.y, b.width, b.height);
    } finally {
      layer.width = 0;
      layer.height = 0;
    }
    return;
  }
  const point = (i: number, scale: number) => {
    const angle = -Math.PI / 2 + (i * Math.PI * 2) / 5;
    return [
      op.x + Math.cos(angle) * op.radius * scale,
      op.y + Math.sin(angle) * op.radius * scale,
    ] as const;
  };
  const polygon = (scales: readonly number[]) => {
    ctx.beginPath();
    scales.forEach((scale, i) => {
      const [x, y] = point(i, scale);
      if (!i) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.closePath();
  };
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = "#b8975e";
  for (const scale of [0.2, 0.4, 0.6, 0.8, 1]) {
    polygon(Array(5).fill(scale));
    ctx.stroke();
  }
  for (let i = 0; i < 5; i++) {
    ctx.beginPath();
    ctx.moveTo(op.x, op.y);
    ctx.lineTo(...point(i, 1));
    ctx.stroke();
  }
  polygon(op.scores.map((n) => n / 100));
  ctx.fillStyle = "#527f8b88";
  ctx.fill();
  ctx.strokeStyle = "#375c67";
  ctx.lineWidth = 3;
  ctx.stroke();
  op.scores.forEach((score, i) => {
    ctx.beginPath();
    ctx.arc(...point(i, score / 100), 5, 0, Math.PI * 2);
    ctx.fillStyle = "#c49b51";
    ctx.fill();
  });
}
