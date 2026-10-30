import type { ComposedReportBodyV1 } from "@/lib/assessment-contract/composed-report-v1";
import {
  QIANZAI_EXPORT_LIMITS as L,
  QianzaiExportError,
  type QianzaiExportKind,
} from "./contracts";

export type TextMetrics = Readonly<{
  width: number;
  left: number;
  right: number;
  ascent: number;
  descent: number;
}>;
export type Measure = (text: string, size: number) => TextMetrics;
type Box = Readonly<{ x: number; y: number; width: number; height: number }>;
export type ExportOperation =
  | {
      kind: "text";
      text: string;
      size: number;
      x: number;
      y: number;
      color: string;
    }
  | {
      kind: "image";
      role: "portrait" | "nameArt";
      box: Box;
      fit: "cover" | "contain";
    }
  | { kind: "bar"; x: number; y: number; width: number; score: number }
  | { kind: "rule"; y: number }
  | {
      kind: "radar";
      x: number;
      y: number;
      radius: number;
      scores: readonly number[];
    }
  | { kind: "card"; box: Box; dark: boolean };
export type QianzaiExportLayout = Readonly<{
  width: number;
  height: number;
  operations: readonly ExportOperation[];
}>;

function matchingNotes(body: ComposedReportBodyV1): string[] {
  return [
    ...(body.matching.status === "single-candidate"
      ? ["本轮偏好下仅有一位候选人物。"]
      : body.matching.status === "near-tie"
        ? ["前两位人物接近，这是一种开放的文学类比。"]
        : []),
    ...(body.matching.selected.kind === "literary-legendary"
      ? [
          `${body.matching.selected.label}以文学／传说人物的艺术形象参与本轮匹配。`,
        ]
      : []),
  ];
}
function paragraphNote(
  paragraph: ComposedReportBodyV1["volumes"][number]["paragraphs"][number],
): string {
  return `${paragraph.status === "facts-only" ? "本轮事实" : paragraph.status === "fallback" ? "证据不足时的说明" : "有证据支持的限定描述"} · ${paragraph.kind === "literary" ? "文学类比" : "本轮情境"}`;
}

/** Exactly the strings the renderer may print. Metadata, IDs and private URLs are not drawn. */
export function qianzaiExportText(
  body: ComposedReportBodyV1,
  kind: QianzaiExportKind,
): readonly string[] {
  const opening = body.volumes.find((v) => v.id === "encounter")?.paragraphs[0];
  const shared = [
    "千载同心",
    body.title,
    body.matching.selected.label,
    "契合指数",
    String(body.matching.selected.narrativeIndex),
    "/ 100",
    "本轮五维",
    body.notice,
    ...matchingNotes(body),
    ...body.dimensions.flatMap((d) => [d.label, String(d.score)]),
  ];
  if (kind === "poster")
    return [
      ...shared,
      ...(opening ? [opening.text, paragraphNote(opening)] : []),
    ];
  return [
    ...shared,
    "选择依据",
    "反向证据",
    "第二候选：",
    ...(body.matching.runnerUp
      ? [
          body.matching.runnerUp.label,
          String(body.matching.runnerUp.narrativeIndex),
        ]
      : []),
    ...body.volumes.flatMap((v) => [
      v.title,
      ...v.paragraphs.flatMap((p) => [
        p.text,
        paragraphNote(p),
        ...[...p.evidence, ...p.counterevidence].flatMap((e) => [
          e.scope,
          e.prompt,
          e.optionText,
        ]),
      ]),
    ]),
  ];
}

