import type { ComposedReportBodyV1 as Body } from "@/lib/assessment-contract/composed-report-v1";
import { qianzaiPresentationSourceMatches } from "@/features/report/qianzai-tongxin/historical-v152/presentation-source";
type Paragraph = Body["volumes"][number]["paragraphs"][number];
type Volume = Body["volumes"][number];
export type QianzaiParagraphEditorial = Readonly<{
  kind: "resonance" | "record" | "reflection";
  label: string;
  title: string;
  choiceSummary?: string;
}>;
export type QianzaiChapterEditorial = Readonly<{
  kind: "resonance" | "reflection";
  intro: string;
  featureClaimId?: string;
  dedication?: string;
  prompts?: readonly Readonly<{ title: string; text: string }>[];
}>;
type Entry = Readonly<{
  volume: "patterns" | "counterevidence";
  status: Paragraph["status"];
  paragraphKind: Paragraph["kind"];
  display: QianzaiParagraphEditorial;
  priority?: number;
  question?: string;
}>;
const resonance = (
  paragraphKind: Paragraph["kind"],
  label: string,
  title: string,
  choiceSummary: string,
): Entry => ({
  volume: "patterns",
  status: "accepted",
  paragraphKind,
  display: { kind: "resonance", label, title, choiceSummary },
});
const reflection = (
  paragraphKind: Paragraph["kind"],
  title: string,
  priority: number,
  question: string,
): Entry => ({
  volume: "counterevidence",
  status: "accepted",
  paragraphKind,
  priority,
  question,
  display: { kind: "reflection", label: "情境与边界", title },
});
/** Editorial display only. Each entry is pinned below to the complete source,
 * claim reference and status. No score, claim, quote or snapshot prose is generated. */
