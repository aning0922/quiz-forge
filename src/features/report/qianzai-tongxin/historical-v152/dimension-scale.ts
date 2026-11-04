import { qianzaiPresentationSourceMatches } from "@/features/report/qianzai-tongxin/historical-v152/presentation-source";
import { qianzaiKnownPresentationSourceMatches } from "@/features/report/qianzai-tongxin/historical-v152/known-presentation-source";
import type { ComposedReportBodyV1 } from "@/lib/assessment-contract/composed-report-v1";
import { QIANZAI_AXIS_GUIDES_V11 } from "@/features/report/qianzai-tongxin/historical-v152/role-profiles-v11";

type Dimension = ComposedReportBodyV1["dimensions"][number];
const AXES = {
  "axis-1": { label: "守心", left: "协调共同选择", right: "表达自身选择" },
  "axis-2": { label: "寻远", left: "深入熟悉领域", right: "尝试陌生事物" },
  "axis-3": { label: "知情", left: "先处理问题", right: "先回应感受" },
  "axis-4": { label: "决断", left: "先了解条件", right: "先行动体验" },
  "axis-5": { label: "应变", left: "保留结构局部调整", right: "整体重新安排" },
} as const;
export const QIANZAI_SCALE_HEADING = "五维心象刻度";
export const QIANZAI_SCALE_MIDPOINT_LABEL = "中点 50 · 两端偏好";
export const QIANZAI_SCALE_PREFACE = "刻度表示本轮选择的方向，不代表能力高低。";
export const QIANZAI_SCALE_DISPLAY_NOTICE =
  "接近中点只表示刻度位置，请结合具体选择阅读。";
export const QIANZAI_SCALE_DETAIL_LABEL = "这一维的解释范围";
export type QianzaiScaleGeometry = Readonly<{
  midpointPercent: 50;
  positionPercent: number;
  bandStartPercent: number;
  bandWidthPercent: number;
}>;
export type QianzaiDimensionScale = Readonly<{
  dimensionId: string;
  label: string;
  score: number;
  left: string;
  right: string;
  position: "left" | "middle" | "right";
  positionLabel: string;
  caption: string;
  explanation: string;
  geometry: QianzaiScaleGeometry;
}>;
/** A display-only projection of an existing sealed 0..100 integer. Positive
 * contributions move right in the current scoring definition; no score is recomputed. */
export function qianzaiDimensionScale(
  dimension: Dimension,
  sourceContentSha256: string | undefined,
): QianzaiDimensionScale | null {
  const { dimensionRef: ref, score } = dimension;
  if (
    !(
      qianzaiPresentationSourceMatches(sourceContentSha256) ||
      qianzaiKnownPresentationSourceMatches(sourceContentSha256)
    ) ||
    ref.productId !== "qianzai-tongxin" ||
    ref.version !== "1.0.0" ||
    !Object.hasOwn(AXES, ref.id) ||
    !Number.isInteger(score) ||
    score < 0 ||
    score > 100
  )
    return null;
  const axis = AXES[ref.id as keyof typeof AXES];
  if (dimension.label !== axis.label) return null;
  // Display labels only: 45..55 never snaps the actual position to 50.
  const position = score < 45 ? "left" : score <= 55 ? "middle" : "right";
  const positionLabel = {
    left: "靠近左侧",
    middle: "接近中点",
    right: "靠近右侧",
  }[position];
  return Object.freeze({
    dimensionId: ref.id,
    ...axis,
    score,
    position,
    positionLabel,
    caption:
      position === "middle"
        ? "本轮刻度接近中点，请结合具体选择阅读。"
        : `本轮刻度更靠近「${position === "left" ? axis.left : axis.right}」。`,
    explanation: QIANZAI_AXIS_GUIDES_V11[ref.id as keyof typeof AXES],
    geometry: Object.freeze({
      midpointPercent: 50,
      positionPercent: score,
      bandStartPercent: Math.min(50, score),
      bandWidthPercent: Math.abs(score - 50),
    }),
  });
}