export function layoutQianzaiExport(
  body: ComposedReportBodyV1,
  kind: QianzaiExportKind,
  measure: Measure,
  check: () => void = () => {},
): QianzaiExportLayout {
  const strings = qianzaiExportText(body, kind);
  if (
    body.dimensions.length !== 5 ||
    strings.reduce((n, s) => n + Array.from(s).length, 0) > L.maxTextCodepoints
  )
    throw new QianzaiExportError("CONTENT_LIMIT");
  const width = kind === "poster" ? L.posterWidth : L.reportWidth;
  const operations: ExportOperation[] = [];
  let highestInk = 0,
    ticks = 0;
  const bounds = (height: number) => {
    check();
    if (
      !Number.isFinite(height) ||
      height > L.maxHeight ||
      width * height > L.maxCanvasPixels
    )
      throw new QianzaiExportError("CONTENT_LIMIT");
  };
  const metrics = (text: string, size: number) => {
    if (++ticks % 128 === 0) check();
    const m = measure(text, size);
    if (
      ![m.width, m.left, m.right, m.ascent, m.descent].every(Number.isFinite) ||
      m.width < 0
    )
      throw new QianzaiExportError("CONTENT_LIMIT");
    return m;
  };
  const inkWidth = (text: string, size: number) => {
    const m = metrics(text, size);
    return Math.max(m.width, Math.max(0, m.left) + m.right);
  };
  const text = (
    value: string,
    size: number,
    x: number,
    top: number,
    maxWidth: number,
    lineHeight: number,
    maxBottom: number = L.maxHeight,
    color = "#263c4a",
  ) => {
    let y = top;
    const line = (s: string) => {
      const m = metrics(s, size),
        advance = Math.max(lineHeight, m.ascent + m.descent + 4);
      if (
        inkWidth(s, size) > maxWidth ||
        x < 0 ||
        x + maxWidth > width - 24 ||
        y + advance > maxBottom
      )
        throw new QianzaiExportError("CONTENT_LIMIT");
      bounds(y + advance);
      operations.push({
        kind: "text",
        text: s,
        size,
        x: x + Math.max(0, m.left),
        y: y + m.ascent,
        color,
      });
      highestInk = Math.max(highestInk, y + advance);
      y += advance;
    };
    for (const paragraph of value.split(/\r\n|\r|\n/)) {
      let current = "";
      for (const char of paragraph) {
        if (inkWidth(char, size) > maxWidth)
          throw new QianzaiExportError("CONTENT_LIMIT");
        if (current && inkWidth(current + char, size) > maxWidth) {
          line(current);
          current = "";
        }
        current += char;
      }
      line(current);
    }
    return y;
  };
  if (kind === "poster") {
    operations.push({
      kind: "image",
      role: "portrait",
      box: { x: 315, y: 65, width: 580, height: 675 },
      fit: "cover",
    });
    text("千载同心", 48, 48, 38, 340, 62, 110);
    text(body.matching.selected.label, 28, 58, 116, 250, 38, 158);
    operations.push({
      kind: "image",
      role: "nameArt",
      box: { x: 56, y: 175, width: 270, height: 365 },
      fit: "contain",
    });
    text("契合指数", 32, 70, 575, 260, 44, 625);
    text(
      String(body.matching.selected.narrativeIndex),
      96,
      70,
      633,
      320,
      112,
      750,
      "#9c692b",
    );
    text("/ 100", 28, 230, 740, 150, 38, 790, "#765e43");
    operations.push({ kind: "rule", y: 807 });
    let y = text(body.title, 30, 65, 830, 811, 44, 930);
    for (const note of matchingNotes(body))
      y = text(note, 22, 65, y + 8, 811, 30, 1076);
    const opening = body.volumes.find((v) => v.id === "encounter")
      ?.paragraphs[0];
    if (opening) {
      y = text(opening.text, 26, 65, y + 10, 811, 37, 1076);
      text(paragraphNote(opening), 20, 65, y + 6, 811, 28, 1076, "#705f4d");
    }
    text("本轮五维", 34, 65, 1090, 350, 48, 1140);
    operations.push({
      kind: "radar",
      x: 340,
      y: 1330,
      radius: 145,
      scores: body.dimensions.map((d) => d.score),
    });
    const labels = [
      [260, 1150],
      [550, 1270],
      [450, 1480],
      [140, 1480],
      [45, 1270],
    ];
    body.dimensions.forEach((d, i) => {
      const [x, top] = labels[i]!;
      const bottom = text(d.label, 25, x!, top!, 180, 34, top! + 70);
      text(String(d.score), 30, x!, bottom, 180, 39, top! + 112);
    });
    text(body.notice, 22, 48, 1580, 845, 30, 1648, "#705f4d");
    bounds(L.posterHeight);
    return { width, height: L.posterHeight, operations };
  }
  // Every actual report paragraph and evidence item is measured; raw answers are not a duplicate appendix.
  operations.push({
    kind: "image",
    role: "portrait",
    box: { x: 260, y: 30, width: 420, height: 420 },
    fit: "cover",
  });
  operations.push({
    kind: "image",
    role: "nameArt",
    box: { x: 42, y: 125, width: 210, height: 270 },
    fit: "contain",
  });
  text("千载同心", 36, 42, 40, 210, 50, 105);
  let y = text(body.matching.selected.label, 30, 42, 475, 640, 44) + 12;
  y = text(body.title, 28, 42, y, 640, 42) + 12;
  y =
    text(
      `契合指数 ${body.matching.selected.narrativeIndex} / 100`,
      26,
      42,
      y,
      640,
      38,
    ) + 10;
  for (const note of matchingNotes(body))
    y = text(note, 23, 42, y, 640, 36) + 10;
  if (body.matching.status !== "single-candidate" && body.matching.runnerUp)
    y =
      text(
        `第二候选：${body.matching.runnerUp.label} · 契合指数 ${body.matching.runnerUp.narrativeIndex} / 100`,
        24,
        42,
        y,
        640,
        36,
      ) + 10;
  y = text(body.notice, 21, 42, y, 640, 32) + 24;
  y = text("本轮五维", 30, 42, y, 640, 44) + 8;
  const radarTop = y;
  operations.push({
    kind: "radar",
    x: 362,
    y: radarTop + 205,
    radius: 135,
    scores: body.dimensions.map((d) => d.score),
  });
  const labels = [
    [290, 0],
    [505, 130],
    [450, 335],
    [120, 335],
    [42, 130],
  ];
  body.dimensions.forEach((d, i) => {
    const [x, top] = labels[i]!;
    const yy = text(d.label, 23, x!, radarTop + top!, 175, 34);
    text(String(d.score), 27, x!, yy, 175, 38);
  });
  y = Math.max(highestInk, radarTop + 430) + 24;
  for (const volume of body.volumes) {
    bounds(y + 60);
    operations.push({ kind: "rule", y });
    y = text(volume.title, 32, 42, y + 24, 640, 48) + 18;
    if (volume.id === "dimensions") {
      for (const d of body.dimensions) {
        y = text(`${d.label} ${d.score} / 100`, 25, 58, y, 608, 38) + 8;
        operations.push({ kind: "bar", x: 58, y, width: 608, score: d.score });
        y += 34;
      }
      y += 10;
    }
    if (volume.id === "literature") {
      operations.push({
        kind: "image",
        role: "portrait",
        box: { x: 42, y, width: 250, height: 250 },
        fit: "cover",
      });
      text(body.matching.selected.label, 36, 326, y + 48, 355, 54);
      y += 278;
    }
    for (const paragraph of volume.paragraphs) {
      const start = y,
        insertAt = operations.length;
      const framed =
        volume.id === "patterns" ||
        volume.id === "counterevidence" ||
        volume.id === "closure";
      const dark = volume.id === "counterevidence";
      y =
        text(
          paragraph.text,
          25,
          framed ? 66 : 48,
          y + (framed ? 22 : 0),
          framed ? 592 : 628,
          40,
          L.maxHeight,
          dark ? "#f8ead0" : "#263c4a",
        ) + 18;
      y =
        text(
          paragraphNote(paragraph),
          19,
          framed ? 66 : 48,
          y,
          framed ? 592 : 628,
          29,
          L.maxHeight,
          dark ? "#e3ccaa" : "#705f4d",
        ) + 14;
      if (framed) {
        operations.splice(insertAt, 0, {
          kind: "card",
          box: { x: 48, y: start, width: 628, height: y - start },
          dark,
        });
        y += 14;
      }
      for (const [title, evidence] of [
        ["选择依据", paragraph.evidence],
        ["反向证据", paragraph.counterevidence],
      ] as const) {
        if (!evidence.length) continue;
        y = text(title, 23, 58, y, 608, 36) + 6;
        for (const e of evidence) {
          const start = y,
            insertAt = operations.length;
          y = text(e.scope, 22, 70, y + 16, 584, 34) + 6;
          y = text(e.prompt, 22, 70, y, 584, 34) + 6;
          y = text(e.optionText, 22, 70, y, 584, 34) + 16;
          operations.splice(insertAt, 0, {
            kind: "card",
            box: { x: 58, y: start, width: 608, height: y - start },
            dark: false,
          });
          y += 12;
        }
      }
      y += 10;
    }
    y += 20;
  }
  operations.push({ kind: "rule", y });
  y = text(body.notice, 21, 42, y + 24, 640, 32) + 48;
  const height = Math.ceil(Math.max(y, highestInk + 48));
  bounds(height);
  return { width, height, operations };
}
