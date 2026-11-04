import type { ComposedReportBodyV1 } from "@/lib/assessment-contract/composed-report-v1";
import {
  qianzaiSnapshotDocument,
  type QianzaiSnapshotDocument,
} from "@/features/report/qianzai-tongxin/historical-v13/presentation";
import {
  QIANZAI_EDITORIAL_DEDICATION_LABEL,
  QIANZAI_EDITORIAL_SUMMARY_LABEL,
  QIANZAI_EDITORIAL_SUPPLEMENT_LABEL,
  QIANZAI_EDITORIAL_RECORD_LABEL,
  QIANZAI_EDITORIAL_FALLBACK_LABEL,
} from "@/features/report/qianzai-tongxin/historical-v13/editorial";
import type { QianzaiResultPresentation } from "@/features/report/qianzai-tongxin/historical-v13/result-presentation";
import { qianzaiPlainReportText } from "@/features/report/qianzai-tongxin/historical-v13/inline-emphasis";
import {
  qianzaiDimensionScale,
  QIANZAI_SCALE_HEADING,
  QIANZAI_SCALE_MIDPOINT_LABEL,
  QIANZAI_SCALE_PREFACE,
  QIANZAI_SCALE_DISPLAY_NOTICE,
  type QianzaiScaleGeometry,
} from "@/features/report/qianzai-tongxin/historical-v13/dimension-scale";
import {
  QIANZAI_EXPORT_LIMITS as L,
  QianzaiExportError,
  type QianzaiExportKind,
} from "@/features/report/qianzai-tongxin/historical-v13/contracts";

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
  style?: "brush" | "number",
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
      style?: "brush" | "number";
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
      /** 07 prototype geometry, scaled from its 390px design width. */
      prototypeScale?: number;
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
  if (isConsumerEdition(doc)) return consumerPrintText(doc, kind);
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
  if (isConsumerEdition(doc))
    return [
      "千载同心",
      String(body.matching.selected.narrativeIndex),
      "%",
      "五维心象",
      ...doc.sections.filter((s) => s.id !== "encounter").map((s) => s.title),
      ...(kind === "full-report"
        ? [
            doc.name,
            ...doc.sections.flatMap((s) =>
              s.blocks.flatMap((b) => [
                ...(b.title ? [b.title] : []),
                ...(b.layout === "final-verse" ? [b.text] : []),
              ]),
            ),
          ]
        : []),
    ].map((value) => value.replaceAll("·", ""));
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
  const consumerDoc = qianzaiSnapshotDocument(
    body,
    undefined,
    options.presentation,
  );
  if (isConsumerEdition(consumerDoc))
    return consumerLayout(
      consumerDoc,
      kind,
      measure,
      check,
      options.annotation,
    );
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
              "#79501f",
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
              "#49351e",
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

/** The consumer document is admitted only by the existing verified derived branch. */
function isConsumerEdition(doc: QianzaiSnapshotDocument): boolean {
  return "consumerEdition" in doc && doc.consumerEdition === true;
}
function consumerPrintText(
  doc: QianzaiSnapshotDocument,
  kind: QianzaiExportKind,
): readonly string[] {
  const p = doc.resultPresentation;
  return [
    "千载同心",
    "契合指数",
    String(doc.body.matching.selected.narrativeIndex),
    "%",
    "五维心象",
    doc.legal,
    ...doc.dimensions.flatMap((d) => [d.label, String(d.score)]),
    ...doc.dimensions.flatMap((d) => {
      const scale = qianzaiDimensionScale(
        d,
        doc.body.provenance.canonicalContentSha256,
      );
      return scale ? [scale.left, scale.right, scale.positionLabel] : [];
    }),
    ...(p ? [p.poster.tagline, ...p.poster.tags, ...p.poster.lines] : []),
    ...(kind === "full-report"
      ? [
          doc.name,
          ...(doc.identity?.honorific ? [doc.identity.honorific] : []),
          ...(p ? [p.role.tags.join(" · ")] : []),
          ...doc.dimensions.map((d) => `${d.label} ${d.score}`),
          ...doc.sections.flatMap((s) => [
            s.title,
            ...(s.intro ? [s.intro] : []),
            ...s.blocks.flatMap((b) => [
              b.text,
              ...(b.title ? [b.title] : []),
              ...(b.citation ? [b.citation] : []),
            ]),
          ]),
          ...doc.dimensions.flatMap((d) => {
            const scale = qianzaiDimensionScale(
              d,
              doc.body.provenance.canonicalContentSha256,
            );
            return scale ? [scale.left, scale.right, scale.positionLabel] : [];
          }),
        ]
      : []),
  ];
}

