import { sameConsumerFact } from "@/lib/consumer-contract/v1/integrity";
import type { ComposedReportBodyV1 as Body } from "@/lib/assessment-contract/composed-report-v1";
import type { QianzaiReportBlock, QianzaiReportDocument } from "./presentation";
import {
  QIANZAI_PRESENTATION_V11,
  QIANZAI_ROLE_PROFILES_V11,
} from "./role-profiles-v11";
import {
  qianzaiPresentationMatchesBody,
  type QianzaiResultPresentation,
} from "./result-presentation";
import { qianzaiPresentationSourceMatches } from "./presentation-source";
import { qianzaiDimensionScale } from "./dimension-scale";
import {
  qianzaiSupportedThemes,
  qianzaiSupportedParagraph,
  qianzaiSupportedThemeText,
  type QianzaiParagraphSupport,
} from "./supported-themes";

export const QIANZAI_CONSUMER_COPY_VERSION =
  "qianzai-consumer-copy.v1" as const;
type Paragraph = Body["volumes"][number]["paragraphs"][number];
type Section = QianzaiReportDocument["sections"][number];
type Ref = Body["matching"]["selected"]["ref"];
type Reflection = Readonly<{ title: string; text: string; suggestion: string }>;
const REFLECTIONS = {
  newChange: {
    title: "探索新方向，也需要熟悉的秩序",
    text: "你对新方向保持开放；临时安排有变时，却更愿意保留原来的结构。探索陌生与应对打乱，是两种不同的问题。",
    suggestion:
      "遇到变化时，先分清是在探索方向，还是调整安排。写下一件想保留的事，再选一个可改动的部分。",
  },
  newDirections: {
    title: "眼前与长远，都向新的方向开放",
    text: "眼前的一次尝试，与长久投入的方向，你都愿意走向陌生之处。两种时间尺度里的选择，都为新经验留了位置。",
    suggestion:
      "下一次起步时，先划一个小范围，留一个回看的时点。也可以为自己保留一处熟悉的落脚点。",
  },
  time: {
    title: "短期与长期，不必同一种选法",
    text: "短期的尝试与长期的投入，在这里呈现出不同方向。兴趣的时间跨度，也会影响你怎样选择。",
    suggestion:
      "做决定前，先问这是一段尝试，还是一项长期投入，再决定准备多少、走多快。",
  },
  familiarNew: {
    title: "熟悉是落点，陌生是另一条路",
    text: "眼前，你愿意打磨熟悉的技艺；看向长远，又想探索陌生领域。时间尺度变了，选择的方向也随之不同。",
    suggestion:
      "可以给新方向留一段试走的时间，同时保留已有的日常安排，看看两者如何接上。",
  },
  preserve: {
    title: "重新安排，也保留重要的部分",
    text: "活动变化时，你会重排安排；面对长期兴趣，又愿意继续投入熟悉的领域。改变安排与更换热爱，是两件不同的事。",
    suggestion: "动手前，写下一项必须保留的内容，再圈出一项可以调整的细节。",
  },
  deep: {
    title: "让熟悉的技艺继续向深处走",
    text: "眼前的技艺与长期的兴趣，你都更愿意在熟悉处继续投入。继续深入，也是一条值得认真走的路。",
    suggestion:
      "可以给已有的热爱留一段完整时间，选一个想进一步练习的细节，不必急着改变全部。",
  },
  range: {
    title: "改变多少，要放回具体安排",
    text: "在活动安排里，你既选择过保留结构、调整局部，也选择过重排整体。改变的范围，需要结合具体条件来看。",
    suggestion:
      "下一次安排有变，先找出必须保留的内容，再从一处小调整开始，看看是否已经足够。",
  },
} as const satisfies Record<string, Reflection>;
type ReflectionSpec = QianzaiParagraphSupport &
  Readonly<{ copy: keyof typeof REFLECTIONS }>;

