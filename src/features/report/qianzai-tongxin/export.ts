import { composedReportBodyV1Schema } from "@/lib/assessment-contract/composed-report-v1";
import {
  loadVerifiedImage,
  type VerifiedImage,
} from "@/lib/browser/display-assets";
import { checkpoint } from "@/lib/browser/display-task";
import { withPreviewFont } from "@/features/report/preview/font";
import {
  QIANZAI_EXPORT_LIMITS as L,
  QianzaiExportError,
  type QianzaiExportKind,
  type QianzaiExportScope,
} from "./contracts";
import {
  layoutQianzaiExport,
  qianzaiExportText,
  type ExportOperation,
} from "./layout";

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
    const texts = qianzaiExportText(body, kind);
    if (
      body.dimensions.length !== 5 ||
      texts.reduce((n, s) => n + Array.from(s).length, 0) > L.maxTextCodepoints
    )
      throw new QianzaiExportError("CONTENT_LIMIT");
    const assets = [
      scope.portrait,
      scope.nameArt,
      ...(scope.paper ? [scope.paper] : []),
    ];
    const unique = [
      ...new Map(
        assets.map((a) => [JSON.stringify(a.resourceRef), a]),
      ).values(),
    ];
    if (
      unique.some(
        (a) =>
          a.approval !== "approved" ||
          !Number.isSafeInteger(a.width * a.height),
      ) ||
      unique.reduce((n, a) => n + a.width * a.height, 0) > L.maxImagePixels
    )
      throw new QianzaiExportError("CONTENT_LIMIT");
    return await withPreviewFont(
      scope.font,
      texts,
      signal,
      async (family, active, deadline) => {
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
            (text, size) => {
              measure.font = `600 ${size}px "${family}"`;
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
            const paper = loaded.get(JSON.stringify(scope.paper.resourceRef))!;
            const pattern = ctx.createPattern(paper.image, "repeat");
            if (pattern) {
              ctx.save();
              ctx.globalAlpha = 0.08;
              ctx.fillStyle = pattern;
              ctx.fillRect(0, 0, canvas.width, canvas.height);
              ctx.restore();
            }
          }
          const wash = ctx.createLinearGradient(
            0,
            0,
            canvas.width,
            canvas.height,
          );
          wash.addColorStop(0, "#fff9ec88");
          wash.addColorStop(1, "#d7b57a22");
          ctx.fillStyle = wash;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.strokeStyle = "#b18a4e";
          ctx.lineWidth = 2;
          ctx.strokeRect(20, 20, canvas.width - 40, canvas.height - 40);
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
function drawOperation(
  ctx: CanvasRenderingContext2D,
  op: ExportOperation,
  family: string,
  scope: QianzaiExportScope,
  loaded: Map<string, VerifiedImage>,
  width: number,
) {
  if (op.kind === "text") {
    ctx.font = `600 ${op.size}px "${family}"`;
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
    ctx.fillStyle = "#e1c99b";
    ctx.fillRect(op.x, op.y, op.width, 12);
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
  if (op.kind === "card") {
    ctx.fillStyle = op.dark ? "#19384a" : "#fff8eb";
    ctx.fillRect(op.box.x, op.box.y, op.box.width, op.box.height);
    ctx.strokeStyle = "#c6a56b";
    ctx.strokeRect(op.box.x, op.box.y, op.box.width, op.box.height);
    return;
  }
  if (op.kind === "image") {
    const asset = op.role === "portrait" ? scope.portrait : scope.nameArt;
    const image = loaded.get(JSON.stringify(asset.resourceRef))!.image,
      b = op.box;
    const scale = (op.fit === "cover" ? Math.max : Math.min)(
      b.width / image.naturalWidth,
      b.height / image.naturalHeight,
    );
    const w = image.naturalWidth * scale,
      h = image.naturalHeight * scale;
    ctx.save();
    ctx.beginPath();
    ctx.rect(b.x, b.y, b.width, b.height);
    ctx.clip();
    ctx.drawImage(
      image,
      b.x + (b.width - w) / 2,
      op.role === "portrait" && op.fit === "cover"
        ? b.y
        : b.y + (b.height - h) / 2,
      w,
      h,
    );
    if (op.role === "portrait") {
      const g = ctx.createLinearGradient(
        0,
        b.y + b.height * 0.78,
        0,
        b.y + b.height,
      );
      g.addColorStop(0, "#f6ead200");
      g.addColorStop(1, "#f6ead2");
      ctx.fillStyle = g;
      ctx.fillRect(b.x, b.y + b.height * 0.78, b.width, b.height * 0.22);
    }
    if (op.role === "portrait") {
      const edge = Math.min(60, b.width * 0.15);
      for (const [start, end] of [
        [b.x, b.x + edge],
        [b.x + b.width, b.x + b.width - edge],
      ]) {
        const g = ctx.createLinearGradient(start!, 0, end!, 0);
        g.addColorStop(0, "#f6ead2");
        g.addColorStop(1, "#f6ead200");
        ctx.fillStyle = g;
        ctx.fillRect(Math.min(start!, end!), b.y, edge, b.height);
      }
      const g = ctx.createLinearGradient(0, b.y, 0, b.y + 35);
      g.addColorStop(0, "#f6ead2");
      g.addColorStop(1, "#f6ead200");
      ctx.fillStyle = g;
      ctx.fillRect(b.x, b.y, b.width, 35);
    }
    ctx.restore();
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
