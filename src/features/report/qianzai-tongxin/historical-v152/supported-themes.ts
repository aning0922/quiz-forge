import type { ComposedReportBodyV1 as Body } from "@/lib/assessment-contract/composed-report-v1";
import { qianzaiPresentationSourceMatches } from "@/features/report/qianzai-tongxin/historical-v152/presentation-source";
import { qianzaiKnownPresentationSourceMatches } from "@/features/report/qianzai-tongxin/historical-v152/known-presentation-source";
type Paragraph = Body["volumes"][number]["paragraphs"][number];
type Ref = Body["matching"]["selected"]["ref"];
const sameRef = (a: Ref, b: Ref) =>
  a.productId === b.productId && a.id === b.id && a.version === b.version;
type Feature = Readonly<{
  topic: string;
  tag: string;
  title: string;
  text: string;
  seen: string;
  short: readonly [string, string];
}>;
/** Compiled prose bound only to existing accepted, fully supported claims. */
const FEATURES = {
  novel: {
    topic: "exploration",
    tag: "尝试新意",
    title: "给新经验一个入口",
    text: "你愿意接触新经验，也愿意尝试新的表达方式。亲自靠近、动手感受，是你打开新局面的方式。",
    seen: "你愿意用新的经验与表达，打开眼前的可能。",
    short: ["为新的经验，打开一扇窗，", "让亲身尝试，带来新的发现。"],
  },
  gradual: {
    topic: "exploration",
    tag: "尝试新意",
    title: "从体验中发现可能",
    text: "你给新经验和新的表达方式留了位置。比起只在原处设想，你愿意亲自试试，让想法遇到具体的感受。",
    seen: "你愿意接触新经验，也尝试新的表达方式。",
    short: ["让新的想法，遇见亲身体验，", "从一次尝试，走近新的可能。"],
  },
  time: {
    topic: "exploration",
    tag: "深耕与探索",
    title: "眼前深耕，长远探索",
    text: "眼前，你愿意打磨已有的技艺；看向长远，又愿意接触陌生领域。熟悉与探索，被你放在不同的时间尺度里。",
    seen: "你既愿意打磨眼前的技艺，也把长远的方向留给探索。",
    short: ["让眼前的技艺，慢慢扎根，", "也为长远的探索，留一个入口。"],
  },
  familiar: {
    topic: "exploration",
    tag: "稳中尝新",
    title: "从熟悉之处接上新意",
    text: "熟悉的表达与惯常的兴趣，是你愿意回到的地方。与此同时，你也在另一种情境里选择了尝新；已有经验和新鲜感各有位置。",
    seen: "你会回到熟悉的兴趣，也在另一种情境里试试新事物。",
    short: ["从熟悉的热爱，继续出发，", "也让新的尝试，接上日常。"],
  },
  scale: {
    topic: "exploration",
    tag: "分清步调",
    title: "为不同投入安排步调",
    text: "轻巧的尝试与长期的投入，你选择了不同的方式。把事情放回各自的时间尺度，便能看见这些差别的来由。",
    seen: "你会区分眼前尝试与长期投入，安排不同的步调。",
    short: ["给轻巧的尝试，一个起点，", "给长久的投入，另一种步调。"],
  },
  voice: {
    topic: "voice",
    tag: "表达主张",
    title: "把自己的方向说清楚",
    text: "在相处与共同安排中，你愿意表达自己的选择，并说出理由。清楚的表达，让别人知道你希望保留什么，也让商量有了起点。",
    seen: "你愿意说清自己的选择，让共同的商量有据可循。",
    short: ["把自己的方向，清楚说出，", "让彼此的商量，有处落笔。"],
  },
  listening: {
    topic: "voice",
    tag: "兼顾彼此",
    title: "主张与倾听，各有位置",
    text: "你会随着关系与共同承担的分量，调整表达和商量的先后。自己的安排与同行者的需要，在不同情境里有不同的位置。",
    seen: "你会按相处的情境，调整主张与商量的先后。",
    short: ["让自己的主张，有处安放，", "也听见同行的人，在意什么。"],
  },
  care: {
    topic: "care",
    tag: "先听感受",
    title: "先让感受被听见",
    text: "面对他人的心事，你愿意先聊聊感受，再看接下来怎么办。先陪对方把话说出来，是你在这些相处情境里选择的入口。",
    seen: "面对他人的心事，你愿意先听感受，再看怎么办。",
    short: ["先听一段话里的感受，", "再陪对方，看接下来的路。"],
  },
  careBoth: {
    topic: "care",
    tag: "因境关照",
    title: "按需要选择帮助的入口",
    text: "事情受阻时，你愿意先找办法；换一个相处情境，又会先回应感受。帮助并非只有一种开场，关键在于当下的需要。",
    seen: "你会因情境不同，选择先处理问题或回应感受。",
    short: ["从事情与感受之间，", "寻找此刻合适的靠近方式。"],
  },
  action: {
    topic: "action",
    tag: "先行体验",
    title: "用一小步换来具体认识",
    text: "面对可以尝试的任务，你愿意先动手，在体验中了解情况。行动为后续判断提供了具体材料，而不是只停留在设想里。",
    seen: "你愿意先行动体验，让下一步有具体的参照。",
    short: ["先走一小步，亲自体验，", "让接下来的判断，有迹可循。"],
  },
  deliberate: {
    topic: "action",
    tag: "按事起步",
    title: "让任务决定起步方式",
    text: "有些任务里，你先体验；另一些情境里，你先了解条件。事情的分量改变了你的起步方式，行动与准备各有所用。",
    seen: "你会随任务不同，调整先体验还是先准备。",
    short: ["让行动与准备，各得其时，", "按事情的分量，选择起步。"],
  },
  arrange: {
    topic: "change",
    tag: "重整安排",
    title: "把打乱的安排重新组织",
    text: "你愿意重排活动与资料的次序；空间缩小时，又选择保留主体。重新组织并非全部推倒，重要的部分也能被留下。",
    seen: "安排有变时，你会重组次序，也保留重要的主体。",
    short: ["把散开的安排，重新梳理，", "从整体里，找到新的次序。"],
  },
  range: {
    topic: "change",
    tag: "按境调整",
    title: "改变多少，要看具体情境",
    text: "有时你保留原来的结构、局部调整，有时则重排整体。两种范围不同的做法，都出现在你的活动安排中。",
    seen: "你会按安排的具体情况，选择局部调整或整体重排。",
    short: ["保留与重排，各有时机，", "让改变的大小，贴合眼前。"],
  },
} as const satisfies Record<string, Feature>;
export type QianzaiParagraphSupport = Readonly<{
  id: string;
  kind: Paragraph["kind"];
  positive: readonly string[];
  negative: readonly string[];
}>;
type HighlightSpec = QianzaiParagraphSupport &
  Readonly<{ copy: keyof typeof FEATURES }>;