// Fixed support selectors copied from the existing composed template, not new scoring rules.
const REFLECTION_SUPPORT: readonly ReflectionSpec[] = [
  {
    id: "authored-2327e4fe1d6e8509b490",
    kind: "context",
    positive: ["q09-c", "q18-b"],
    negative: ["q15-a"],
    copy: "newChange",
  },
  {
    id: "authored-d75859c43a8778ab14a4",
    kind: "fact",
    positive: ["q08-b", "q15-c", "q18-c"],
    negative: [],
    copy: "preserve",
  },
  {
    id: "authored-6986b26ef46f6048b67a",
    kind: "fact",
    positive: ["q02-b", "q18-b"],
    negative: [],
    copy: "newDirections",
  },
  {
    id: "authored-407a0f1c9a00adc8d3b5",
    kind: "context",
    positive: ["q02-b"],
    negative: ["q18-c"],
    copy: "time",
  },
  {
    id: "authored-9d2026238595c0484741",
    kind: "context",
    positive: ["q02-c"],
    negative: ["q18-c"],
    copy: "time",
  },
  {
    id: "authored-1dafde234a09b733409f",
    kind: "context",
    positive: ["q02-d"],
    negative: ["q18-b"],
    copy: "familiarNew",
  },
  {
    id: "authored-3f7e75cf3acf9c78474c",
    kind: "fact",
    positive: ["q02-d", "q18-c"],
    negative: [],
    copy: "deep",
  },
  {
    id: "authored-024c732f5e25d067c022",
    kind: "fact",
    positive: ["q08-b", "q15-c"],
    negative: [],
    copy: "range",
  },
  {
    id: "authored-21b7bda9dbc95b917a00",
    kind: "context",
    positive: ["q08-a"],
    negative: ["q15-a"],
    copy: "range",
  },
];
const ROLE_COPY = {
  "li-qingzhao": {
    echo: "这一卷借易安的词作文学参照：既细读日常，也让想象越过眼前。",
    opening: [
      "与你相逢的，是把溪亭旧游与云涛星河写进词里的李清照。细微的日常与辽阔的想象，在她的作品中并肩展开。",
      "读这一卷，可以从一句词、一个画面开始。不急着给自己下结论，先看看哪一处让你愿意停留。",
    ],
    historyTitle: "细读日常，也望向远方",
    historyIntro: "与李清照的文学相逢。",
    history: [
      {
        title: "溪亭与云涛",
        text: "《如梦令》记下一次旧游的声色，《渔家傲》把梦境推向海天。细看与远望，可以同时在一支笔下展开；这里借作品的多面，映照生活中不同的观看方式。",
      },
    ],
    blessing: "愿你记得一日的声色，也写得下远方。",
  },
  "li-bai": {
    echo: "这一卷借李白的山河诗境作参照，把眼前的选择放进更开阔的想象。",
    opening: [
      "李白的诗里，山河与明月常常把眼前的路带向远方。这一卷从作品出发，留一段可以自由阅读的旅程。",
      "不必把诗中的人物当成自己的定论。一个画面、一句诗，也可以只是重新看待日常的入口。",
    ],
    historyTitle: "在山河之间，展开想象",
    historyIntro: "与李白的文学相逢。",
    history: [
      {
        title: "山水不止是风景",
        text: "从《庐山谣》的鲜明声音，到《关山月》的长风与关山，山水承载着不同的情意。走近这些诗句，也是在练习把熟悉的日子看得更开阔。",
      },
    ],
    blessing: "愿你认真走路，也常常抬头。",
  },
  "su-shi": {
    echo: "这一卷借东坡途中遇雨的词境作参照，容纳同一段路上的不同感受。",
    opening: [
      "苏轼的《定风波》里，有雨中的吟啸，也有酒醒后的微凉。舒展与波折，都在同一段路上。",
      "这一卷借作品看生活的层次。读到哪一句有所触动，就在那里停一停，不必替自己安排唯一的样子。",
    ],
    historyTitle: "一段路，容得下不同天气",
    historyIntro: "与苏轼的文学相逢。",
    history: [
      {
        title: "吟啸，也有微凉",
        text: "《定风波》从途中遇雨写到回望，竹杖、芒鞋与酒醒后的微冷都留在词里。徐行并不抹去波折，感到微凉也不妨碍继续走路。",
      },
    ],
    blessing: "愿你走得从容，也如实照顾自己的冷暖。",
  },
  "tao-yuanming": {
    echo: "这一卷借陶渊明的日常诗境作参照，看看自己的节奏如何落在具体生活里。",
    opening: [
      "东篱、南山、暮色与归鸟，陶渊明把可细看的日常留在诗里。平常的景物，也可以有完整的意味。",
      "这一卷从作品中的小景开始。阅读不必急于归类，有时只是让一段专注的时间回到生活里。",
    ],
    historyTitle: "把目光放回可细看的日常",
    historyIntro: "与陶渊明的文学相逢。",
    history: [
      {
        title: "人境中的南山",
        text: "《饮酒·其五》既写人境与车马，也写采菊、南山与归鸟。诗中的安顿发生在具体处境里，并非要求所有人远离人群；它邀请读者重新留意身边的生活。",
      },
    ],
    blessing: "愿你在平常的日子里，有真正想投入的事。",
  },
  "mulan-ballad": {
    echo: "这一卷借《木兰诗》的远行与归来作参照，记得行动之外还有具体的生活。",
    opening: [
      "木兰是诗歌与传说中的人物。《木兰诗》既写关山远行，也写归家换装，让故事回到日常。",
      "这一卷从文学画面出发。可以读行路的节奏，也可以读归来的牵挂，无须把一种人物形象变成自己的全部。",
    ],
    historyTitle: "远行之外，还有归来",
    historyIntro: "与《木兰诗》的文学相逢。",
    history: [
      {
        title: "关山与旧时衣裳",
        text: "《木兰诗》把漫长行旅写得紧凑，也为归家换装留下鲜明场景。行动与归来共同构成人物形象；读到这里，也可以想想一段路之后，自己想回到怎样的生活。",
      },
    ],
    blessing: "愿你出发有方向，归来有自己的生活。",
  },
} as const;
const SECTION_COPY = {
  encounter: {
    title: "月下相逢",
    chapterLabel: "卷首 · 相逢",
    tocTitle: "相逢",
  },
  dimensions: {
    title: "你的五维心象",
    chapterLabel: "贰 · 心象",
    tocTitle: "心象",
    intro: "五条刻度，读的是选择方向。两端表示偏好，不作能力排名。",
  },
  patterns: {
    title: "你值得看见的部分",
    chapterLabel: "叁 · 同心",
    tocTitle: "同心",
    intro: "从具体情境里，看你如何探索、相处与行动。",
  },
  counterevidence: {
    title: "换一个情境，选择也会不同",
    chapterLabel: "肆 · 映照",
    tocTitle: "映照",
    intro: "差别有自己的来由，先看条件，再谈下一步。",
  },
  literature: {
    title: "人物与作品",
    chapterLabel: "伍 · 人物",
    tocTitle: "人物",
  },
  closure: {
    title: "把这一程，留给自己",
    chapterLabel: "陆 · 寄语",
    tocTitle: "寄语",
  },
} as const;
const DIMENSION_COPY = [
  {
    id: "axis-1",
    title: "守心 · 声音与关系",
    left: "共同选择时，你更靠近先协调彼此需要的一端。先把大家放进考虑，再形成自己的回应；这不表示没有主张。",
    middle:
      "你的刻度接近两端之间，暂不突出坚持自己或协调共同选择的单一方向。具体关系与共同承担的分量，仍值得分别看。",
    right:
      "共同选择时，你更靠近表达自身选择的一端。说清想保留的安排，也能让商量更具体；这不等于拒绝调整。",
    neutral: "表达自身选择与协调共同需要，是这条刻度的两端。",
  },
  {
    id: "axis-2",
    title: "寻远 · 新意与深耕",
    left: "你更靠近深入熟悉领域的一端。继续打磨已有兴趣，也是探索的一种尺度，不代表想象力不足。",
    middle:
      "你的刻度接近两端之间，尝新与深耕没有显著偏向一侧。可以结合兴趣的时间跨度，细看不同选择。",
    right:
      "你更靠近尝试陌生事物的一端，愿意给新经验一个入口。这只描述探索方向，不是创造力的高低。",
    neutral: "尝试陌生事物与深入熟悉领域，是两种不同的探索方向。",
  },
  {
    id: "axis-3",
    title: "知情 · 感受与事情",
    left: "帮助他人时，你更靠近先处理问题的一端。找出阻碍、提出办法，是你倾向的入口；不代表忽略感受。",
    middle:
      "你的刻度接近两端之间，先回应感受或先处理问题，没有明显偏向。对方此刻需要什么，仍要在交谈中确认。",
    right:
      "帮助他人时，你更靠近先回应感受的一端。先让话被听见，再考虑办法；这不等于情商或共情能力的评级。",
    neutral: "先回应感受与先处理问题，是帮助他人的两种入口。",
  },
  {
    id: "axis-4",
    title: "决断 · 思量与起步",
    left: "你更靠近先了解条件的一端，倾向让准备走在体验之前。这是起步方式，不等于行动慢或不够勇敢。",
    middle:
      "你的刻度接近两端之间，先体验与先了解条件没有明显偏向。任务的代价与可退出程度，仍会影响起步方式。",
    right:
      "你更靠近先行动体验的一端，倾向用实际接触了解情况。这不评价行动能力，也不意味着每次都适合立刻开始。",
    neutral: "先了解条件与先行动体验，是不同的起步方式。",
  },
  {
    id: "axis-5",
    title: "应变 · 保留与重排",
    left: "在活动安排变化时，你更靠近保留结构、局部调整的一端。先守住主体，再修补缺口；这不代表不能应对变化。",
    middle:
      "在活动安排变化时，你的刻度接近保留结构与整体重排之间。可以根据要保留的内容，决定调整范围。",
    right:
      "在活动安排变化时，你更靠近整体重新安排的一端。重看各部分的关系，是一种组织方式，不代表广义应变能力更强。",
    neutral: "保留结构、局部调整与整体重排，描述的是活动安排的调整范围。",
  },
] as const;
const QUIET_PATTERN =
  "文学里的相逢，可以从一句诗、一个细节开始。有人在山河间寻找远方，有人在日常中细读光阴；不同的生命各有自己的步调。读到动心处，不妨停一停，把此刻愿意留下的那句话，轻轻放回生活里。";
