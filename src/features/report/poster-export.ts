import {
  resolveHistoricalPosterArtwork,
  type HistoricalPosterView,
} from "./historical-poster-view";

export const POSTER_WIDTH = 1080;
export const POSTER_HEIGHT = 1920;
export const POSTER_FONT_URL = "/assets/fonts/visual-v2-c/serif-600.woff2";
const CHARACTERS_URL = "/assets/fonts/visual-v2-c/characters.txt";
const FONT_FAMILY = "QuizForge Poster Serif";
const EDITION = "风骨映月 · 人物收藏";
const MARGIN = 90;
const TEXT_TOP = 1220;
const TEXT_BOTTOM = 1868;

export interface PosterTextBlock {
  readonly key: string;
  readonly lines: readonly string[];
  readonly size: number;
  readonly lineHeight: number;
  readonly top: number;
  readonly bottom: number;
}

type Measure = (text: string, size: number) => number;

/** Presentation-only limits; not a QuizPack schema or scoring validator. */
export function validatePosterExport(view: HistoricalPosterView): void {
  const text = (value: unknown, max: number) =>
    typeof value === "string" &&
    value.trim().length > 0 &&
    [...value].length <= max;
  if (
    !view ||
    view.kind !== "synthetic-preview" ||
    !text(view.fixtureId, 120) ||
    !text(view.identity?.name, 80) ||
    !text(view.identity?.title, 80) ||
    !text(view.identity?.era, 80) ||
    !text(view.brand, 80) ||
    !text(view.disclosure, 100) ||
    !view.disclosure.includes("合成") ||
    !view.disclosure.includes("娱乐性格测评") ||
    !["classical", "original"].includes(view.inscription?.kind) ||
    !text(view.inscription?.attribution, 80) ||
    !Array.isArray(view.inscription?.lines) ||
    view.inscription.lines.length !== 2 ||
    view.inscription.lines.some((line) => !text(line, 80)) ||
    !Array.isArray(view.tendencies) ||
    view.tendencies.length < 2 ||
    view.tendencies.length > 3
  )
    throw new Error("海报资料不完整或超过展示范围，无法生成。");
  const ids = new Set<string>();
  for (const item of view.tendencies) {
    if (
      !item ||
      !text(item.dimensionId, 80) ||
      !text(item.label, 24) ||
      !Number.isFinite(item.normalizedScore) ||
      item.normalizedScore < 0 ||
      item.normalizedScore > 100 ||
      ids.has(item.dimensionId)
    )
      throw new Error("海报性情倾向资料无效。");
    ids.add(item.dimensionId);
  }
  const registered = resolveHistoricalPosterArtwork(view.artwork?.assetId);
  if (registered.src !== view.artwork.src)
    throw new Error("人物画作地址与登记不一致，无法生成海报。");
}

