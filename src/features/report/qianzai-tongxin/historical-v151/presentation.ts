import {
  qianzaiConsumerCopy,
  qianzaiKnownConsumerCopy,
} from "@/features/report/qianzai-tongxin/historical-v151/consumer-copy";
import { QIANZAI_CLASSICAL_EDITION } from "@/features/report/qianzai-tongxin/historical-v151/classical-edition";
import type { ComposedReportBodyV1 } from "@/lib/assessment-contract/composed-report-v1";
import {
  qianzaiPresentationMatchesBody,
  type QianzaiResultPresentation,
} from "@/features/report/qianzai-tongxin/historical-v151/result-presentation";

import {
  qianzaiChapterEditorial,
  qianzaiParagraphEditorial,
  type QianzaiChapterEditorial,
  type QianzaiParagraphEditorial,
} from "@/features/report/qianzai-tongxin/historical-v151/editorial";

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
  displayName?: string;
  identitySubtitle?: string;
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
  editorial?: QianzaiParagraphEditorial;
  text: string;
  layout: QianzaiParagraphLayout;
  title?: string;
  citation?: string;
  snapshot?: QianzaiReportParagraph;
}>;
type QianzaiReportDocumentContent = Readonly<{
  /** Compiled reader prose; body/snapshot remain audit data, never display fallbacks. */
  consumerEdition?: true;
  consumerCopyVersion?: string;
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
  resultPresentation?: QianzaiResultPresentation;
  sections: readonly Readonly<{
    id: QianzaiVolumeId;
    title: string;
    chapterLabel?: string;
    tocTitle?: string;
    intro?: string;
    editorial?: QianzaiChapterEditorial;
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
  derived?: QianzaiResultPresentation,
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
  const result = qianzaiPresentationMatchesBody(body, derived)
    ? derived
    : undefined;
  const role = result?.role;
  const consumer = result
    ? result.profileVersion === QIANZAI_CLASSICAL_EDITION.presentationVersion
      ? qianzaiKnownConsumerCopy(body, result)
      : qianzaiConsumerCopy(body, result)
    : undefined;
  return {
    mode: "snapshot",
    ...(consumer
      ? {
          consumerEdition: consumer.consumerEdition,
          consumerCopyVersion: consumer.consumerCopyVersion,
        }
      : {}),
    name:
      role?.displayName ??
      presentation?.displayName ??
      body.matching.selected.label,
    subtitle:
      role?.identitySubtitle ?? presentation?.identitySubtitle ?? body.title,
    ...(result ? { resultPresentation: result } : {}),
    ...(presentation
      ? { sourceHtmlSha256: presentation.sourceHtmlSha256 }
      : {}),
    ...(role && result
      ? {
          identity: {
            honorific: role.honorific,
            ...(role.aliasSeal ? { seal: role.aliasSeal } : {}),
            tags: consumer ? result.poster.tags : role.tags,
            verse: { text: result.quote.text, source: result.quote.source },
            ...(role.lifespan ? { lifespan: role.lifespan } : {}),
            ...(role.courtesyName ? { courtesyName: role.courtesyName } : {}),
          },
        }
      : presentation?.identity
        ? { identity: presentation.identity }
        : {}),
    ...(consumer
      ? {}
      : role
        ? { history: role.history }
        : presentation?.history
          ? { history: presentation.history }
          : {}),
    heroCaption: presentation?.heroCaption ?? "长风有信，明月知心",
    openingTitle: consumer
      ? consumer.sections[0]!.title
      : result
        ? "命定相逢"
        : body.volumes[0]!.title,
    dimensions: body.dimensions,
    dimensionBadge: consumer ? "选择的方向" : "本轮分值",
    sections:
      consumer?.sections ??
      body.volumes.map((v) => {
        const section = presentation?.sections?.find((s) => s.id === v.id);
        const editorial = qianzaiChapterEditorial(body, v);
        return {
          id: v.id,
          title: result
            ? {
                encounter: "命定相逢",
                dimensions: "你的心象五维",
                patterns: "为何偏偏与你相逢",
                counterevidence: "山河自照",
                literature: "人物小传",
                closure: "寄语留存",
              }[v.id]
            : (section?.title ?? v.title),
          ...(section?.chapterLabel
            ? { chapterLabel: section.chapterLabel }
            : {}),
          ...(section?.tocTitle ? { tocTitle: section.tocTitle } : {}),
          ...(editorial
            ? { editorial, intro: editorial.intro }
            : section?.intro
              ? { intro: section.intro }
              : {}),
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
            const paragraphEditorial = qianzaiParagraphEditorial(body, v.id, p);
            return {
              ...(paragraphEditorial
                ? {
                    editorial: paragraphEditorial,
                    title: paragraphEditorial.title,
                  }
                : {}),
              text: p.text,
              layout: editorial
                ? "body"
                : result
                  ? v.id === "encounter" && index === 0
                    ? "lead"
                    : v.id === "patterns"
                      ? "card"
                      : v.id === "counterevidence"
                        ? index === 0
                          ? "reflection-quote"
                          : "reflection-body"
                        : "body"
                  : (annotation?.layout ?? "body"),
              ...(!paragraphEditorial && claimMatches && annotation?.title
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