const ENTRIES: Readonly<Record<string, Entry>> = {
  "authored-be6dfe2f8a8e169562e5": resonance(
    "summary",
    "寻远 · 本轮选择线索",
    "向陌生的光走去",
    "闲暇时尝新，作品表达尝试新方式，下一阶段也愿探索。",
  ),
  "authored-1496dc725aac8a45f68a": resonance(
    "context",
    "守心 · 情境中的先后",
    "主张并不排斥倾听",
    "私人安排愿坚持，同行择路也愿倾听。",
  ),
  "authored-e716458dd62fba60133b": resonance(
    "context",
    "决断 · 情境中的先后",
    "有些事先做，有些事先想",
    "补救时先执行可行方案，个人计划开始前先想清规划。",
  ),
  "authored-e1c783c5f3ab40481de5": resonance(
    "fact",
    "应变 · 活动重组情境",
    "把变化化成新的排布",
    "活动顺序与资料次序愿意重排，空间缩小时保留主体。",
  ),
  "authored-7e26648aaa482120244a": resonance(
    "context",
    "寻远 · 不同时间尺度",
    "新意未必意味着重新开始",
    "短时创作愿意试新，长期投入也可以求深。",
  ),
  "authored-830a42cecf558735b444": resonance(
    "context",
    "决断 · 情境中的先后",
    "有时先行，有时先定章程",
    "可退出的体验先预约，重要的个人计划先规划。",
  ),
  "authored-e15f11f029ba48a56159": resonance(
    "summary",
    "守心 · 本轮选择线索",
    "表达选择，也说明理由",
    "择路时提出想法并愿意调整，推进计划时解释自己的节奏。",
  ),
  "authored-32874c524c0bcefdb155": resonance(
    "summary",
    "知情 · 本轮选择线索",
    "先聊心情，再看安排",
    "两次回应都先聊感受，再一起考虑办法与安排。",
  ),
  "authored-002ddc7622c049644c55": resonance(
    "summary",
    "决断 · 本轮选择线索",
    "先走一小步，再调整",
    "体验先试一段，补救先执行可行方案。",
  ),
  "authored-3a4d6c0ad9a0fa847194": {
    volume: "patterns",
    status: "facts-only",
    paragraphKind: "summary",
    display: {
      kind: "record",
      label: "知情 · 本轮选择记录",
      title: "两次先理清事情的选择",
    },
  },
  "authored-2327e4fe1d6e8509b490": reflection(
    "context",
    "新鲜与变化，分别来看",
    100,
    "尝试新方向时，你最想保留什么？",
  ),
  "authored-d75859c43a8778ab14a4": reflection(
    "fact",
    "改变多少，放回情境再看",
    100,
    "需要改变时，哪些内容是你想留下的主体？",
  ),
  "authored-6986b26ef46f6048b67a": reflection(
    "fact",
    "闲暇与长远，两种时间尺度",
    50,
    "闲暇时的尝试与长期投入，对你有什么不同？",
  ),
  "authored-407a0f1c9a00adc8d3b5": reflection(
    "context",
    "闲暇与长远，两种时间尺度",
    50,
    "闲暇时的尝试与长期投入，对你有什么不同？",
  ),
  "authored-9d2026238595c0484741": reflection(
    "context",
    "闲暇与长远，两种时间尺度",
    50,
    "闲暇时的尝试与长期投入，对你有什么不同？",
  ),
  "authored-1dafde234a09b733409f": reflection(
    "context",
    "闲暇与长远，两种时间尺度",
    50,
    "闲暇时的尝试与长期投入，对你有什么不同？",
  ),
  "authored-3f7e75cf3acf9c78474c": reflection(
    "fact",
    "熟悉的技艺与长期深耕",
    50,
    "熟悉的事物里，还有什么值得继续深入？",
  ),
  "authored-024c732f5e25d067c022": reflection(
    "fact",
    "活动重排，只说明这些情境",
    40,
    "安排需要改变时，哪些部分是你想保留的？",
  ),
  "authored-21b7bda9dbc95b917a00": reflection(
    "context",
    "活动重排，只说明这些情境",
    40,
    "安排需要改变时，哪些部分是你想保留的？",
  ),
};
export const QIANZAI_EDITORIAL_VERSION = "qianzai-report-editorial.v1";
export const QIANZAI_EDITORIAL_RECORD_LABEL = "本轮选择记录";
export const QIANZAI_EDITORIAL_FALLBACK_LABEL = "这一章，暂且留白";
export const QIANZAI_EDITORIAL_DEDICATION_LABEL = "编辑寄语";
export const QIANZAI_EDITORIAL_SUMMARY_LABEL = "选择摘要";
export const QIANZAI_EDITORIAL_SUPPLEMENT_LABEL = "补充情境记录";
function entry(
  body: Body,
  volume: Volume["id"],
  p: Paragraph,
): Entry | undefined {
  const ref = p.claimRef;
  if (
    !qianzaiPresentationSourceMatches(body.provenance.canonicalContentSha256) ||
    !ref ||
    ref.productId !== "qianzai-tongxin" ||
    ref.version !== "1.0.0" ||
    !Object.hasOwn(ENTRIES, ref.id)
  )
    return undefined;
  const found = ENTRIES[ref.id]!;
  return found.volume === volume &&
    found.status === p.status &&
    found.paragraphKind === p.kind
    ? found
    : undefined;
}
export function qianzaiParagraphEditorial(
  body: Body,
  volume: Volume["id"],
  paragraph: Paragraph,
): QianzaiParagraphEditorial | undefined {
  return entry(body, volume, paragraph)?.display;
}
export function qianzaiChapterEditorial(
  body: Body,
  volume: Volume,
): QianzaiChapterEditorial | undefined {
  if (!qianzaiPresentationSourceMatches(body.provenance.canonicalContentSha256))
    return undefined;
  if (volume.id === "patterns")
    return {
      kind: "resonance",
      intro: "从本轮选择中，读几处可以展开的线索。人物形象只作文学参照。",
    };
  if (volume.id !== "counterevidence") return undefined;
  const choices = volume.paragraphs.flatMap((p) => {
    const found = entry(body, volume.id, p);
    return found?.display.kind === "reflection" ? [{ p, found }] : [];
  });
  choices.sort(
    (a, b) =>
      (b.found.priority ?? 0) - (a.found.priority ?? 0) ||
      a.p.claimRef!.id.localeCompare(b.p.claimRef!.id),
  );
  const feature = choices[0];
  return {
    kind: "reflection",
    intro: "把选择放回情境，也给未说出的部分留白。",
    ...(feature
      ? {
          featureClaimId: feature.p.claimRef!.id,
          dedication: "愿你向远方，也留意脚下。",
          prompts: [
            { title: "照见自己", text: feature.found.question! },
            ...(choices.some((c) => c.found.priority === 40) &&
            feature.found.priority !== 40
              ? [
                  {
                    title: "留给下一次",
                    text: "下次安排有变时，你想先看清哪些需要重排、哪些可以保留？",
                  },
                ]
              : []),
          ],
        }
      : {}),
  };
}