function wrap(value: string, size: number, measure: Measure): string[] {
  const lines: string[] = [];
  let line = "";
  for (const char of value) {
    if (char === "\n") {
      if (line) lines.push(line);
      line = "";
      continue;
    }
    if (measure(char, size) > POSTER_WIDTH - MARGIN * 2)
      throw new Error("海报文字无法在画幅内排版。");
    const next = line + char;
    if (line && measure(next, size) > POSTER_WIDTH - MARGIN * 2) {
      lines.push(line);
      line = char;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

/** Exact values are retained. Text either fits in readable blocks or fails explicitly. */
export function layoutHistoricalPoster(
  view: HistoricalPosterView,
  measure: Measure,
): readonly PosterTextBlock[] {
  validatePosterExport(view);
  const content = [
    { key: "edition", lines: [EDITION], size: 26, min: 22 },
    { key: "name", lines: [view.identity.name], size: 104, min: 60 },
    {
      key: "title",
      lines: [`${view.identity.era} · ${view.identity.title}`],
      size: 38,
      min: 28,
    },
    { key: "poem", lines: view.inscription.lines, size: 44, min: 30 },
    {
      key: "attribution",
      lines: [view.inscription.attribution],
      size: 26,
      min: 20,
    },
    {
      key: "tendencies",
      lines: [
        view.tendencies
          .map((item) => `${item.label} ${item.normalizedScore}/100`)
          .join(" · "),
      ],
      size: 30,
      min: 24,
    },
    { key: "brand", lines: [view.brand], size: 26, min: 22 },
    { key: "disclosure", lines: [view.disclosure], size: 24, min: 20 },
  ];
  for (let step = 0; step <= 8; step++) {
    let y = TEXT_TOP;
    const blocks = content.map((item) => {
      const size = Math.max(
        item.min,
        Math.round(item.size * (1 - step * 0.05)),
      );
      const lines = item.lines.flatMap((line) => wrap(line, size, measure));
      const lineHeight = Math.ceil(size * (item.key === "name" ? 1.1 : 1.4));
      const block = {
        key: item.key,
        lines,
        size,
        lineHeight,
        top: y,
        bottom: y + lines.length * lineHeight,
      };
      y = block.bottom + (item.key === "name" ? 10 : 12);
      return block;
    });
    if (blocks.at(-1)!.bottom <= TEXT_BOTTOM) return blocks;
  }
  throw new Error("文字过长，无法在海报中完整呈现；请缩短展示文案后重试。");
}

export function posterRequiredText(view: HistoricalPosterView): string {
  return [
    EDITION,
    view.identity.name,
    view.identity.title,
    view.identity.era,
    ...view.inscription.lines,
    view.inscription.attribution,
    ...view.tendencies.map(
      (item) => `${item.label} ${item.normalizedScore}/100`,
    ),
    view.brand,
    view.disclosure,
    " · ",
  ].join("");
}

export function verifyPosterFontCoverage(
  view: HistoricalPosterView,
  characters: string,
): void {
  for (const char of posterRequiredText(view)) {
    if (!/\s/.test(char) && !characters.includes(char))
      throw new Error(`导出字体不包含“${char}”，请补齐受控字体后重试。`);
  }
}

async function deadline<T>(task: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), 10_000);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

let fontReady: Promise<string> | undefined;
async function loadPosterFont(): Promise<string> {
  if (!fontReady) {
    fontReady = deadline(
      (async () => {
        if (typeof FontFace === "undefined")
          throw new Error("浏览器不支持海报字体加载。");
        const [response, font] = await Promise.all([
          fetch(CHARACTERS_URL, { signal: AbortSignal.timeout(10_000) }),
          new FontFace(FONT_FAMILY, `url(${POSTER_FONT_URL})`, {
            weight: "600",
          }).load(),
        ]);
        if (!response.ok) throw new Error("字体字表不可用。");
        const characters = await response.text();
        document.fonts.add(font);
        return characters;
      })(),
      "海报字体加载超时，请重试。",
    ).catch(() => {
      fontReady = undefined;
      throw new Error("海报字体加载失败，请检查网络后重试。");
    });
  }
  return fontReady;
}

export async function renderHistoricalPoster(
  view: HistoricalPosterView,
): Promise<Blob> {
  validatePosterExport(view);
  const characters = await loadPosterFont();
  verifyPosterFontCoverage(view, characters);
  const image = new Image();
  image.src = view.artwork.src;
  try {
    await deadline(image.decode(), "人物画作加载超时。");
  } catch {
    image.src = "";
    throw new Error("人物画作加载失败，请检查网络后重试。");
  }
  if (!image.naturalWidth || !image.naturalHeight)
    throw new Error("人物画作尺寸无效。");
  const canvas = document.createElement("canvas");
  canvas.width = POSTER_WIDTH;
  canvas.height = POSTER_HEIGHT;
  try {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("浏览器无法创建海报画布。");
    const measure: Measure = (text, size) => {
      ctx.font = `600 ${size}px '${FONT_FAMILY}'`;
      return ctx.measureText(text).width;
    };
    const blocks = layoutHistoricalPoster(view, measure);
    ctx.fillStyle = "#101f2b";
    ctx.fillRect(0, 0, POSTER_WIDTH, POSTER_HEIGHT);
    // Whole registered artwork is retained: never crop a face or hand.
    const scale = Math.min(
      POSTER_WIDTH / image.naturalWidth,
      1620 / image.naturalHeight,
    );
    ctx.drawImage(
      image,
      (POSTER_WIDTH - image.naturalWidth * scale) / 2,
      0,
      image.naturalWidth * scale,
      image.naturalHeight * scale,
    );
    const gradient = ctx.createLinearGradient(0, 1040, 0, 1540);
    gradient.addColorStop(0, "rgba(16,31,43,0)");
    gradient.addColorStop(0.42, "rgba(16,31,43,.82)");
    gradient.addColorStop(1, "#101f2b");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 1040, POSTER_WIDTH, POSTER_HEIGHT - 1040);
    ctx.strokeStyle = "#b69a68";
    ctx.lineWidth = 2;
    ctx.strokeRect(35, 35, POSTER_WIDTH - 70, POSTER_HEIGHT - 70);
    ctx.textAlign = "center";
    ctx.textBaseline = "top";
    for (const block of blocks) {
      ctx.font = `600 ${block.size}px '${FONT_FAMILY}'`;
      ctx.fillStyle = ["name", "poem"].includes(block.key)
        ? "#fff1d3"
        : block.key === "disclosure"
          ? "#c4ced0"
          : "#e8c78d";
      block.lines.forEach((line, index) =>
        ctx.fillText(
          line,
          POSTER_WIDTH / 2,
          block.top + index * block.lineHeight,
        ),
      );
    }
    return await deadline(
      new Promise<Blob>((resolve, reject) => {
        canvas.toBlob(
          (blob) =>
            blob?.size && blob.type === "image/png"
              ? resolve(blob)
              : reject(new Error("PNG 编码失败，请重试。")),
          "image/png",
        );
      }),
      "PNG 编码超时，请重试。",
    );
  } finally {
    canvas.width = 0;
    canvas.height = 0;
  }
}
