import type { ComposedReportBodyV1 } from "@/lib/assessment-contract/composed-report-v1";

type Body = ComposedReportBodyV1;
export type QianzaiReportParagraph =
  Body["volumes"][number]["paragraphs"][number];
export type QianzaiVolumeId = Body["volumes"][number]["id"];
export type QianzaiParagraphLayout =
  | "body"
  | "verse"
  | "lead"
  | "card"
  | "reflection-quote"
  | "reflection-body"
  | "prompt"
  | "timeline"
  | "source"
  | "final-verse";
/** Compiled, versioned display annotations. Never accepts scores or replacement
 * personalized prose. The adapter binds this to the selected role ref/version. */
export type QianzaiReportPresentation = Readonly<{
  roleRef: Body["matching"]["selected"]["ref"];
  version: string;
  sourceHtmlSha256: string;
  identity?: Readonly<{
    honorific?: string;
    seal?: readonly string[];
    tags?: readonly string[];
    verse?: Readonly<{ text: string; source: string }>;
    lifespan?: string;
    courtesyName?: string;
  }>;
  history?: Readonly<{
    title: string;
    intro?: string;
    timeline: readonly Readonly<{ title: string; text: string }>[];
    sourceNote: string;
  }>;
  heroCaption?: string;
  sections?: readonly Readonly<{
    id: QianzaiVolumeId;
    title?: string;
    chapterLabel?: string;
    tocTitle?: string;
    intro?: string;
    paragraphs?: readonly Readonly<{
      index: number;
      layout: QianzaiParagraphLayout;
      /** Title/citation attach only to this complete, non-null snapshot claim ref. */
      claimRef?: NonNullable<QianzaiReportParagraph["claimRef"]>;
      title?: string;
      citation?: string;
    }>[];
  }>[];
}>;
export type QianzaiReportBlock = Readonly<{
  text: string;
  layout: QianzaiParagraphLayout;
  title?: string;
  citation?: string;
  snapshot?: QianzaiReportParagraph;
}>;
type QianzaiReportDocumentContent = Readonly<{
  name: string;
  sourceHtmlSha256?: string;
  history?: QianzaiReportPresentation["history"];
  subtitle: string;
  identity?: QianzaiReportPresentation["identity"];
  heroCaption: string;
  openingTitle: string;
  openingNote?: string;
  dimensions: readonly Body["dimensions"][number][];
  dimensionBadge: string;
  dimensionInsight?: Readonly<{ title: string; text: string }>;
  dimensionWarning?: string;
  sections: readonly Readonly<{
    id: QianzaiVolumeId;
    title: string;
    chapterLabel?: string;
    tocTitle?: string;
    intro?: string;
    blocks: readonly QianzaiReportBlock[];
    note?: string;
  }>[];
  legal: string;
}>;
export type QianzaiSnapshotDocument = QianzaiReportDocumentContent &
  Readonly<{ mode: "snapshot"; body: Body }>;
/** Browser comparison fixture only; cannot contain a sealed body or receipt. */
export type QianzaiReferenceDocument = QianzaiReportDocumentContent &
  Readonly<{ mode: "reference-only"; sourceHtmlSha256: string; body?: never }>;
export type QianzaiReportDocument =
  QianzaiSnapshotDocument | QianzaiReferenceDocument;
/** No sentence splitting, inference, or dropping unannotated snapshot paragraphs. */
export function qianzaiSnapshotDocument(
  body: Body,
  candidate?: QianzaiReportPresentation,
): QianzaiSnapshotDocument {
  const ref = body.matching.selected.ref;
  const presentation =
    candidate &&
    /^[a-f0-9]{64}$/.test(candidate.sourceHtmlSha256) &&
    candidate.roleRef.id === ref.id &&
    candidate.roleRef.productId === ref.productId &&
    candidate.roleRef.version === ref.version
      ? candidate
      : undefined;
  return {
    mode: "snapshot",
    name: body.matching.selected.label,
    subtitle: body.title,
    ...(presentation
      ? { sourceHtmlSha256: presentation.sourceHtmlSha256 }
      : {}),
    ...(presentation?.identity ? { identity: presentation.identity } : {}),
    ...(presentation?.history ? { history: presentation.history } : {}),
    heroCaption: presentation?.heroCaption ?? "长风有信，明月知心",
    openingTitle: body.volumes[0]!.title,
    dimensions: body.dimensions,
    dimensionBadge: "本轮分值",
    sections: body.volumes.map((v) => {
      const section = presentation?.sections?.find((s) => s.id === v.id);
      return {
        id: v.id,
        title: section?.title ?? v.title,
        ...(section?.chapterLabel
          ? { chapterLabel: section.chapterLabel }
          : {}),
        ...(section?.tocTitle ? { tocTitle: section.tocTitle } : {}),
        ...(section?.intro ? { intro: section.intro } : {}),
        blocks: v.paragraphs.map((p, index) => {
          const annotation = section?.paragraphs?.find(
            (a) => a.index === index,
          );
          const claimMatches =
            annotation?.claimRef &&
            p.claimRef &&
            annotation.claimRef.productId === p.claimRef.productId &&
            annotation.claimRef.id === p.claimRef.id &&
            annotation.claimRef.version === p.claimRef.version;
          return {
            text: p.text,
            layout: annotation?.layout ?? "body",
            ...(claimMatches && annotation?.title
              ? { title: annotation.title }
              : {}),
            ...(claimMatches && annotation?.citation
              ? { citation: annotation.citation }
              : {}),
            snapshot: p,
          };
        }),
      };
    }),
    legal: body.notice,
    body,
  };
}