const HIGHLIGHTS: readonly HighlightSpec[] = [
  {
    id: "authored-be6dfe2f8a8e169562e5",
    kind: "summary",
    positive: ["q02-b", "q04-a", "q18-b"],
    negative: [],
    copy: "novel",
  },
  {
    id: "authored-2183345a26070ca76521",
    kind: "summary",
    positive: ["q02-b", "q04-a"],
    negative: [],
    copy: "gradual",
  },
  {
    id: "authored-a2e009c70f9a3d6f22d1",
    kind: "context",
    positive: ["q02-a"],
    negative: ["q18-b"],
    copy: "time",
  },
  {
    id: "authored-b8bf09d2226b2ffe1c82",
    kind: "context",
    positive: ["q02-d"],
    negative: ["q18-b"],
    copy: "time",
  },
  {
    id: "authored-08f3cdb86f791ca55f3e",
    kind: "context",
    positive: ["q02-b"],
    negative: ["q18-a"],
    copy: "scale",
  },
  {
    id: "authored-7e26648aaa482120244a",
    kind: "context",
    positive: ["q02-c", "q04-d"],
    negative: ["q18-c"],
    copy: "scale",
  },
  {
    id: "authored-8ce4a3aa7a2f8df07120",
    kind: "context",
    positive: ["q04-c", "q16-b"],
    negative: ["q02-b"],
    copy: "familiar",
  },
  {
    id: "authored-df4afee573a6d5410329",
    kind: "context",
    positive: ["q04-c", "q16-b"],
    negative: ["q18-b"],
    copy: "familiar",
  },
  {
    id: "authored-e15f11f029ba48a56159",
    kind: "summary",
    positive: ["q01-b", "q13-c"],
    negative: [],
    copy: "voice",
  },
  {
    id: "authored-1496dc725aac8a45f68a",
    kind: "context",
    positive: ["q01-d"],
    negative: ["q05-a", "q13-c"],
    copy: "listening",
  },
  {
    id: "authored-32874c524c0bcefdb155",
    kind: "summary",
    positive: ["q03-c", "q06-c"],
    negative: [],
    copy: "care",
  },
  {
    id: "authored-fbc38639503bf45326b2",
    kind: "context",
    positive: ["q03-a"],
    negative: ["q11-d"],
    copy: "careBoth",
  },
  {
    id: "authored-002ddc7622c049644c55",
    kind: "summary",
    positive: ["q07-b", "q10-a"],
    negative: [],
    copy: "action",
  },
  {
    id: "authored-e716458dd62fba60133b",
    kind: "context",
    positive: ["q10-a"],
    negative: ["q20-a"],
    copy: "deliberate",
  },
  {
    id: "authored-830a42cecf558735b444",
    kind: "context",
    positive: ["q07-d"],
    negative: ["q20-a"],
    copy: "deliberate",
  },
  {
    id: "authored-10297a0921ca8d92695f",
    kind: "context",
    positive: ["q07-b"],
    negative: ["q20-a"],
    copy: "deliberate",
  },
  {
    id: "authored-e1c783c5f3ab40481de5",
    kind: "fact",
    positive: ["q08-b", "q12-d", "q15-c"],
    negative: [],
    copy: "arrange",
  },
  {
    id: "authored-16553d1f1248807e2eca",
    kind: "context",
    positive: ["q08-a"],
    negative: ["q15-a"],
    copy: "range",
  },
  {
    id: "authored-d1f99697bb0f674d965a",
    kind: "context",
    positive: ["q08-a"],
    negative: ["q15-a"],
    copy: "range",
  },
];

