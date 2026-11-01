import type { ComposedReportBodyV1 } from "@/lib/assessment-contract/composed-report-v1";
import { qianzaiSnapshotDocument } from "./presentation";
import {
  QIANZAI_EDITORIAL_DEDICATION_LABEL,
  QIANZAI_EDITORIAL_SUMMARY_LABEL,
  QIANZAI_EDITORIAL_SUPPLEMENT_LABEL,
  QIANZAI_EDITORIAL_RECORD_LABEL,
  QIANZAI_EDITORIAL_FALLBACK_LABEL,
} from "./editorial";
import type { QianzaiResultPresentation } from "./result-presentation";
import { qianzaiPlainReportText } from "./inline-emphasis";
import {
  qianzaiDimensionScale,
  QIANZAI_SCALE_HEADING,
  QIANZAI_SCALE_MIDPOINT_LABEL,
  QIANZAI_SCALE_PREFACE,
  QIANZAI_SCALE_DISPLAY_NOTICE,
  type QianzaiScaleGeometry,
} from "./dimension-scale";
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
export type Measure = (
  text: string,
  size: number,
  style?: "brush",
) => TextMetrics;
type Box = Readonly<{ x: number; y: number; width: number; height: number }>;
export type ExportOperation =
  | {
      kind: "text";
      text: string;
      size: number;
      x: number;
      y: number;
      color: string;
      style?: "brush";
    }
  | {
      kind: "image";
      role: "portrait" | "nameArt";
      box: Box;
      fit: "cover" | "contain";
      blend?: boolean;
      ink?: string;
    }
  | {
      kind: "bar";
      x: number;
      y: number;
      width: number;
      score: number;
      scale?: QianzaiScaleGeometry;
    }
  | { kind: "rule"; y: number }
  | {
      kind: "radar";
      x: number;
      y: number;
      radius: number;
      scores: readonly number[];
    }
  | { kind: "card"; box: Box; dark: boolean }
  | { kind: "seal"; box: Box }
  | { kind: "ornament"; box: Box; style: "frame" | "tag" | "heading" };
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
  presentation?: QianzaiResultPresentation,
): readonly string[] {
  const doc = qianzaiSnapshotDocument(body, undefined, presentation);
  const opening = body.volumes.find((v) => v.id === "encounter")?.paragraphs[0];
  const shared = [
    "千载同心",
    body.title,
    body.matching.selected.label,
    "契合指数",
    String(body.matching.selected.narrativeIndex),
    "/ 100",
    "本轮五维",
    "五维心象",
    "%",
    body.notice,
    ...matchingNotes(body),
    ...body.dimensions.flatMap((d) => [d.label, String(d.score)]),
  ];
  if (kind === "poster")
    return [
      ...shared,
      ...(doc.resultPresentation
        ? [
            doc.name,
            doc.resultPresentation.poster.tagline,
            ...doc.resultPresentation.poster.lines,
            ...doc.resultPresentation.poster.tags,
            doc.resultPresentation.quote.text,
            doc.resultPresentation.quote.source,
          ]
        : opening
          ? [qianzaiPlainReportText(opening.text), paragraphNote(opening)]
          : []),
    ];
  const scales = body.dimensions.flatMap((d) => {
    const scale = qianzaiDimensionScale(
      d,
      body.provenance.canonicalContentSha256,
    );
    return scale ? [scale] : [];
  });
  return [
    ...shared,
    ...(scales.length
      ? [
          QIANZAI_SCALE_HEADING,
          QIANZAI_SCALE_MIDPOINT_LABEL,
          QIANZAI_SCALE_PREFACE,
          QIANZAI_SCALE_DISPLAY_NOTICE,
          ...scales.flatMap((scale) => [
            scale.left,
            scale.right,
            scale.positionLabel,
            scale.caption,
            scale.explanation,
          ]),
        ]
      : []),
    ...doc.sections.flatMap((s) =>
      s.editorial
        ? [
            s.editorial.intro,
            ...(s.editorial.dedication
              ? [QIANZAI_EDITORIAL_DEDICATION_LABEL, s.editorial.dedication]
              : []),
            ...(s.editorial.prompts ?? []).flatMap((p) => [p.title, p.text]),
            QIANZAI_EDITORIAL_RECORD_LABEL,
            QIANZAI_EDITORIAL_FALLBACK_LABEL,
            QIANZAI_EDITORIAL_SUPPLEMENT_LABEL,
            QIANZAI_EDITORIAL_SUMMARY_LABEL,
            ...s.blocks.flatMap((b) =>
              b.editorial
                ? [
                    b.editorial.label,
                    b.editorial.title,
                    ...(b.editorial.choiceSummary
                      ? [b.editorial.choiceSummary]
                      : []),
                  ]
                : [],
            ),
          ]
        : [],
    ),
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
        qianzaiPlainReportText(p.text),
        paragraphNote(p),
        ...[...p.evidence, ...p.counterevidence].flatMap((e) => [
          e.scope,
          e.prompt,
          e.optionText,
        ]),
      ]),
    ]),
    doc.name,
    doc.subtitle,
    ...(doc.identity?.honorific ? [doc.identity.honorific] : []),
    ...(doc.identity?.seal ?? []),
    ...(doc.identity?.tags ?? []),
    ...(doc.identity?.verse
      ? [doc.identity.verse.text, doc.identity.verse.source]
      : []),
    ...(doc.identity?.lifespan ? [doc.identity.lifespan] : []),
    ...(doc.identity?.courtesyName ? [doc.identity.courtesyName] : []),
    ...doc.sections.map((s) => s.title),
    ...(doc.history
      ? [
          doc.history.title,
          ...(doc.history.intro ? [doc.history.intro] : []),
          ...doc.history.timeline.flatMap((row) => [row.title, row.text]),
          doc.history.sourceNote,
        ]
      : []),
    ...(doc.resultPresentation
      ? [...doc.resultPresentation.closure.lines]
      : []),
  ];
}