const QUIET_REFLECTION =
  "下一次需要作决定时，可以先问问自己：此刻最重要的是什么？留一个小范围，慢慢试走，也给回看留一点时间。";
const CLOSING_ROOM = "不必一次安排好全部，选一件此刻愿意做的小事就好。";
const CLOSING_NEUTRAL = "这一卷读到这里，接下来的故事由你落笔。";

const sameRef = (a: Ref, b: Ref) =>
  a.productId === b.productId && a.id === b.id && a.version === b.version;
export type QianzaiConsumerCopy = Readonly<{
  consumerEdition: true;
  consumerCopyVersion: typeof QIANZAI_CONSUMER_COPY_VERSION;
  sections: readonly Section[];
}>;
/** Known bound presentation only. Unknown source/role/version stays on the
 * existing snapshot path, rather than receiving invented personalized copy. */
export function qianzaiConsumerCopy(
  body: Body,
  result: QianzaiResultPresentation,
): QianzaiConsumerCopy | undefined {
  if (
    !qianzaiPresentationMatchesBody(body, result) ||
    result.profileVersion !== QIANZAI_PRESENTATION_V11 ||
    !qianzaiPresentationSourceMatches(body.provenance.canonicalContentSha256) ||
    result.source.canonicalContentSha256 !==
      body.provenance.canonicalContentSha256 ||
    result.source.inputHash !== body.provenance.inputHash ||
    result.source.answersHash !== body.provenance.answersHash ||
    result.source.matchingContextSha256 !==
      body.provenance.matchingContextSha256
  )
    return undefined;
  const role = QIANZAI_ROLE_PROFILES_V11.find((r) =>
    sameRef(r.ref, body.matching.selected.ref),
  );
  if (
    !role ||
    !sameRef(result.role.ref, role.ref) ||
    !sameConsumerFact(result.role, role, 65536) ||
    !Object.hasOwn(ROLE_COPY, role.ref.id) ||
    !role.quotes.some(
      (q) =>
        q.id === result.quote.id &&
        q.text === result.quote.text &&
        q.source === result.quote.source &&
        q.sourceUrl === result.quote.sourceUrl,
    )
  )
    return undefined;
  const copy = ROLE_COPY[role.ref.id as keyof typeof ROLE_COPY];
  const highlights = qianzaiSupportedThemes(body);
  const reflectionTopics = new Set<string>();
  const reflections = REFLECTION_SUPPORT.flatMap((spec) => {
    const snapshot = qianzaiSupportedParagraph(body, "counterevidence", spec);
    if (!snapshot || reflectionTopics.has(spec.copy)) return [];
    reflectionTopics.add(spec.copy);
    return [{ copy: REFLECTIONS[spec.copy], snapshot }];
  }).slice(0, 2);
  const block = (
    text: string,
    layout: QianzaiReportBlock["layout"] = "body",
    title?: string,
    snapshot?: Paragraph,
  ): QianzaiReportBlock => ({
    text,
    layout,
    ...(title ? { title } : {}),
    ...(snapshot ? { snapshot } : {}),
  });
  const sections: Section[] = [
    {
      id: "encounter",
      ...SECTION_COPY.encounter,
      blocks: highlights[0]
        ? [
            block(
              highlights
                .slice(0, 2)
                .map(({ feature }) => feature.seen)
                .join(""),
              "lead",
              undefined,
              highlights[0].snapshot,
            ),
            block(copy.echo),
          ]
        : copy.opening.map((p, i) => block(p, i === 0 ? "lead" : "body")),
    },
    {
      id: "dimensions",
      ...SECTION_COPY.dimensions,
      blocks: DIMENSION_COPY.map((p) => {
        const dimension = body.dimensions.find(
          (d) => d.dimensionRef.id === p.id,
        );
        const scale = dimension
          ? qianzaiDimensionScale(
              dimension,
              body.provenance.canonicalContentSha256,
            )
          : null;
        return block(scale ? p[scale.position] : p.neutral, "body", p.title);
      }),
    },
    {
      id: "patterns",
      ...SECTION_COPY.patterns,
      blocks: highlights.length
        ? highlights.map(({ feature, snapshot }) =>
            block(feature.text, "card", feature.title, snapshot),
          )
        : [block(QUIET_PATTERN)],
    },
    {
      id: "counterevidence",
      ...SECTION_COPY.counterevidence,
      blocks: reflections.length
        ? reflections.flatMap(({ copy, snapshot }) => [
            block(copy.text, "reflection-body", copy.title, snapshot),
            block(copy.suggestion, "prompt", "留给下一次"),
          ])
        : [block(QUIET_REFLECTION, "prompt", "留给下一次")],
    },
    {
      id: "literature",
      ...SECTION_COPY.literature,
      title: copy.historyTitle,
      intro: copy.historyIntro,
      blocks: [
        ...copy.history.map((p) => block(p.text, "timeline", p.title)),
        block(
          `作品参照：${[...new Set(role.quotes.map((q) => q.source))].join("；")}。`,
          "source",
        ),
      ],
    },
    {
      id: "closure",
      ...SECTION_COPY.closure,
      blocks: [
        block(CLOSING_NEUTRAL),
        block(CLOSING_ROOM),
        block(copy.blessing, "final-verse"),
      ],
    },
  ];
  return {
    consumerEdition: true,
    consumerCopyVersion: QIANZAI_CONSUMER_COPY_VERSION,
    sections,
  };
}
/** Complete compiled corpus for fixed font subsets; never contains answer text,
 * snapshots, scores or strings copied from a consumer session. */
export function qianzaiConsumerCopyText(): readonly string[] {
  const collect = (v: unknown): string[] =>
    typeof v === "string"
      ? [v]
      : Array.isArray(v)
        ? v.flatMap(collect)
        : v && typeof v === "object"
          ? Object.values(v).flatMap(collect)
          : [];
  return [
    ...collect(ROLE_COPY),
    ...qianzaiSupportedThemeText(),
    ...collect(REFLECTIONS),
    ...collect(SECTION_COPY),
    ...collect(DIMENSION_COPY),
    ...QIANZAI_ROLE_PROFILES_V11.flatMap((role) => [
      role.displayName,
      role.identitySubtitle,
      ...role.quotes.map((quote) => quote.source),
    ]),
    QUIET_PATTERN,
    QUIET_REFLECTION,
    CLOSING_ROOM,
    CLOSING_NEUTRAL,
    "作品参照：",
    "；",
    "。",
    "选择的方向",
    "留给下一次",
  ];
}