export function qianzaiSupportedParagraph(
  body: Body,
  volume: "patterns" | "counterevidence",
  spec: QianzaiParagraphSupport,
): Paragraph | undefined {
  if (!(
    qianzaiPresentationSourceMatches(body.provenance.canonicalContentSha256) ||
    qianzaiKnownPresentationSourceMatches(
      body.provenance.canonicalContentSha256,
    )
  ))
    return undefined;
  const matches = (
    actual: Paragraph["evidence"],
    expected: readonly string[],
  ) =>
    actual.length === expected.length &&
    new Set(actual.map((e) => e.optionRef.id)).size === actual.length &&
    expected.every((option) =>
      actual.some((e) => {
        const question = option.split("-")[0]!;
        const expectedQuestion = {
            productId: "qianzai-tongxin",
            id: question,
            version: "1.0.0",
          },
          expectedOption = { ...expectedQuestion, id: option };
        const answers = body.answers.filter((a) =>
          sameRef(a.questionRef, expectedQuestion),
        );
        return (
          sameRef(e.questionRef, expectedQuestion) &&
          sameRef(e.optionRef, expectedOption) &&
          answers.length === 1 &&
          sameRef(answers[0]!.optionRef, expectedOption) &&
          answers[0]!.prompt === e.prompt &&
          answers[0]!.optionText === e.optionText
        );
      }),
    );
  return body.volumes
    .find((v) => v.id === volume)
    ?.paragraphs.find(
      (p) =>
        p.status === "accepted" &&
        p.kind === spec.kind &&
        p.claimRef &&
        sameRef(p.claimRef, {
          productId: "qianzai-tongxin",
          id: spec.id,
          version: "1.0.0",
        }) &&
        matches(p.evidence, spec.positive) &&
        matches(p.counterevidence, spec.negative),
    );
}

/** Display selection only; never reruns scoring or grants authority. */
export function qianzaiSupportedThemes(body: Body) {
  const topics = new Set<string>();
  return HIGHLIGHTS.flatMap((spec) => {
    const snapshot = qianzaiSupportedParagraph(body, "patterns", spec);
    const feature = FEATURES[spec.copy];
    if (!snapshot || topics.has(feature.topic)) return [];
    topics.add(feature.topic);
    return [{ feature, snapshot }];
  }).slice(0, 3);
}
export function qianzaiSupportedThemeText(): readonly string[] {
  return Object.values(FEATURES).flatMap((f) => [
    f.tag,
    f.title,
    f.text,
    f.seen,
    ...f.short,
  ]);
}
/** Actual card-heading strings for the fixed export brush face. */
export function qianzaiSupportedThemeHeadingText(): readonly string[] {
  return Object.values(FEATURES).map((feature) => feature.title);
}