/** Only decorative headings and the actual index use the existing fixed brush face. */
export function qianzaiExportBrushText(
  body: ComposedReportBodyV1,
  kind: QianzaiExportKind,
  presentation?: QianzaiResultPresentation,
): readonly string[] {
  const doc = qianzaiSnapshotDocument(body, undefined, presentation);
  return [
    "千载同心",
    "五维心象",
    String(body.matching.selected.narrativeIndex),
    ...(kind === "poster"
      ? []
      : doc.sections.map((s) =>
          s.id === "literature" && doc.history ? doc.history.title : s.title,
        )),
  ];
}

export function layoutQianzaiExport(
  body: ComposedReportBodyV1,
  kind: QianzaiExportKind,
  measure: Measure,
  check: () => void = () => {},
  options: Readonly<{
    annotation?: string;
    presentation?: QianzaiResultPresentation;
  }> = {},
): QianzaiExportLayout {
  const strings = [
    ...qianzaiExportText(body, kind, options.presentation),
    ...(options.annotation ? [options.annotation] : []),
  ];
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
  const metrics = (text: string, size: number, brush = false) => {
    if (++ticks % 128 === 0) check();
    const m = measure(text, size, brush ? "brush" : undefined);
    if (
      ![m.width, m.left, m.right, m.ascent, m.descent].every(Number.isFinite) ||
      m.width < 0
    )
      throw new QianzaiExportError("CONTENT_LIMIT");
    return m;
  };
  const inkWidth = (text: string, size: number, brush = false) => {
    const m = metrics(text, size, brush);
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
    color = "#211f1a",
    centered = false,
    brush = false,
  ) => {
    let y = top;
    const line = (s: string) => {
      const m = metrics(s, size, brush),
        advance = Math.max(lineHeight, m.ascent + m.descent + 4);
      if (
        inkWidth(s, size, brush) > maxWidth ||
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
        x:
          x +
          Math.max(0, m.left) +
          (centered ? (maxWidth - inkWidth(s, size, brush)) / 2 : 0),
        y: y + m.ascent,
        color,
        ...(brush ? { style: "brush" as const } : {}),
      });
      highestInk = Math.max(highestInk, y + advance);
      y += advance;
    };
    for (const paragraph of value.split(/\r\n|\r|\n/)) {
      let current = "";
      for (const char of paragraph) {
        if (inkWidth(char, size, brush) > maxWidth)
          throw new QianzaiExportError("CONTENT_LIMIT");
        if (current && inkWidth(current + char, size, brush) > maxWidth) {
          line(current);
          current = "";
        }
        current += char;
      }
      line(current);
    }
    return y;
  };
  const doc = qianzaiSnapshotDocument(body, undefined, options.presentation);
  const unit = width / L.posterWidth;
  const centered = (
    value: string,
    size: number,
    top: number,
    maxBottom: number = L.maxHeight,
    color = "#211f1a",
  ) =>
    text(
      value,
      size * unit,
      58 * unit,
      top,
      width - 116 * unit,
      size * unit * 1.45,
      maxBottom,
      color,
      true,
    );
  const ornament = (box: Box, style: "frame" | "tag" | "heading" = "frame") =>
    operations.push({ kind: "ornament", box, style });
  // Both artifacts share the prototype's complete landscape opening.
  operations.push({
    kind: "image",
    role: "portrait",
    box: { x: 255 * unit, y: 0, width: 686 * unit, height: 870 * unit },
    fit: "cover",
    blend: true,
  });
  text(
    "千载同心",
    62 * unit,
    58 * unit,
    48 * unit,
    400 * unit,
    78 * unit,
    L.maxHeight,
    "#211f1a",
    false,
    true,
  );
  operations.push({
    kind: "image",
    role: "nameArt",
    box: { x: 20 * unit, y: 160 * unit, width: 360 * unit, height: 405 * unit },
    fit: "contain",
    ink: "#111914",
  });
  const seal =
    doc.resultPresentation?.poster.tagline ?? doc.identity?.honorific;
  if (seal) {
    operations.push({
      kind: "seal",
      box: {
        x: 350 * unit,
        y: 435 * unit,
        width: 50 * unit,
        height: (Array.from(seal).length * 36 + 24) * unit,
      },
    });
    Array.from(seal).forEach((ch, i) =>
      text(
        ch,
        29 * unit,
        361 * unit,
        (448 + i * 36) * unit,
        32 * unit,
        36 * unit,
        L.maxHeight,
        "#fff5df",
      ),
    );
  }
  ornament({
    x: 48 * unit,
    y: 578 * unit,
    width: 305 * unit,
    height: 176 * unit,
  });
  text(
    "契合指数",
    34 * unit,
    91 * unit,
    590 * unit,
    220 * unit,
    44 * unit,
    L.maxHeight,
    "#171d18",
    true,
  );
  text(
    String(body.matching.selected.narrativeIndex),
    102 * unit,
    85 * unit,
    635 * unit,
    195 * unit,
    108 * unit,
    L.maxHeight,
    "#a5732d",
    true,
    true,
  );
  text(
    "%",
    49 * unit,
    270 * unit,
    684 * unit,
    65 * unit,
    58 * unit,
    L.maxHeight,
    "#a5732d",
  );
  let y = 792 * unit;
  if (doc.resultPresentation) {
    for (const line of doc.resultPresentation.poster.lines)
      y = centered(
        line,
        kind === "poster" ? 28 : 30,
        y,
        kind === "poster" ? 1055 : L.maxHeight,
      );
    y = centered(
      doc.resultPresentation.quote.text,
      22,
      y + 4 * unit,
      kind === "poster" ? 1080 : L.maxHeight,
    );
    y = centered(
      doc.resultPresentation.quote.source,
      18,
      y,
      kind === "poster" ? 1080 : L.maxHeight,
      "#705f4d",
    );
  } else {
    const opening = body.volumes.find((v) => v.id === "encounter")
      ?.paragraphs[0];
    if (opening && kind === "poster") {
      y = centered(
        qianzaiPlainReportText(opening.text),
        25,
        y,
        kind === "poster" ? 1035 : L.maxHeight,
      );
      y = centered(
        paragraphNote(opening),
        18,
        y,
        kind === "poster" ? 1080 : L.maxHeight,
        "#705f4d",
      );
    }
  }
  for (const note of matchingNotes(body))
    y = centered(
      note,
      17,
      y + 3 * unit,
      kind === "poster" ? 1080 : L.maxHeight,
      "#705f4d",
    );
  const headingY = kind === "poster" ? Math.max(1065, y + 10) : y + 26;
  operations.push({ kind: "rule", y: headingY });
  ornament(
    {
      x: 48 * unit,
      y: headingY + 13 * unit,
      width: 40 * unit,
      height: 40 * unit,
    },
    "heading",
  );
  text(
    "五维心象",
    44 * unit,
    100 * unit,
    headingY + 8 * unit,
    530 * unit,
    58 * unit,
    L.maxHeight,
    "#211f1a",
    false,
    true,
  );
  const radarTop = headingY + 50 * unit;
  const radarX = kind === "poster" ? 365 : width / 2;
  const radarY = radarTop + 140 * unit;
  operations.push({
    kind: "radar",
    x: radarX,
    y: radarY,
    radius: 139 * unit,
    scores: body.dimensions.map((d) => d.score),
  });
  const labelPositions = [
    [radarX - 58 * unit, radarTop - 5 * unit],
    [radarX + 180 * unit, radarY - 35 * unit],
    [radarX + 75 * unit, radarY + 105 * unit],
    [radarX - 195 * unit, radarY + 105 * unit],
    [radarX - 300 * unit, radarY - 35 * unit],
  ];
  body.dimensions.forEach((d, i) => {
    const [x, top] = labelPositions[i]!;
    let yy = text(
      d.label,
      21 * unit,
      x!,
      top!,
      130 * unit,
      28 * unit,
      L.maxHeight,
      "#1b2620",
      true,
    );
    yy = text(
      String(d.score),
      29 * unit,
      x!,
      yy,
      130 * unit,
      36 * unit,
      L.maxHeight,
      "#1b2620",
      true,
    );
    const scale = qianzaiDimensionScale(
      d,
      body.provenance.canonicalContentSha256,
    );
    if (scale && kind === "full-report")
      text(
        scale.positionLabel,
        15 * unit,
        x! - 7 * unit,
        yy,
        144 * unit,
        22 * unit,
        L.maxHeight,
        "#705f4d",
        true,
      );
  });
  y = Math.max(highestInk, radarY + 185 * unit) + 22 * unit;
  const tags = doc.resultPresentation?.poster.tags ?? doc.identity?.tags ?? [];
  if (tags.length) {
    const gap = 18 * unit,
      tagWidth = (width - 116 * unit - gap * (tags.length - 1)) / tags.length;
    tags.forEach((tag, i) => {
      const x = 58 * unit + i * (tagWidth + gap);
      ornament({ x, y, width: tagWidth, height: 50 * unit }, "tag");
      text(
        tag,
        24 * unit,
        x + 8 * unit,
        y + 9 * unit,
        tagWidth - 16 * unit,
        32 * unit,
        L.maxHeight,
        "#2b2a1d",
        true,
      );
    });
    y += 68 * unit;
  }
  if (kind === "poster") {
    // One fixed poster; oversized summaries fail rather than losing any text.
    y = text(
      body.notice,
      18,
      48,
      options.annotation ? 1550 : 1570,
      845,
      26,
      options.annotation ? 1620 : 1650,
      "#705f4d",
    );
    if (options.annotation)
      text(options.annotation, 17, 48, 1624, 845, 24, 1650, "#705f4d");
    bounds(L.posterHeight);
    return { width, height: L.posterHeight, operations };
  }
  // The full report continues naturally through every sealed paragraph and evidence.
  y = centered(doc.name, 30, y) + 4;
  y = centered(doc.subtitle, 25, y) + 12;
  if (doc.identity?.seal?.length)
    y = centered(doc.identity.seal.join(" · "), 20, y) + 8;
  if (doc.identity?.tags?.length)
    y = centered(doc.identity.tags.join(" · "), 20, y) + 8;
  if (body.matching.status !== "single-candidate" && body.matching.runnerUp)
    y =
      text(
        `第二候选：${body.matching.runnerUp.label} · 契合指数 ${body.matching.runnerUp.narrativeIndex} / 100`,
        22,
        48,
        y,
        628,
        34,
      ) + 12;
  y += 20;
  for (const volume of body.volumes) {
    bounds(y + 60);
    operations.push({ kind: "rule", y });
    ornament({ x: 42, y: y + 25, width: 30, height: 30 }, "heading");
    const section = doc.sections.find((s) => s.id === volume.id)!;
    y =
      text(
        volume.id === "literature" && doc.history
          ? doc.history.title
          : section.title,
        32,
        84,
        y + 24,
        598,
        48,
        L.maxHeight,
        "#211f1a",
        false,
        true,
      ) + 18;
    if (section.editorial)
      y = text(section.editorial.intro, 22, 48, y, 628, 33) + 12;
    if (volume.id === "dimensions") {
      const hasScales = body.dimensions.some(
        (d) =>
          qianzaiDimensionScale(d, body.provenance.canonicalContentSha256) !==
          null,
      );
      if (hasScales) {
        y = text(QIANZAI_SCALE_HEADING, 27, 58, y, 608, 40) + 4;
        y = text(QIANZAI_SCALE_MIDPOINT_LABEL, 21, 58, y, 608, 32) + 6;
        y = text(QIANZAI_SCALE_PREFACE, 23, 58, y, 608, 36) + 14;
      }
      for (const d of body.dimensions) {
        const scale = qianzaiDimensionScale(
          d,
          body.provenance.canonicalContentSha256,
        );
        if (!scale) {
          y = text(`${d.label} ${d.score} / 100`, 25, 58, y, 608, 38) + 8;
          operations.push({
            kind: "bar",
            x: 58,
            y,
            width: 608,
            score: d.score,
          });
          y += 34;
          continue;
        }
        y =
          text(
            `${scale.label} ${scale.score} / 100 · ${scale.positionLabel}`,
            25,
            58,
            y,
            608,
            38,
          ) + 8;
        const rightX = 666 - inkWidth(scale.right, 21);
        y =
          Math.max(
            text(scale.left, 21, 58, y, 286, 32),
            text(scale.right, 21, rightX, y, 666 - rightX, 32),
          ) + 10;
        operations.push({
          kind: "bar",
          x: 58,
          y,
          width: 608,
          score: scale.score,
          scale: scale.geometry,
        });
        y += 32;
        y = text(scale.caption, 23, 58, y, 608, 36) + 8;
        y = text(scale.explanation, 23, 58, y, 608, 36) + 18;
      }
      if (hasScales)
        y = text(QIANZAI_SCALE_DISPLAY_NOTICE, 21, 58, y, 608, 32) + 14;
      y += 10;
    }
    if (volume.id === "literature") {
      operations.push({
        kind: "image",
        role: "portrait",
        box: { x: 42, y, width: 250, height: 250 },
        fit: "cover",
      });
      text(doc.name, 36, 326, y + 48, 355, 54);
      y += 278;
      if (doc.identity?.lifespan)
        y = text(doc.identity.lifespan, 23, 42, y, 640, 36) + 8;
      if (doc.identity?.courtesyName)
        y = text(doc.identity.courtesyName, 23, 42, y, 640, 36) + 12;
      if (doc.history) {
        if (doc.history.intro)
          y = text(doc.history.intro, 24, 42, y, 640, 36) + 12;
        for (const row of doc.history.timeline) {
          y = text(row.title, 25, 58, y, 608, 38) + 6;
          y = text(row.text, 24, 58, y, 608, 38) + 18;
        }
        y = text(doc.history.sourceNote, 21, 42, y, 640, 32) + 18;
      }
    }
    if (volume.id === "closure" && doc.resultPresentation) {
      for (const line of doc.resultPresentation.closure.lines)
        y = text(line, 32, 58, y, 608, 48) + 4;
      y += 14;
    }
    for (const [paragraphIndex, paragraph] of volume.paragraphs.entries()) {
      const block = section.blocks[paragraphIndex]!;
      const editorial = section.editorial;
      const isFeature =
        editorial?.featureClaimId !== undefined &&
        editorial.featureClaimId === paragraph.claimRef?.id &&
        block.editorial?.kind === "reflection";
      const start = y,
        insertAt = operations.length;
      const framed = editorial
        ? block.editorial?.kind === "resonance" || isFeature
        : volume.id === "patterns" ||
          volume.id === "counterevidence" ||
          volume.id === "closure";
      const dark = editorial ? isFeature : volume.id === "counterevidence";
      const contentX = framed ? 66 : 48,
        contentWidth = framed ? 592 : 628;
      if (editorial) {
        if (isFeature && editorial.dedication) {
          y =
            text(
              QIANZAI_EDITORIAL_DEDICATION_LABEL,
              19,
              contentX,
              y + 14,
              contentWidth,
              29,
              L.maxHeight,
              "#dfc59a",
            ) + 3;
          y =
            text(
              editorial.dedication,
              28,
              contentX,
              y,
              contentWidth,
              40,
              L.maxHeight,
              "#f6dfb4",
            ) + 12;
        }
        if (block.editorial) {
          if (block.editorial.kind === "reflection" && !isFeature) {
            y =
              text(
                `${QIANZAI_EDITORIAL_SUPPLEMENT_LABEL} · ${block.editorial.title}`,
                22,
                contentX,
                y,
                contentWidth,
                33,
              ) + 7;
          } else {
            y =
              text(
                block.editorial.label,
                20,
                contentX,
                y + (framed && !isFeature ? 12 : 0),
                contentWidth,
                30,
                L.maxHeight,
                dark ? "#966728" : "#886940",
              ) + 3;
            y =
              text(
                block.editorial.title,
                26,
                contentX,
                y,
                contentWidth,
                38,
                L.maxHeight,
                dark ? "#63461f" : "#272820",
              ) + 7;
          }
          if (block.editorial.choiceSummary)
            y =
              text(
                `${QIANZAI_EDITORIAL_SUMMARY_LABEL}：${block.editorial.choiceSummary}`,
                23,
                contentX,
                y,
                contentWidth,
                34,
              ) + 10;
        } else if (paragraph.status !== "accepted") {
          y =
            text(
              paragraph.status === "fallback"
                ? QIANZAI_EDITORIAL_FALLBACK_LABEL
                : QIANZAI_EDITORIAL_RECORD_LABEL,
              24,
              contentX,
              y,
              contentWidth,
              36,
            ) + 6;
        }
      }
      y =
        text(
          qianzaiPlainReportText(paragraph.text),
          25,
          framed ? 66 : 48,
          y + (framed && !editorial ? 22 : 0),
          framed ? 592 : 628,
          editorial ? 38 : 40,
          L.maxHeight,
          "#292c24",
        ) + (editorial ? 10 : 18);
      y =
        text(
          paragraphNote(paragraph),
          19,
          framed ? 66 : 48,
          y,
          framed ? 592 : 628,
          29,
          L.maxHeight,
          "#705f4d",
        ) + (editorial ? 7 : 14);
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
          y =
            text(e.scope, 22, 70, y + (editorial ? 7 : 16), 584, 34) +
            (editorial ? 3 : 6);
          y = text(e.prompt, 22, 70, y, 584, 34) + (editorial ? 3 : 6);
          y = text(e.optionText, 22, 70, y, 584, 34) + (editorial ? 7 : 16);
          operations.splice(insertAt, 0, {
            kind: "card",
            box: { x: 58, y: start, width: 608, height: y - start },
            dark: false,
          });
          y += editorial ? 7 : 12;
        }
      }
      y += 10;
    }
    for (const prompt of section.editorial?.prompts ?? []) {
      const start = y,
        insertAt = operations.length;
      y = text(prompt.title, 24, 66, y + 12, 592, 36) + 4;
      y = text(prompt.text, 23, 66, y, 592, 35) + 12;
      operations.splice(insertAt, 0, {
        kind: "card",
        box: { x: 48, y: start, width: 628, height: y - start },
        dark: false,
      });
      y += 10;
    }
    y += 20;
  }
  operations.push({ kind: "rule", y });
  y = text(body.notice, 21, 42, y + 24, 640, 32);
  y = options.annotation
    ? text(options.annotation, 18, 42, y + 16, 640, 28) + 32
    : y + 48;
  const height = Math.ceil(Math.max(y, highestInk + 48));
  bounds(height);
  return { width, height, operations };
}