/** Prototype coordinates are measured from the 941x1672 poster and 724px-wide long reference.
 * Copy stays in the shared consumer doc; no raw answer or evidence fields are printed here. */
function consumerLayout(
  doc: QianzaiSnapshotDocument,
  kind: QianzaiExportKind,
  measure: Measure,
  check: () => void,
  annotation?: string,
): QianzaiExportLayout {
  const width = kind === "poster" ? L.posterWidth : L.reportWidth,
    ops: ExportOperation[] = [];
  let highest = 0,
    ticks = 0;
  const bound = (height: number) => {
    check();
    if (
      !Number.isFinite(height) ||
      height > L.maxHeight ||
      width * height > L.maxCanvasPixels
    )
      throw new QianzaiExportError("CONTENT_LIMIT");
  };
  const runs = (s: string, brush: boolean | "number") =>
    brush === true
      ? s
          .split(/(·)/)
          .filter(Boolean)
          .map((text) => ({ text, brush: text !== "·" }))
      : [{ text: s, brush }];
  const metric = (
    s: string,
    size: number,
    brush: boolean | "number" = false,
  ): TextMetrics => {
    if (++ticks % 128 === 0) check();
    if (brush === true && s.includes("·")) {
      const parts = runs(s, true).map((run) =>
          metric(run.text, size, run.brush),
        ),
        last = parts.at(-1)!;
      const width = parts.reduce((n, m) => n + m.width, 0);
      return {
        width,
        left: parts[0]!.left,
        right: width - last.width + last.right,
        ascent: Math.max(...parts.map((m) => m.ascent)),
        descent: Math.max(...parts.map((m) => m.descent)),
      };
    }
    const m = measure(
      s,
      size,
      brush === true ? "brush" : brush === "number" ? "number" : undefined,
    );
    if (
      ![m.width, m.left, m.right, m.ascent, m.descent].every(Number.isFinite) ||
      m.width < 0
    )
      throw new QianzaiExportError("CONTENT_LIMIT");
    return m;
  };
  const ink = (s: string, size: number, brush: boolean | "number" = false) => {
    const m = metric(s, size, brush);
    return Math.max(m.width, Math.max(0, m.left) + m.right);
  };
  const write = (
    value: string,
    size: number,
    x: number,
    top: number,
    w: number,
    lineHeight: number,
    brush: boolean | "number" = false,
    center = false,
    color = "#22251c",
  ) => {
    let y = top;
    const line = (s: string) => {
      const m = metric(s, size, brush),
        h = Math.max(lineHeight, m.ascent + m.descent + 3);
      if (x < 0 || x + w > width - 20 || ink(s, size, brush) > w)
        throw new QianzaiExportError("CONTENT_LIMIT");
      bound(y + h);
      let advance = 0;
      for (const run of runs(s, brush)) {
        ops.push({
          kind: "text",
          text: run.text,
          size,
          x:
            x +
            Math.max(0, m.left) +
            (center ? (w - ink(s, size, brush)) / 2 : 0) +
            advance,
          y: y + m.ascent,
          color,
          ...(run.brush
            ? {
                style:
                  run.brush === true ? ("brush" as const) : ("number" as const),
              }
            : {}),
        });
        advance += metric(run.text, size, run.brush).width;
      }
      y += h;
      highest = Math.max(highest, y);
    };
    for (const paragraph of qianzaiPlainReportText(value).split(/\r\n|\r|\n/)) {
      let row = "";
      const chars = Array.from(paragraph);
      for (const [i, ch] of chars.entries()) {
        if (ink(ch, size, brush) > w)
          throw new QianzaiExportError("CONTENT_LIMIT");
        const next = chars[i + 1] ?? "";
        // Keep a closing mark with the preceding character and an opening mark
        // with the following one; every original character is still printed.
        let suffix = "";
        if (/^[，。！？、；：）》」』】〕〉]$/.test(next)) {
          for (
            let j = i + 1;
            j < chars.length &&
            /^[，。！？、；：）》」』】〕〉]$/.test(chars[j]!);
            j++
          )
            suffix += chars[j]!;
        } else if (/^[（《「『【〔〈]$/.test(ch)) suffix = next;
        if (row && ink(row + ch + suffix, size, brush) > w) {
          line(row);
          row = "";
        }
        row += ch;
      }
      line(row);
    }
    return y;
  };
  const frame = (
    x: number,
    y: number,
    w: number,
    h: number,
    style: "frame" | "tag" = "frame",
  ) =>
    ops.push({ kind: "ornament", box: { x, y, width: w, height: h }, style });
  const heading = (title: string, y: number) => {
    ops.push({ kind: "rule", y });
    ops.push({
      kind: "ornament",
      box: { x: 42, y: y + 19, width: 30, height: 30 },
      style: "heading",
    });
    return write(title, 36, 85, y + 10, width - 130, 49, true) + 13;
  };
  const p = doc.resultPresentation;
  if (!p) throw new QianzaiExportError("CAPABILITY_UNAVAILABLE");
  const poster = kind === "poster";
  // The shorter long-report opening is independently measured, not the tall poster scaled wholesale.
  const hero = poster
    ? { x: 295, y: 60, width: 646, height: 810 }
    : { x: 220, y: 0, width: 504, height: 445 };
  ops.push({
    kind: "image",
    role: "portrait",
    box: hero,
    fit: "cover",
    blend: true,
  });
  write(
    "千载同心",
    poster ? 64 : 47,
    poster ? 60 : 44,
    poster ? 57 : 36,
    poster ? 320 : 280,
    poster ? 76 : 58,
    true,
  );
  ops.push({
    kind: "image",
    role: "nameArt",
    box: poster
      ? { x: 21, y: 160, width: 328, height: 393 }
      : { x: 16, y: 91, width: 246, height: 228 },
    fit: "contain",
    ink: "#101610",
  });
  const seal = p.poster.tagline,
    sealX = poster ? 346 : 267,
    sealY = poster ? 421 : 232,
    sealW = poster ? 50 : 35,
    sealStep = poster ? 37 : 25;
  ops.push({
    kind: "seal",
    box: {
      x: sealX,
      y: sealY,
      width: sealW,
      height: Array.from(seal).length * sealStep + (poster ? 28 : 17),
    },
  });
  Array.from(seal).forEach((ch, i) =>
    write(
      ch,
      poster ? 30 : 21,
      sealX + 7,
      sealY + 11 + i * sealStep,
      sealW - 12,
      sealStep,
      false,
      true,
      "#fff2d2",
    ),
  );
  const index = poster
    ? { x: 43, y: 577, width: 325, height: 191 }
    : { x: 58, y: 302, width: 202, height: 111 };
  frame(index.x, index.y, index.width, index.height);
  write(
    "契合指数",
    poster ? 34 : 22,
    index.x + 13,
    index.y + 12,
    index.width - 26,
    poster ? 43 : 29,
    false,
    true,
  );
  const value = String(doc.body.matching.selected.narrativeIndex),
    sample = metric(value, 100, true),
    target = poster
      ? { x: 83, y: 633, width: 206, height: 119 }
      : { x: 80, y: 339, width: 127, height: 65 };
  const numberSize = Math.min(
    (target.width / Math.max(sample.width, sample.left + sample.right)) * 100,
    (target.height / Math.max(1, sample.ascent + sample.descent)) * 100,
  );
  const numberMetric = metric(value, numberSize, true);
  bound(target.y + target.height);
  ops.push({
    kind: "text",
    text: value,
    size: numberSize,
    x:
      target.x +
      (target.width - ink(value, numberSize, true)) / 2 +
      Math.max(0, numberMetric.left),
    y: target.y + numberMetric.ascent,
    color: "#a06d28",
    style: "brush",
  });
  write(
    "%",
    poster ? 66 : 40,
    poster ? 273 : 200,
    poster ? 687 : 366,
    poster ? 70 : 43,
    poster ? 70 : 43,
    true,
    false,
    "#a06d28",
  );
  const center = (s: string, size: number, y: number) =>
    write(
      s,
      size,
      poster ? 56 : 52,
      y,
      width - (poster ? 112 : 104),
      size * 1.42,
      false,
      true,
    );
  let y = poster ? 793 : 432;
  const encounter = doc.sections.find((s) => s.id === "encounter");
  if (poster) {
    for (const line of p.poster.lines)
      y = write(line, 34, 60, y, width - 120, 34 * 1.42);
    if (y > 942) throw new QianzaiExportError("CONTENT_LIMIT");
  } else if (encounter) {
    y = center(encounter.title, 25, y) + 6;
    if (encounter.intro) y = center(encounter.intro, 22, y) + 6;
    for (const block of encounter.blocks) {
      if (block.title) y = center(block.title, 25, y) + 4;
      y = center(block.text, 22, y) + 6;
      if (block.citation) y = center(block.citation, 18, y) + 4;
    }
  }
  const radarHeading = poster ? 960 : y + 14;
  if (poster) {
    ops.push({ kind: "rule", y: radarHeading });
    ops.push({
      kind: "ornament",
      box: { x: 49, y: 983, width: 42, height: 42 },
      style: "heading",
    });
    write("五维心象", 55, 110, 974, 500, 67, true);
  } else y = heading("五维心象", radarHeading);
  const radar = poster
    ? { x: 333, y: 1320, radius: 145 }
    : { x: 365, y: y + 165, radius: 126 };
  ops.push({
    kind: "radar",
    ...radar,
    scores: doc.dimensions.map((d) => d.score),
  });
  const labels = poster
    ? [
        [270, 1047],
        [493, 1192],
        [430, 1370],
        [126, 1370],
        [76, 1192],
      ]
    : [
        [304, radar.y - 205],
        [510, radar.y - 57],
        [435, radar.y + 90],
        [170, radar.y + 90],
        [85, radar.y - 57],
      ];
  doc.dimensions.forEach((d, i) => {
    const [x, top] = labels[i]!;
    let yy = write(
      d.label,
      poster ? 28 : 23,
      x!,
      top!,
      poster ? 132 : 115,
      poster ? 36 : 30,
      false,
      true,
    );
    yy = write(
      String(d.score),
      poster ? 39 : 32,
      x!,
      yy,
      poster ? 132 : 115,
      poster ? 45 : 38,
      "number",
      true,
    );
    const scale = qianzaiDimensionScale(
      d,
      doc.body.provenance.canonicalContentSha256,
    );
    if (scale) {
      const caption =
        scale.position === "left"
          ? scale.left
          : scale.position === "right"
            ? scale.right
            : scale.positionLabel;
      write(
        caption,
        poster ? 20 : 17,
        x! - 16,
        yy,
        poster ? 164 : 147,
        poster ? 27 : 23,
        false,
        true,
        "#5f563d",
      );
    }
  });
  y = poster ? 1512 : Math.max(highest, radar.y + 175) + 12;
  const tagWidth = poster ? 151 : 151,
    gap = poster ? 20 : 22,
    tagAreaStart = poster ? 84 : 165,
    tagCount = p.poster.tags.length,
    start = tagAreaStart + ((3 - tagCount) * (tagWidth + gap)) / 2,
    tagSize = poster ? 27 : 22,
    tagH = poster ? 56 : 43;
  if (tagCount > 3) throw new QianzaiExportError("CONTENT_LIMIT");
  p.poster.tags.forEach((tag, i) => {
    const x = start + i * (tagWidth + gap);
    if (x + tagWidth > width - 20)
      throw new QianzaiExportError("CONTENT_LIMIT");
    frame(x, y, tagWidth, tagH, "tag");
    write(
      tag,
      tagSize,
      x + 6,
      y + 9,
      tagWidth - 12,
      tagSize * 1.2,
      false,
      true,
    );
  });
  y += tagH + 22;
  if (poster) {
    const footer = annotation ? 1605 : 1616;
    write(doc.legal, 13, 45, footer, 850, 18, false, false, "#6f634b");
    if (annotation)
      write(annotation, 12, 45, 1642, 850, 16, false, false, "#6f634b");
    bound(L.posterHeight);
    return { width, height: L.posterHeight, operations: ops };
  }
  const dimensions = doc.sections.find((s) => s.id === "dimensions");
  if (dimensions) {
    y = heading(dimensions.title, y);
    if (dimensions.intro) y = write(dimensions.intro, 18, 55, y, 614, 27) + 8;
    for (const [i, b] of dimensions.blocks.entries()) {
      const d = doc.dimensions[i],
        start = y;
      if (!d) {
        if (b.title) y = write(b.title, 23, 55, y, 614, 32, true) + 4;
        y = write(b.text, 22, 55, y, 614, 33) + 16;
        if (b.citation) y = write(b.citation, 18, 55, y, 614, 27) + 8;
        continue;
      }
      // One aligned row: name/score, directional scale, complete explanation.
      // Keep the topic's original text (including its separator) below the name.
      let leftBottom = write(d.label, 24, 55, start, 140, 32, true);
      const topic = b.title?.startsWith(d.label)
        ? b.title.slice(d.label.length)
        : b.title;
      if (topic) leftBottom = write(topic, 18, 55, leftBottom + 3, 140, 25);
      const scoreWidth = ink(String(d.score), 27, "number");
      leftBottom = Math.max(
        leftBottom,
        write(
          String(d.score),
          27,
          65 + ink(d.label, 24, true),
          start,
          scoreWidth,
          34,
          "number",
        ),
      );
      const scale = qianzaiDimensionScale(
        d,
        doc.body.provenance.canonicalContentSha256,
      );
      let scaleBottom = start;
      if (scale) {
        const ticksBottom = Math.max(
          write(scale.left, 16, 205, start + 2, 96, 23),
          write(
            scale.right,
            16,
            309,
            start + 2,
            96,
            23,
            false,
            false,
            "#806f5e",
          ),
        );
        const trackY = ticksBottom + 11;
        ops.push({
          kind: "bar",
          x: 212,
          y: trackY,
          width: 186,
          score: d.score,
          scale: scale.geometry,
          prototypeScale: 1.1,
        });
        scaleBottom = trackY + 18;
      }
      let explanationBottom = write(b.text, 19, 415, start, 254, 29);
      if (b.citation)
        explanationBottom = write(
          b.citation,
          16,
          415,
          explanationBottom + 5,
          254,
          24,
        );
      y = Math.max(start + 66, leftBottom, scaleBottom, explanationBottom) + 16;
    }
  }
  for (const section of doc.sections.filter(
    (s) => s.id !== "encounter" && s.id !== "dimensions",
  )) {
    y = heading(section.title, y + 12);
    if (section.intro) y = write(section.intro, 21, 55, y, 614, 31) + 10;
    let remainingBlocks = section.blocks;
    if (section.id === "literature") {
      const imageY = y;
      ops.push({
        kind: "image",
        role: "portrait",
        box: { x: 38, y: imageY, width: 260, height: 300 },
        fit: "cover",
      });
      let detailY = write(doc.name, 38, 327, imageY + 8, 342, 49, true) + 4;
      if (doc.identity?.honorific)
        detailY = write(doc.identity.honorific, 24, 327, detailY, 342, 35) + 4;
      // This is the historical character profile, not the reader's traits.
      detailY = write(p.role.tags.join(" · "), 20, 327, detailY, 342, 29);
      // Keep the first complete literary paragraph beside the portrait; flow
      // later paragraphs below the taller column without clipping either one.
      const first = section.blocks[0];
      if (first) {
        detailY += 12;
        if (
          first.title &&
          !(first.layout === "lead" && first.title === doc.name)
        )
          detailY = write(first.title, 25, 327, detailY, 342, 36, true) + 7;
        detailY = write(first.text, 22, 327, detailY, 342, 33) + 13;
        if (first.citation)
          detailY = write(first.citation, 18, 327, detailY, 342, 27) + 7;
        remainingBlocks = section.blocks.slice(1);
      }
      y = Math.max(imageY + 316, detailY + 3);
    }
    if (section.id === "patterns") {
      const columns =
          section.blocks.length >= 2 && section.blocks.length <= 3
            ? section.blocks.length
            : 1,
        gap = 18,
        cardW = (width - 88 - gap * (columns - 1)) / columns,
        top = y;
      let bottom = y;
      for (const [i, b] of section.blocks.entries()) {
        const x = 44 + (i % columns) * (cardW + gap),
          cardY = columns === 1 ? bottom : top,
          insert = ops.length;
        let end = cardY + 18;
        if (b.title)
          end =
            write(
              b.title,
              columns === 3 ? 23 : 26,
              x + 15,
              end,
              cardW - 30,
              34,
              true,
            ) + 12;
        end =
          write(
            b.text,
            columns === 3 ? 20 : 22,
            x + 15,
            end,
            cardW - 30,
            columns === 3 ? 30 : 33,
          ) + 16;
        if (b.citation)
          end = write(b.citation, 18, x + 15, end, cardW - 30, 27) + 10;
        ops.splice(insert, 0, {
          kind: "card",
          box: { x, y: cardY, width: cardW, height: end - cardY },
          dark: false,
        });
        bottom = Math.max(bottom, end + 14);
      }
      y = bottom;
    } else
      for (const b of remainingBlocks) {
        if (b.title) y = write(b.title, 25, 55, y, 614, 36, true) + 7;
        const final = section.id === "closure" && b.layout === "final-verse";
        y =
          write(
            b.text,
            final ? 30 : b.layout === "source" ? 18 : 22,
            55,
            y,
            614,
            final ? 45 : b.layout === "source" ? 28 : 34,
            final,
            false,
            final ? "#8a591f" : b.layout === "source" ? "#6f634b" : "#27291f",
          ) + 13;
        if (b.citation) y = write(b.citation, 18, 55, y, 614, 27) + 7;
      }
  }
  y += 16;
  ops.push({ kind: "rule", y });
  y = write(doc.legal, 15, 45, y + 17, 634, 23, false, false, "#6f634b") + 12;
  if (annotation)
    y = write(annotation, 13, 45, y, 634, 20, false, false, "#6f634b") + 8;
  const height = Math.ceil(Math.max(y + 28, highest + 28));
  bound(height);
  return { width, height, operations: ops };
}
