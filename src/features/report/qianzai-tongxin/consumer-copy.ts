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

export const QIANZAI_CONSUMER_COPY_VERSION =
  "qianzai-consumer-copy.v1" as const;
type Paragraph = Body["volumes"][number]["paragraphs"][number];
type Section = QianzaiReportDocument["sections"][number];
type Ref = Body["matching"]["selected"]["ref"];
type Feature = Readonly<{
  topic: string;
  title: string;
  text: string;
  seen: string;
}>;
type Reflection = Readonly<{ title: string; text: string; suggestion: string }>;
/** Handwritten consumer prose. No snapshot sentence is trimmed or paraphrased at runtime. */
const FEATURES = {
  novel: {
    topic: "exploration",
    title: "给新的可能，留一扇窗",
    text: "新的经验和表达方式，给这段生活打开了一个入口。你愿意先靠近、亲自感受，再决定它要在日常里占多大的位置。让探索从可承受的一步开始，也能走得踏实。",
    seen: "看见你愿意为新经验打开一扇窗，也珍惜你认真辨认步调的心意。",
  },
  gradual: {
    topic: "exploration",
    title: "让新意，从小处发生",
    text: "你给新经验与新的表达方式留了位置。尝试可以从一个小细节开始，既保留熟悉的落脚点，也让生活有机会透进不同的光。",
    seen: "看见你为新意留下的位置，也珍惜你愿意亲自感受的心意。",
  },
  time: {
    topic: "exploration",
    title: "小处认真，远处也有光",
    text: "眼前的热爱值得继续深耕，往后的路也可以向陌生处展开。你把两种时间尺度分开看，让认真投入与探索新方向各有位置。起步之前，可以先想清哪一部分需要延续。",
    seen: "看见你对眼前事物的认真，也看见你给远方留下的想象。",
  },
  familiar: {
    topic: "exploration",
    title: "让熟悉的热爱继续生长",
    text: "熟悉又喜欢的事物，值得多停留一会儿。你也为新意保留了一条小路，让已有的热爱成为继续探索的落脚点。把新尝试放在一个细节里，就能慢慢看清是否适合自己。",
    seen: "看见你愿意珍惜熟悉的热爱，也珍惜你为新意保留的余地。",
  },
  scale: {
    topic: "exploration",
    title: "给不同的日子，不同的步调",
    text: "轻巧的尝试可以快一点，长久的投入可以慢一点。你对不同事情安排了不同的步调；先分清决定的分量，就不必催自己每次都用同一种方式回应。",
    seen: "看见你愿意辨认事情的分量，也给不同的日子留下不同的步调。",
  },
  voice: {
    topic: "voice",
    title: "自己的声音，也可以温和地说",
    text: "把方向说清楚，让别人有机会理解，也为共同的安排留下商量的空间。你在这些相处时刻愿意表达并说明理由；听完回应，再确认彼此最在意的部分，会让交谈更有落点。",
    seen: "看见你愿意把自己的方向说清楚，也珍惜你为交谈留下的空间。",
  },
  listening: {
    topic: "voice",
    title: "有主张，也有倾听的余地",
    text: "自己的安排需要一处位置，同行的人也需要被听见。你会随着关系与共同承担的分量调整先后。重要的交谈里，可以先说清自己想保留什么，再听听对方最在意什么。",
    seen: "看见你愿意守住心里的位置，也为同行的人留下倾听的余地。",
  },
  care: {
    topic: "care",
    title: "先让一份感受被听见",
    text: "先让一份感受被听见，能为交谈找到一个温和的起点。你在相处时愿意先聊心情；等情绪有了落脚点，再一起看接下来能做什么。",
    seen: "看见你愿意为感受留一张座位，也珍惜你靠近他人的心意。",
  },
  careBoth: {
    topic: "care",
    title: "在事情与心情之间，寻找入口",
    text: "你尝试从事情的阻碍与人的感受中，寻找不同的入口。需要帮忙时，可以先问一句：现在更想有人陪着听，还是一起找办法？让靠近多一点确认，就能少一点猜测。",
    seen: "看见你在事情与心情之间寻找入口，也珍惜你愿意靠近的认真。",
  },
  action: {
    topic: "action",
    title: "先走一小步，让路慢慢清楚",
    text: "你愿意先走一小步，让实际体验帮助自己看清下一步。起步能打开局面，途中也值得留一处回看的时点，看看细节有没有跟上。",
    seen: "看见你愿意先走一小步，也珍惜你让道路慢慢清楚的心意。",
  },
  deliberate: {
    topic: "action",
    title: "让轻重缓急，决定起步的方式",
    text: "先行动与先准备，可以各有适合的时刻。你对不同任务安排了不同的起步方式；先辨认事情的轻重，再选择当下合适的第一步。",
    seen: "看见你愿意辨认事情的轻重，也给行动与思量留下各自的位置。",
  },
  arrange: {
    topic: "change",
    title: "把散开的部分，重新安放",
    text: "安排被打乱时，你愿意重新梳理各部分的关系。重新安放需要时间，可以先找到最重要的中心，再让其他部分围绕它慢慢成形。",
    seen: "看见你愿意重新安放生活里的片段，也珍惜你认真调整的用心。",
  },
  range: {
    topic: "change",
    title: "改变的大小，可以因事而异",
    text: "补上缺口与重看整体，是两种不同大小的调整。你在具体的安排里用过不同方式；下一次可以先找出必须保留的中心，再决定其余部分需要改动多少。",
    seen: "看见你愿意具体辨认变化，也给保留与调整留下各自的理由。",
  },
} as const satisfies Record<string, Feature>;
const REFLECTIONS = {
  newChange: {
    title: "新鲜与变化，各有自己的分量",
    text: "想走向新的方向，与临时打乱安排时需要一点熟悉感，可以同时发生。把它们分开看，能让心里的迟疑多一点可理解的来处。",
    suggestion:
      "下次遇到变化时，先分清眼前是在探索方向，还是重排安排。各写下一件想保留的事和一件可以调整的事，再决定从哪里动手。",
  },
  newDirections: {
    title: "眼前与长远，都向新的方向开放",
    text: "眼前的一次尝试，与长久投入的方向，你都愿意走向陌生之处。两种时间尺度里的选择，都为新经验留了位置；这份开放，可以在一次次具体体验中慢慢展开。",
    suggestion:
      "下一次起步时，可以先划一个小范围，留一个回看的时点。也可以为自己保留一处熟悉的落脚点，让新的尝试有停下来整理的空间。",
  },
  time: {
    title: "给眼前与长远，留不同的速度",
    text: "一段轻巧的尝试，和一份准备长久投入的热爱，可以拥有不同的步调。让新意与熟悉各得其所，也是一种照看自己的方式。",
    suggestion:
      "为下一次新尝试划一个小范围，给它留一个可以回看的时点；同时把最想继续打磨的那件事，放回自己的日常。",
  },
  familiarNew: {
    title: "一处落脚点，也可以通向远方",
    text: "眼前可以回到熟悉之处，远处也可以出现新的方向。把两种时间尺度放在一起，心里的稳与新便有了共处的空间。",
    suggestion:
      "先问自己：此刻需要安顿的是什么，往后想探索的又是什么。各留一小步，让已有的热爱与新的可能慢慢接上。",
  },
  preserve: {
    title: "改变时，也照看想留下的部分",
    text: "你愿意重新安排眼前的片段，也愿意把长久的热爱留下。变化可以围绕重要的中心发生，让日常保有一处安稳的落脚点。",
    suggestion:
      "动手前，写下一项必须保留的中心，再圈出一项可以先调整的细节。让改变有边界，也给自己留一点熟悉感。",
  },
  deep: {
    title: "把深耕与新意，放在同一张纸上",
    text: "熟悉的技艺值得慢慢打磨，新意也可以从其中一处细节生长。眼前的安稳与日后的可能，都可以被认真照看。",
    suggestion:
      "给已有的热爱留一段不被打断的时间，再挑一个代价较小的细节试试新方法。不必急着改变全部。",
  },
  range: {
    title: "先看清中心，再决定改变多少",
    text: "有时补上缺口就够，有时需要重新看整体。调整的范围可以随着事情改变，也可以随着自己的余力慢慢展开。",
    suggestion:
      "下一次安排有变，先找出最重要的中心，再把其他部分分成可以沿用、可以重排两组。从最小的一处开始，看看是否已经足够。",
  },
} as const satisfies Record<string, Reflection>;

