import type { HistoricalReportView } from "./historical-view";
import type { HistoricalVisualCopy } from "./historical-visual-copy";
import { referencedDimensions, type ResultAtlasView } from "./result-atlas";
import {
  inscriptionAttribution,
  validateInscription,
  type TemperamentInscription,
} from "./temperament-inscription";

/** Internal read-only presentation adapter; not a QuizPack or persisted report schema. */
export interface HistoricalDisplayBundle {
  readonly displayId: string;
  readonly report: HistoricalReportView;
  readonly atlas: ResultAtlasView;
  readonly copy: HistoricalVisualCopy;
  readonly inscription: TemperamentInscription | null;
}

/** Only public display fields. No answers, keys, session or personal data. */
export interface HistoricalPosterView {
  readonly kind: "synthetic-preview";
  readonly fixtureId: string;
  readonly identity: {
    readonly name: string;
    readonly title: string;
    readonly era: string;
  };
  readonly artwork: {
    readonly assetId: string;
    readonly src: string;
    readonly alt: string;
  };
  readonly inscription: {
    readonly kind: "classical" | "original";
    readonly lines: readonly string[];
    readonly attribution: string;
  };
  readonly tendencies: readonly {
    readonly dimensionId: string;
    readonly label: string;
    readonly normalizedScore: number;
  }[];
  readonly brand: string;
  readonly disclosure: string;
}

const artworkRegistry = {
  "historical.li-bai.concept": {
    src: "/assets/themes/historical/visual-v2-c/figure-960.webp",
    alt: "李白艺术化幻想概念：持玉杯的诗人、月轮与云绢。AI概念画作，商用审批待完成。",
  },
} as const;

export function resolveHistoricalPosterArtwork(assetId: string) {
  const artwork = Object.hasOwn(artworkRegistry, assetId)
    ? artworkRegistry[assetId as keyof typeof artworkRegistry]
    : undefined;
  if (!artwork) throw new Error("人物画作未登记，无法生成海报。");
  return { assetId, ...artwork };
}

export function createHistoricalPosterView({
  displayId,
  report,
  atlas,
  copy,
  inscription,
}: HistoricalDisplayBundle): HistoricalPosterView {
  const hasText = (value: unknown): value is string =>
    typeof value === "string" && value.trim().length > 0;
  if (
    !hasText(displayId) ||
    report.kind !== "synthetic-preview" ||
    !hasText(report.identity?.name) ||
    !hasText(report.identity?.title) ||
    !hasText(report.identity?.era)
  )
    throw new Error("人物身份资料不完整，无法生成海报。");
  if (!inscription || !validateInscription(inscription))
    throw new Error("题签及出处资料不完整，无法生成海报。");
  if (copy.posterDimensions.length < 2 || copy.posterDimensions.length > 3)
    throw new Error("海报需要两至三项已登记的性情倾向。");
  const dimensions = referencedDimensions(
    atlas,
    copy.posterDimensions.map((item) => item.dimensionId),
  );
  if (copy.posterDimensions.some((item) => !item.shortLabel.trim()))
    throw new Error("性情标签资料不完整，无法生成海报。");
  return {
    kind: "synthetic-preview",
    fixtureId: displayId,
    identity: {
      name: report.identity.name,
      title: report.identity.title,
      era: report.identity.era,
    },
    artwork: resolveHistoricalPosterArtwork(report.identity.portraitAssetId),
    inscription: {
      kind: inscription.kind,
      lines: [...inscription.lines],
      attribution: inscriptionAttribution(inscription),
    },
    tendencies: dimensions.map((item, index) => ({
      dimensionId: item.dimensionId,
      label: copy.posterDimensions[index]!.shortLabel,
      normalizedScore: item.normalizedScore,
    })),
    brand: "千载同心 / QUIZFORGE",
    disclosure: "合成演示 · 非答题结论 · 娱乐性格测评 · 非心理诊断",
  };
}
