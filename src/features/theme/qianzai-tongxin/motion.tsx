"use client";

import { useEffect, useRef, useSyncExternalStore } from "react";

const subscribe = (notify: () => void) => {
  const media = window.matchMedia("(prefers-reduced-motion: reduce)");
  media.addEventListener("change", notify);
  document.addEventListener("visibilitychange", notify);
  return () => {
    media.removeEventListener("change", notify);
    document.removeEventListener("visibilitychange", notify);
  };
};
const motionAllowed = () =>
  !document.hidden &&
  !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
export function useQianzaiMotion(active = true) {
  return useSyncExternalStore(subscribe, motionAllowed, () => false) && active;
}

/** V8's localized original-water displacement. It never paints over upper
 * typography/figure/buildings or changes the supplied image bytes. No export.
 */
export function QianzaiWater({
  src,
  active,
}: {
  src: string | undefined;
  active: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const previousSource = useRef<string | undefined>(undefined);
  const clock = useRef(0);
  const running = useQianzaiMotion(active);
  useEffect(() => {
    const node = canvas.current;
    const ctx = node?.getContext("2d");
    if (!node || !ctx) return;
    if (previousSource.current !== src) {
      ctx.clearRect(0, 0, node.width, node.height);
      previousSource.current = src;
      clock.current = 0;
    }
    if (!src || !running) return;
    const image = new Image(),
      scratch = document.createElement("canvas");
    const source = scratch.getContext("2d");
    if (!source) return;
    let frame = 0,
      disposed = false,
      ready = false,
      w = 0,
      h = 0,
      last = 0,
      elapsed = clock.current,
      lastWater = 0;
    let glints: {
      x: number;
      y: number;
      width: number;
      phase: number;
      alpha: number;
      period: number;
    }[] = [];
    const resize = () => {
      const rect = node.getBoundingClientRect(),
        dpr = Math.min(devicePixelRatio || 1, 2);
      w = rect.width;
      h = rect.height;
      node.width = Math.round(w * dpr);
      node.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      scratch.width = Math.ceil(w);
      scratch.height = Math.ceil(h);
      if (!ready || !w || !h) return;
      const scale = Math.max(w / image.naturalWidth, h / image.naturalHeight);
      const cw = w / scale,
        ch = h / scale,
        stretch = window.matchMedia("(max-width: 360px)").matches;
      source.drawImage(
        image,
        stretch ? 0 : (image.naturalWidth - cw) / 2,
        stretch ? 0 : (image.naturalHeight - ch) / 2,
        stretch ? image.naturalWidth : cw,
        stretch ? image.naturalHeight : ch,
        0,
        0,
        w,
        h,
      );
      const random = seeded(),
        r = (a: number, b: number) => a + random() * (b - a);
      // V8 initializes 22 petals and 9 gold motes before its reflection glints.
      for (let i = 0; i < 335; i++) random();
      glints = Array.from({ length: 75 }, () => {
        const y = r(0.785, 0.968) * h,
          depth = (y / h - 0.785) / 0.183,
          span = depth * 0.2 + 0.08;
        return {
          x: (0.5 + r(-span, span)) * w,
          y,
          width: r(4, 30) * (0.65 + depth),
          phase: r(0, 6.28),
          alpha: r(0.16, 0.35),
          period: r(1300, 3300),
        };
      });
    };
    const draw = (now: number) => {
      if (disposed) return;
      elapsed += Math.min(40, last ? now - last : 16);
      clock.current = elapsed;
      last = now;
      if (ready && now - lastWater > 41) {
        ctx.clearRect(0, 0, w, h);
        for (let y = Math.round(0.765 * h); y < h; y += 3) {
          const amp =
            (0.35 + 0.65 * Math.min(1, (y / h - 0.765) / 0.205)) * 2.2;
          const shift =
            amp *
            (Math.sin(y * 0.043 + elapsed * 0.00195) +
              0.4 * Math.sin(y * 0.092 - elapsed * 0.0023));
          ctx.drawImage(
            scratch,
            0,
            y,
            w,
            Math.min(4, h - y),
            shift,
            y,
            w,
            Math.min(4, h - y),
          );
        }
        // Sparse highlights follow the lower central reflection, not full-width stripes.
        ctx.globalCompositeOperation = "screen";
        for (const g of glints) {
          const light = Math.pow(
            Math.max(0, Math.sin((elapsed / g.period) * Math.PI * 2 + g.phase)),
            2,
          );
          const alpha = g.alpha * (0.24 + 0.69 * light) * 0.88;
          if (alpha < 0.07) continue;
          ctx.fillStyle = `rgba(255,199,111,${Math.min(0.55, alpha)})`;
          ctx.beginPath();
          ctx.ellipse(
            g.x + Math.sin(elapsed / 1730 + g.phase) * 2.2,
            g.y,
            g.width * (0.68 + 0.25 * light),
            0.65 + 0.36 * light,
            Math.sin(g.phase) * 0.04,
            0,
            Math.PI * 2,
          );
          ctx.fill();
        }
        ctx.globalCompositeOperation = "source-over";
        node.dataset.waterFrames = String(
          Number(node.dataset.waterFrames ?? 0) + 1,
        );
        lastWater = now;
      }
      frame = requestAnimationFrame(draw);
    };
    image.onload = () => {
      if (!disposed) {
        ready = true;
        resize();
        frame = requestAnimationFrame(draw);
      }
    };
    image.onerror = () => {
      ready = false;
    };
    image.src = src;
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => {
      disposed = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      image.onload = null;
      image.onerror = null;
    };
  }, [src, running]);
  return <canvas ref={canvas} data-qianzai-water aria-hidden="true" />;
}

function seeded() {
  let seed = 971943;
  return () => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}
type Petal = {
  x: number;
  y: number;
  size: number;
  alpha: number;
  vy: number;
  vx: number;
  angle: number;
  spin: number;
  flutter: number;
  flutterSpeed: number;
  phase: number;
  sway: number;
  tone: number;
  blur: number;
};
type Gold = {
  x: number;
  y: number;
  size: number;
  phase: number;
  alpha: number;
};
function petalSprite(palette: readonly string[]) {
  const canvas = document.createElement("canvas");
  canvas.width = 84;
  canvas.height = 106;
  const ctx = canvas.getContext("2d");
  if (!ctx) return canvas;
  ctx.translate(42, 54);
  ctx.rotate(-0.18);
  ctx.shadowColor = "rgba(142,51,80,.1)";
  ctx.shadowBlur = 2;
  ctx.shadowOffsetY = 1;
  ctx.beginPath();
  ctx.moveTo(-2, -42);
  ctx.bezierCurveTo(24, -44, 37, -14, 31, 9);
  ctx.bezierCurveTo(29, 31, 8, 45, -7, 44);
  ctx.bezierCurveTo(-25, 36, -31, 12, -21, -8);
  ctx.bezierCurveTo(-14, -24, -8, -36, -2, -42);
  ctx.closePath();
  const gradient = ctx.createLinearGradient(-25, -38, 26, 43);
  [0, 0.41, 0.86, 1].forEach((stop, i) =>
    gradient.addColorStop(stop, palette[i]!),
  );
  ctx.fillStyle = gradient;
  ctx.fill();
  ctx.shadowBlur = 0;
  ctx.shadowOffsetY = 0;
  ctx.strokeStyle = "rgba(146,66,76,.14)";
  ctx.lineWidth = 1.1;
  ctx.beginPath();
  ctx.moveTo(-2, -35);
  ctx.bezierCurveTo(6, -7, 8, 12, -3, 39);
  ctx.stroke();
  ctx.strokeStyle = "rgba(255,251,233,.34)";
  ctx.lineWidth = 0.85;
  ctx.beginPath();
  ctx.moveTo(-5, -31);
  ctx.quadraticCurveTo(-14, 4, -8, 29);
  ctx.stroke();
  return canvas;
}
/** Original V8 seeded three-depth petals and gold motes, rendered as application
 * components. Pausing/visibility suspends RAF; no private bitmap is generated.
 */
export function QianzaiPetals({ active }: { active: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null),
    running = useQianzaiMotion(active);
  const memory = useRef<{
    w: number;
    h: number;
    petals: Petal[];
    gold: Gold[];
    elapsed: number;
    random: () => number;
  } | null>(null);
  useEffect(() => {
    const node = canvas.current,
      ctx = node?.getContext("2d");
    if (!node || !ctx || !running) return;
    let frame = 0,
      last = 0;
    const sprites = [
      ["#ffe2d7", "#ffadb2", "#f17691", "#d3517d"],
      ["#ffe5df", "#ffb5ba", "#ef829d", "#c75581"],
      ["#ffd7d9", "#fca6b7", "#ed88a6", "#cd698e"],
      ["#ffdbcf", "#fca7aa", "#ec788a", "#ce556d"],
    ].map(petalSprite);
    const resize = () => {
      const rect = node.getBoundingClientRect(),
        w = rect.width,
        h = rect.height,
        dpr = Math.min(devicePixelRatio || 1, 2);
      if (!w || !h) return;
      node.width = Math.round(w * dpr);
      node.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (memory.current?.w === w && memory.current.h === h) return;
      const random = seeded(),
        r = (a: number, b: number) => a + random() * (b - a);
      const petals: Petal[] = [];
      for (let i = 0; i < 22; i++) {
        const layer = i < 4 ? 0 : i < 17 ? 1 : 2,
          size = layer === 0 ? r(12, 19) : layer === 1 ? r(7, 13) : r(3.5, 7.5);
        petals.push({
          x: r(-0.08, 1.07) * w,
          y: r(-0.4, 1) * h,
          size,
          alpha: layer === 2 ? r(0.47, 0.67) : r(0.61, 0.82),
          vy:
            layer === 0
              ? r(0.35, 0.58)
              : layer === 1
                ? r(0.48, 0.95)
                : r(0.28, 0.59),
          vx: layer === 0 ? r(-0.24, 0.28) : r(-0.18, 0.32),
          angle: r(-Math.PI, Math.PI),
          spin: r(-0.015, 0.015),
          flutter: r(0, 6.28),
          flutterSpeed: r(0.013, 0.041),
          phase: r(0, 6.28),
          sway: r(6, 25),
          tone: Math.floor(r(0, 4)),
          blur: layer === 0 ? r(0.35, 0.95) : 0,
        });
      }
      const gold = Array.from({ length: 9 }, () => ({
        x: r(0.05, 0.93) * w,
        y: r(0.01, 0.85) * h,
        size: r(0.55, 1.45),
        phase: r(0, 6.28),
        alpha: r(0.18, 0.36),
      }));
      memory.current = { w, h, petals, gold, elapsed: 0, random };
    };
    const draw = (now: number) => {
      const m = memory.current;
      if (m) {
        const dt = Math.min(40, last ? now - last : 16);
        last = now;
        m.elapsed += dt;
        const r = (a: number, b: number) => a + m.random() * (b - a),
          t = m.elapsed,
          speed = dt / 16.67;
        ctx.clearRect(0, 0, m.w, m.h);
        for (const p of m.petals) {
          p.y += p.vy * speed;
          p.x += (p.vx + Math.sin(t / 1550 + p.phase) * 0.11) * speed;
          p.flutter += p.flutterSpeed * speed;
          p.angle += p.spin * speed;
          if (p.y > m.h + p.size * 3) {
            p.y = -p.size * 3;
            p.x = r(-20, m.w + 20);
          }
          if (p.x > m.w + p.size * 3) p.x = -p.size * 3;
          if (p.x < -p.size * 3) p.x = m.w + p.size * 3;
          const text =
            p.x > 0.12 * m.w &&
            p.x < 0.91 * m.w &&
            p.y > 0.36 * m.h &&
            p.y < 0.65 * m.h;
          ctx.save();
          ctx.globalCompositeOperation = "screen";
          ctx.translate(p.x + Math.sin(t / 700 + p.phase) * p.sway * 0.1, p.y);
          ctx.rotate(p.angle);
          ctx.scale(
            0.18 + 0.82 * Math.abs(Math.cos(p.flutter)),
            0.89 + 0.11 * Math.sin(p.flutter * 1.27),
          );
          ctx.globalAlpha = p.alpha * (text ? 0.55 : 1);
          if (p.blur > 0.6) ctx.filter = "blur(.65px)";
          ctx.drawImage(
            sprites[p.tone]!,
            -p.size * 0.9,
            -p.size * 1.15,
            p.size * 1.8,
            p.size * 2.3,
          );
          ctx.restore();
        }
        for (const g of m.gold) {
          ctx.fillStyle = `rgba(255,226,160,${g.alpha * (0.55 + 0.45 * Math.sin(t / 890 + g.phase))})`;
          ctx.beginPath();
          ctx.arc(g.x, g.y, g.size, 0, Math.PI * 2);
          ctx.fill();
        }
        node.dataset.petalFrames = String(
          Number(node.dataset.petalFrames ?? 0) + 1,
        );
      }
      frame = requestAnimationFrame(draw);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    frame = requestAnimationFrame(draw);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [running]);
  return <canvas ref={canvas} data-qianzai-petals aria-hidden="true" />;
}
