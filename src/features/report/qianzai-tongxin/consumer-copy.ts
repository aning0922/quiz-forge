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
  "qianzai-consumer-copy.v2" as const;
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
    historyTitle: "词人小传 · 李清照",
    historyIntro: "词作、金石与南渡，展开词人的不同侧面。",
    history: [
      {
        title: "词中的旧游与梦境",
        text: "《如梦令》保存溪亭日暮、回舟与藕花的旧游画面，《渔家傲》又把梦境推向云涛星河。细微的游兴与辽阔的想象，共同构成她词作的不同声调。",
      },
      {
        title: "与赵明诚共治金石",
        text: "李清照在《金石录后序》中记述，婚后与赵明诚搜集书画、碑刻与古器，并共同勘校书籍。收藏不只是陈列，也包含查考、整理与反复阅读。",
      },
      {
        title: "南渡之后的记录",
        text: "南渡过程中，李清照经历藏品散失与生活变迁。《金石录后序》回望收藏的聚散，留下个人亲历的记录，也让后人看见作品之外的具体人生。",
      },
    ],
    sourceNote:
      "纪年用通行约数；收藏与南渡经历据本人《金石录后序》，词作据《如梦令》《渔家傲》。画面为艺术想象，不是历史肖像。",
    historySources: [
      {
        label: "杭州政协：李清照（1084—约1155、号易安居士）",
        url: "https://www.hzzx.gov.cn/hzzx/content/2010-10/26/content_5139226.htm",
      },
      {
        label: "李清照《金石录后序》",
        url: "https://zh.wikisource.org/wiki/金石錄後序_(李清照)",
      },
      {
        label: "李清照《如梦令·常记溪亭日暮》",
        url: "https://zh.wikisource.org/zh-hans/如夢令_(李清照)/如夢令_(常記溪亭日暮)",
      },
      {
        label: "李清照《渔家傲》",
        url: "https://zh.wikisource.org/zh-hans/漁家傲_(李清照)",
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
    historyTitle: "诗仙小传 · 李白",
    historyIntro: "游历、入京与诗名，串起诗人的一段人生。",
    history: [
      {
        title: "游历山河",
        text: "李白曾游历各地，山水与见闻进入他的诗篇。《庐山谣》里的名山江流、《关山月》中的长风关山，都展现了开阔的诗境。",
      },
      {
        title: "长安岁月",
        text: "唐玄宗天宝元年（742年），李白奉召入长安，任翰林供奉，后来离京。仕途与远游交织，构成了他人生中的一段转折。",
      },
      {
        title: "诗名与作品",
        text: "李白的诗运用丰富的想象，后世称他为“诗仙”，诗文汇入《李太白集》。走近他的作品，可以读山河，也可以读诗人在具体处境中的声音。",
      },
    ],
    sourceNote:
      "人物事实参照故宫博物院“李白”词条；作品据《庐山谣》《关山月》原文。画面为艺术想象，不是历史肖像。",
    historySources: [
      {
        label: "故宫博物院：李白（纪年、字号、游历、翰林供奉、诗名）",
        url: "https://www.dpm.org.cn/lemmas/240150.html",
      },
      {
        label: "李白《庐山谣寄卢侍御虚舟》",
        url: "https://zh.wikisource.org/wiki/廬山謠寄盧侍御虛舟",
      },
      {
        label: "李白《关山月》",
        url: "https://zh.wikisource.org/wiki/關山月_(李白)",
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
    historyTitle: "人物小传 · 苏轼",
    historyIntro: "从仕宦迁转与多种创作，认识东坡。",
    history: [
      {
        title: "入仕与迁转",
        text: "苏轼于1057年中进士，后来历任密州、徐州、湖州等地官职。此后又经历贬谪与起用，仕宦迁转与各地生活构成了他人生的重要背景。",
      },
      {
        title: "黄州与词赋",
        text: "苏轼曾贬居黄州。《定风波》的题序记下沙湖道中遇雨，《前赤壁赋》则从江上泛舟展开问答。风雨、江月与身世之思，在不同文体中各有写法。",
      },
      {
        title: "诗文之外的书画",
        text: "苏轼兼擅诗词、文章、书法与绘画，传世书迹有《黄州寒食诗帖》等。文字与笔墨之外，不能忽略他曾经历的具体波折；“旷达”也不是他唯一的面貌。",
      },
    ],
    sourceNote:
      "人物事实参照故宫博物院“苏轼”词条；作品据《定风波》《前赤壁赋》原文。画面为艺术想象，不是历史肖像。",
    historySources: [
      {
        label: "故宫博物院：苏轼（纪年、字号、仕宦、书画）",
        url: "https://www.dpm.org.cn/lemmas/242068.html",
      },
      {
        label: "苏轼《定风波·莫听穿林打叶声》及题序",
        url: "https://zh.wikisource.org/wiki/定風波_(莫聽穿林打葉聲)",
      },
      {
        label: "苏轼《前赤壁赋》",
        url: "https://zh.wikisource.org/wiki/前赤壁賦",
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
    historyTitle: "人物小传 · 陶渊明",
    historyIntro: "从仕与归、田园与文章，走近诗人的生活。",
    history: [
      {
        title: "彭泽与归去",
        text: "《归去来兮辞》序记载，陶渊明曾因家贫求仕，任彭泽令，在官八十余日后辞去。返归田园并非抽象的姿态，也与当时的生活处境相连。",
      },
      {
        title: "日常写入诗中",
        text: "《饮酒·其五》从人境中的居处写起，写到东篱采菊、南山暮色与归鸟。诗里既有眼前可见的景物，也有对生活的思考，不只是远离人群的想象。",
      },
      {
        title: "文章中的桃花源",
        text: "《桃花源记》写渔人偶入桃花源、离开后难以再寻的故事。诗歌之外，陶渊明也以散文铺展理想生活的文学想象，留下不同的阅读入口。",
      },
    ],
    sourceNote:
      "纪年用通行约数；经历与作品据《归去来兮辞》序、《饮酒·其五》《桃花源记》。画面为艺术想象，不是历史肖像。",
    historySources: [
      {
        label: "国新办中国关键词：陶渊明（约365—427）",
        url: "https://english.scio.gov.cn/m/featured/chinakeywords/2024-08/30/content_117397297.htm",
      },
      {
        label: "威海纪检监察网：陶渊明（生年异说、名潜、字元亮）",
        url: "https://www.jjjc.gov.cn/art/2020/9/17/art_30784_2389742.html",
      },
      {
        label: "《陶渊明集》卷五《归去来辞并序》",
        url: "https://zh.wikisource.org/wiki/陶淵明集/卷五",
      },
      {
        label: "《陶渊明集》卷三《饮酒》其五",
        url: "https://zh.wikisource.org/wiki/陶淵明集/卷三",
      },
      {
        label: "《陶渊明集》卷六《桃花源记》",
        url: "https://zh.wikisource.org/wiki/陶淵明集/卷六",
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
    historyTitle: "人物小传 · 木兰",
    historyIntro: "这里讲述《木兰诗》中的人物经历，不作实证传记。",
    history: [
      {
        title: "军帖与代父出征",
        text: "《木兰诗》从织布与叹息写起，随后写到军帖征兵、父亲名列其中。木兰决定备办鞍马，代父出征；这是诗歌与传说中的故事起点。",
      },
      {
        title: "关山与长年行旅",
        text: "黄河、燕山、关山与铁衣，将漫长的行军和征战压进鲜明的诗句。作品既写远行，也通过与家人的声音相隔，写出行旅中的牵挂。",
      },
      {
        title: "还乡与旧时衣裳",
        text: "故事中，木兰不愿担任尚书郎，请求回到故乡，归家后换回旧时衣裳。战场之外，归来与日常同样构成这一文学人物的完整形象。",
      },
    ],
    sourceNote:
      "故事据佚名《木兰诗》（《木兰辞》）。木兰以文学与传说人物参与匹配；画面为艺术想象，不据此编造生卒与历史履历。",
    historySources: [
      {
        label: "佚名《木兰诗》（《木兰辞》）",
        url: "https://zh.wikisource.org/wiki/木蘭辭",
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
type Theme = ReturnType<typeof qianzaiSupportedThemes>[number]["feature"];
/** Suggestions follow an accepted theme; they do not assert another observed trait. */
const LIFE_CONTEXT = {
  尝试新意:
    "生活里，可以给一件感兴趣的新事留半小时试走，记下想继续还是先放下。一次体验不必立刻变成长久承诺，具体感受会比空想更有参照。",
  深耕与探索:
    "如果眼前的练习与长期的新方向同时出现，不妨分开安排：给熟悉的技艺保留固定时间，再为新方向做一次小范围接触，看看两条路怎样接上。",
  稳中尝新:
    "想为熟悉的兴趣添一点变化时，可以只换一种材料、一个步骤或一种表达。保留喜欢的部分，再观察这一处新做法是否值得继续。",
  分清步调:
    "面对一场短期体验与一项长期计划，可以分别写下准备投入的时间、何时回看、怎样退出。分清决定的分量，起步就不必使用同一个速度。",
  表达主张:
    "共同安排出行或分工时，可以先说明自己想保留什么、理由是什么，再问对方哪里有困难。把可调整的部分也说出来，商量才有具体落点。",
  兼顾彼此:
    "碰到共同计划，不妨把“自己想保留的”与“可以商量的”各写一项。听完彼此的理由再决定，不必把每次协调都理解成坚持或让步的输赢。",
  先听感受:
    "朋友倾诉时，可以先让对方把话说完，再问现在更需要有人陪着听，还是一起找办法。确认了需要，后续的帮助就更容易贴近当下。",
  因境关照:
    "合作卡住或朋友来求助时，可以先确认：眼下最急的是处理具体阻碍，还是把感受说清？把需要问明白，再选择靠近的方式，能少一些善意的错位。",
  先行体验:
    "面对可以撤回的小任务，不妨先试十分钟，再看哪些信息因此变得清楚。也给自己约一个停下检查的时点，让起步与调整相互接上。",
  按事起步:
    "报名体验或启动计划前，可以先问：做错了能否退出，需要付出多少代价？容易撤回的先小试，代价较大的多确认一步，让准备与行动各得其时。",
  重整安排:
    "活动次序被打乱时，可以先列出必须保留的主体，再重排其余环节。确认最先要动的一步，重新组织就不必等同于把已有准备全部推翻。",
  按境调整:
    "遇到日程变化，可以比较两种办法：只补一处缺口，或重排整体，各需要多少时间与协作？从足以解决眼前问题的范围开始，观察是否还要继续调整。",
} as const satisfies Record<Theme["tag"], string>;
const CLOSING_BY_TOPIC = {
  exploration: [
    "让真正想投入的事，在日常里有一个位置。",
    "尝新与深耕不必争先，合适的步调可以因事而变。",
    "从一次小体验或一段专注练习开始。",
  ],
  voice: [
    "让自己的声音清楚，也让彼此听得见。",
    "一次商量不必决定所有事，重要的与可调整的可以分开。",
    "从一次说清与听清的小商量开始。",
  ],
  care: [
    "把愿意关照人的认真，留在下一次交谈里。",
    "听见感受与处理事情，可以分先后，不必二选一。",
    "从一句“现在更希望我怎么陪你”开始。",
  ],
  action: [
    "让起步落在具体的一小步里。",
    "先体验或先准备，要看代价与能否退出。",
    "下一次开始前，给自己约一个回看的时点。",
  ],
  change: [
    "让需要保留的主体，在变化中仍有位置。",
    "局部调整与整体重排，都要放回具体条件里看。",
    "先定一项要保留的，再改动一处。",
  ],
} as const satisfies Record<Theme["topic"], readonly [string, string, string]>;
const NEUTRAL_CLOSING = [
  "这一卷不替你定下结论，先留一个与自己相处的时刻。",
  "不妨问问：此刻最想照顾的是什么，又有什么可以暂缓？",
  "选一件十分钟能开始的小事，做过以后再回看感受。",
] as const;
const QUIET_PATTERN =
  "文学里的相逢，可以从一句诗、一个细节开始。先不急着把它变成自己的标签，不妨问问：哪一句让自己愿意多停留一会儿？把那一刻记下来，看看它与今天的生活有什么关系。";
const QUIET_REFLECTION =
  "遇到一个选择时，可以先问问：是还缺一条信息，还是此刻需要休息？先补一个能确认的细节，或把决定缩小到可以尝试的范围，不急着用一种说法概括自己。";

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
            block(
              `${feature.text}\n\n${LIFE_CONTEXT[feature.tag]}`,
              "card",
              feature.title,
              snapshot,
            ),
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
        block(
          [role.lifespan, role.courtesyName].filter(Boolean).join("\n"),
          "lead",
          role.displayName,
        ),
        ...copy.history.map((p) => block(p.text, "timeline", p.title)),
        block(copy.sourceNote, "source"),
      ],
    },
    {
      id: "closure",
      ...SECTION_COPY.closure,
      blocks: (highlights[0]
        ? CLOSING_BY_TOPIC[highlights[0].feature.topic]
        : NEUTRAL_CLOSING
      ).map((text, i) => block(text, i === 2 ? "final-verse" : "body")),
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
    ...Object.values(ROLE_COPY).flatMap((role) =>
      collect([
        role.echo,
        role.opening,
        role.historyTitle,
        role.historyIntro,
        role.history,
        role.sourceNote,
      ]),
    ),
    ...qianzaiSupportedThemeText(),
    ...collect(REFLECTIONS),
    ...collect(SECTION_COPY),
    ...collect(DIMENSION_COPY),
    ...collect(LIFE_CONTEXT),
    ...collect(CLOSING_BY_TOPIC),
    ...NEUTRAL_CLOSING,
    ...QIANZAI_ROLE_PROFILES_V11.flatMap((role) => [
      role.displayName,
      role.identitySubtitle,
      ...(role.lifespan ? [role.lifespan] : []),
      ...(role.courtesyName ? [role.courtesyName] : []),
      ...role.quotes.map((quote) => quote.source),
    ]),
    QUIET_PATTERN,
    QUIET_REFLECTION,
    "作品参照：",
    "；",
    "。",
    "选择的方向",
    "留给下一次",
  ];
}