type Support = Readonly<{
  id: string;
  kind: Paragraph["kind"];
  positive: readonly string[];
  negative: readonly string[];
}>;
type HighlightSpec = Support & Readonly<{ copy: keyof typeof FEATURES }>;
type ReflectionSpec = Support & Readonly<{ copy: keyof typeof REFLECTIONS }>;

// Fixed support selectors copied from the existing composed template, not new scoring rules.
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
    echo: "易安的词把细微的感受与辽阔的想象放在同一张纸上。这场文学相逢，愿陪你珍惜眼前这份被看见的心意，也为往后的自己留一笔新的写法。",
    opening: [
      "与你相逢的，是把细微心绪写进词里的李清照。溪亭的日暮、回舟的游兴，和云涛星河的辽阔，都能在她的作品里相遇。一个人的世界，可以细腻，也可以开阔。",
      "这一卷想借她的词心，陪你慢慢看见自己：哪些心意值得珍惜，哪些地方可以稍稍松手，又有哪些可能，正等待一个不必着急的开始。",
    ],
    historyTitle: "在词里，与易安相望",
    historyIntro: "一位写得下溪亭晚照，也写得下海天云涛的词人。",
    history: [
      {
        title: "记住一段鲜活的光阴",
        text: "《如梦令·常记溪亭日暮》从日暮与归舟写起。溪亭、藕花和被惊起的水鸟，让一次旧游有了可以重温的声色。细读这些画面，也是在体会一份把日常记在心里的词心。",
      },
      {
        title: "抬眼看辽阔的天地",
        text: "《渔家傲·天接云涛连晓雾》把云涛、星河与千帆带入梦境。目光从眼前走向远处，想象也随之舒展。读这首词，可以看见易安作品里开阔而有力的一面。",
      },
      {
        title: "让细腻与开阔同时在场",
        text: "把这两首词放在一起，既能读到鲜活的游兴，也能读到向远方展开的想象。一个人的作品不必只有一种声调，细微的心绪，也可以与辽阔的天地相映。",
      },
    ],
    blessing: "愿你把细微心意珍藏，也让目光向云涛舒展。",
  },
  "li-bai": {
    echo: "李白的诗把山河与明月带向辽阔的想象。这场文学相逢，愿为眼前这份心意添一点诗意，也让下一步保有自己的方向。",
    opening: [
      "李白的诗里，有山河、有明月，也有从眼前走向远方的想象。这一卷借一束诗意作灯，陪你辨认此刻的心意。",
      "接下来的几页，想陪你看见值得珍惜的部分，也照看那些需要慢一点的时刻。你可以按自己的节奏，读一读与此刻相呼应的句子。",
    ],
    historyTitle: "在山河与诗句之间，走近李白",
    historyIntro: "从作品中的几幅画面，慢慢认识这一程的相逢。",
    history: [
      {
        title: "山河中的想象",
        text: "《庐山谣寄卢侍御虚舟》以鲜明的声音与辽阔的想象展开诗境。山水既是眼前的景，也为诗人的情意留下舒展的空间。",
      },
      {
        title: "长风与关山",
        text: "《关山月》写长风、明月与关山，把目光带向遥远的路途。阅读时，可以让自己在这些画面间停留，体会诗句的开阔与回声。",
      },
      {
        title: "把诗意带回日常",
        text: "走近李白，可以从一段山水、一轮明月或一次抬头开始。文学里的远方，也能为眼前的日子添一处想象的空间。",
      },
    ],
    blessing: "愿你走过山河，仍能为自己的日子留一点诗意。",
  },
  "su-shi": {
    echo: "东坡在风雨中的吟啸，也容得下酒醒后的微凉。这场文学相逢，愿陪你把眼前的认真安放好，也让生活有慢慢转晴的空间。",
    opening: [
      "苏轼的词里，既有风雨中的吟啸，也有酒醒后的微凉。舒展与波折，都能在同一段路途中被写下。这一卷借这样的目光，陪你读一读此刻的自己。",
      "接下来的几页，想陪你看见值得珍惜的部分，也为仍在犹豫的地方留一点转身的余地。日子可以慢慢过，心意也可以慢慢辨认。",
    ],
    historyTitle: "在一场风雨里，走近东坡",
    historyIntro: "从路上的具体画面，读到词中的不同心绪。",
    history: [
      {
        title: "沙湖道中",
        text: "《定风波·莫听穿林打叶声》以途中遇雨为起点，写同行的狼狈，也写雨后的转晴。天气的变化，让行路的画面有了不同的层次。",
      },
      {
        title: "吟啸与微凉",
        text: "竹杖、芒鞋、吟啸和酒醒后的微冷，一同留在词里。走近东坡，可以同时看见舒展的姿态与处境里的波折。",
      },
      {
        title: "一餐一景之间",
        text: "把这样的阅读带回日常，可以从留意眼前的一餐一景开始。给心绪一点停留的时间，也给生活留下自己的回声。",
      },
    ],
    blessing: "愿你途经风雨，仍有徐行与安顿自己的余地。",
  },
  "tao-yuanming": {
    echo: "东篱、南山与归鸟，让陶渊明的诗回到可以细看的日常。这场文学相逢，愿为眼前这份认真留一个位置，让自己的节奏慢慢生长。",
    opening: [
      "东篱南山、暮色归鸟，陶渊明把日常写得细而安静。这一卷从这些诗句起步，陪你看看心里想安放的事，也看看眼前可以珍惜的光。",
      "接下来的几页，想为值得看见的心意留一个位置，也让尚未想清的部分慢慢展开。自己的节奏，可以在日常里一点点辨认。",
    ],
    historyTitle: "在东篱与南山之间，走近陶渊明",
    historyIntro: "从日常的画面里，体会安放心意的几种可能。",
    history: [
      {
        title: "结庐人境",
        text: "《饮酒·其五》从人境与车马写起，把目光放回日常生活。诗里对于心意与处境的思索，也为阅读留下一处可以停驻的地方。",
      },
      {
        title: "东篱南山",
        text: "采菊、南山、暮色与归鸟，组成可以细读的生活画面。它们让一草一木与眼前的光阴，都有了被慢慢看见的机会。",
      },
      {
        title: "让日常有光",
        text: "阅读这些诗句，可以从留意身边的小景开始。自己的节奏并不需要很大的舞台，一段专注的时间，也能让心意有所安放。",
      },
    ],
    blessing: "愿你心有所安，也让日常的一草一木有光。",
  },
  "mulan-ballad": {
    echo: "《木兰诗》写关山远行，也写归来与日常。这场文学相逢，愿陪你照看行动背后的牵挂，也记得把自己的需要放进行囊。",
    opening: [
      "木兰是诗歌与传说中的人物。她的故事里，有远行关山，也有归家换装。这一卷从作品中的几幅画面起步，陪你读一读此刻与自己的相逢。",
      "接下来的几页，想陪你看见值得珍惜的部分，也给需要歇一歇的地方留出余地。行动、牵挂与归来，都可以在故事里被认真看见。",
    ],
    historyTitle: "在关山与归来之间，认识木兰",
    historyIntro: "从《木兰诗》的故事与画面，展开这一程的文学相逢。",
    history: [
      {
        title: "代父从军",
        text: "《木兰诗》讲述木兰代父从军的故事。它以文学与传说的方式流传，作品里的行动与牵挂，共同构成了这一人物形象。",
      },
      {
        title: "关山行旅",
        text: "万里赴戎机、关山度若飞，把漫长的行旅浓缩成鲜明的诗句。阅读时，可以体会叙事的节奏，也留意路途中与家人相连的心意。",
      },
      {
        title: "归来故乡",
        text: "战袍、旧时衣裳和归家换装的场景，让故事回到日常。远行之后的归来，同样是认识木兰时值得细读的一部分。",
      },
    ],
    blessing: "愿你走过关山，也记得照顾自己的归路。",
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
    intro: "把不同的步调放在一起，慢慢看见此刻的自己。",
  },
  patterns: {
    title: "你值得看见的部分",
    chapterLabel: "叁 · 同心",
    tocTitle: "同心",
    intro: "沿着相互呼应的心意，读几处值得珍惜的光。",
  },
  counterevidence: {
    title: "给生活留一点转身的余地",
    chapterLabel: "肆 · 映照",
    tocTitle: "映照",
    intro: "照看另一种步调，也给下一次行动留一点从容。",
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
    title: "守心 · 声音与关系",
    text: "表达自己的想法，也听见共同的需要。两端分别照见不同的相处步调。",
  },
  {
    title: "寻远 · 新意与深耕",
    text: "向陌生处试探，也在熟悉处继续打磨。不同的热爱，可以拥有不同的生长方式。",
  },
  {
    title: "知情 · 感受与事情",
    text: "先让感受被听见，或先把事情理清，都是与人靠近时可能走入的入口。",
  },
  {
    title: "决断 · 思量与起步",
    text: "先了解条件，或先走一小步，让准备与体验共同照看事情的展开。",
  },
  {
    title: "应变 · 保留与重排",
    text: "安排有变时，可以保留中心、调整局部，也可以重新看一看整体的关系。",
  },
] as const;
const QUIET_PATTERN =
  "文学里的相逢，可以从一句诗、一个细节开始。有人在山河间寻找远方，有人在日常中细读光阴；不同的生命各有自己的步调。读到动心处，不妨停一停，把此刻愿意留下的那句话，轻轻放回生活里。";
const QUIET_REFLECTION =
  "下一次需要作决定时，可以先问问自己：此刻最重要的是什么？留一个小范围，慢慢试走，也给回看留一点时间。";
const CLOSING_ROOM = "这一页只陪你照看此刻，往后的你仍有重新选择的余地。";
const CLOSING_NEUTRAL = "谢谢你给自己留下一段安静读卷的时间。";

const sameRef = (a: Ref, b: Ref) =>
  a.productId === b.productId && a.id === b.id && a.version === b.version;
/** Acceptance comes from the immutable engine body. We do not rerun claim gates
 * or scoring; selectors require the complete pinned support and current answers. */
function supported(
  body: Body,
  volume: "patterns" | "counterevidence",
  spec: Support,
): Paragraph | undefined {
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
  const copy = ROLE_COPY[role.ref.id as keyof typeof ROLE_COPY],
    topics = new Set<string>();
  const highlights = HIGHLIGHTS.flatMap((spec) => {
    const snapshot = supported(body, "patterns", spec),
      feature = FEATURES[spec.copy];
    if (!snapshot || topics.has(feature.topic)) return [];
    topics.add(feature.topic);
    return [{ feature, snapshot }];
  }).slice(0, 3);
  const reflectionTopics = new Set<string>();
  const reflections = REFLECTION_SUPPORT.flatMap((spec) => {
    const snapshot = supported(body, "counterevidence", spec);
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
              highlights[0].feature.seen,
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
      blocks: DIMENSION_COPY.map((p) => block(p.text, "body", p.title)),
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
        block(highlights[0]?.feature.seen ?? CLOSING_NEUTRAL),
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
    ...collect(FEATURES),
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
