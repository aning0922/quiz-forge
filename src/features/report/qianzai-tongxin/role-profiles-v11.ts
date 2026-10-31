import { qianzaiRolePresentation } from "./role-presentation";
import type { QianzaiReportPresentation } from "./presentation";

export const QIANZAI_PRESENTATION_V11 =
  "qianzai-role-presentation.v1.1" as const;
export const QIANZAI_V11_CONTENT_SHA256 =
  "e81fad61f2258e44ba58fe84fda12fedccfb0d7517e97546010f4fa35cfbe767";
export type QianzaiRoleProfileV11 = Readonly<{
  ref: Readonly<{ productId: string; id: string; version: string }>;
  displayName: string;
  honorific: string;
  aliasSeal?: readonly string[];
  identitySubtitle: string;
  tags: readonly string[];
  posterTagline: string;
  posterTags: readonly string[];
  invitation: string;
  baseLines: readonly [string, string];
  closureLines: readonly [string, string];
  history: NonNullable<QianzaiReportPresentation["history"]>;
  lifespan?: string;
  courtesyName?: string;
  quotes: readonly Readonly<{
    id: string;
    text: string;
    source: string;
    sourceUrl: string;
  }>[];
}>;
const ref = (id: string) => ({
  productId: "qianzai-tongxin",
  id,
  version: "1.0.0",
});
const literaryHistory = (
  title: string,
  timeline: readonly Readonly<{ title: string; text: string }>[],
  sourceNote: string,
) => ({ title, timeline, sourceNote });
const liBai = qianzaiRolePresentation(ref("li-bai"))!;
/** Frozen editorial candidates for this experience, not a new author/content approval.
 * Ancient excerpts retain attribution. Source URLs are provenance, never fetched by the renderer.
 * Traditional source text is transcribed in simplified characters for the existing SC font. */
export const QIANZAI_ROLE_PROFILES_V11: readonly QianzaiRoleProfileV11[] = [
  {
    ref: ref("li-bai"),
    displayName: "李白",
    honorific: "诗仙",
    aliasSeal: ["青莲", "居士"],
    identitySubtitle: "与你同心的，是心向山河的那份自由",
    tags: ["浪漫", "自由", "想象力", "真性情"],
    posterTagline: "诗意长存",
    posterTags: ["山河", "明月", "诗意"],
    invitation: "愿山河远行，仍有自己的诗意。",
    baseLines: [
      "愿你走过山河，仍愿抬头看月亮。",
      "愿这一程相逢，留住自己的诗意。",
    ],
    closureLines: ["山河有尽", "同心无涯"],
    history: liBai.history,
    lifespan: "701—762 · 唐代诗人",
    courtesyName: "字太白 · 号青莲居士",
    quotes: [
      {
        id: "li-bai-lushan",
        text: "我本楚狂人，凤歌笑孔丘。",
        source: "李白《庐山谣寄卢侍御虚舟》",
        sourceUrl: "https://zh.wikisource.org/wiki/廬山謠寄盧侍御虛舟",
      },
      {
        id: "li-bai-guanshan",
        text: "长风几万里，吹度玉门关。",
        source: "李白《关山月》",
        sourceUrl: "https://zh.wikisource.org/wiki/關山月_(李白)",
      },
    ],
  },
  {
    ref: ref("su-shi"),
    displayName: "苏轼",
    honorific: "东坡",
    aliasSeal: ["东坡", "居士"],
    identitySubtitle: "与你同心的，是风雨途中仍可吟啸的心意",
    tags: ["烟火", "旷达", "诗文", "多面"],
    posterTagline: "风雨徐行",
    posterTags: ["风雨", "吟啸", "人间"],
    invitation: "愿风雨经过，也容得下一声吟啸。",
    baseLines: [
      "愿你途经风雨，也有徐行的余地。",
      "让一餐一景，留下自己的回声。",
    ],
    closureLines: ["风雨有时", "人间可亲"],
    history: literaryHistory(
      "从作品走近东坡",
      [
        {
          title: "沙湖道中",
          text: "《定风波》以途中遇雨为起点，写到同行的狼狈，也写雨后转晴。",
        },
        {
          title: "吟啸徐行",
          text: "吟啸、竹杖与芒鞋，是这首词里行路的具体画面，并非永远轻松的人生。",
        },
        {
          title: "多面心绪",
          text: "词中也有酒醒后的微冷。阅读东坡，可以同时看见舒展与处境中的波折。",
        },
      ],
      "引诗与情境据苏轼《定风波·莫听穿林打叶声》；本页角色介绍与寄语为体验候选。",
    ),
    quotes: [
      {
        id: "su-shi-xuxing",
        text: "何妨吟啸且徐行。",
        source: "苏轼《定风波·莫听穿林打叶声》",
        sourceUrl: "https://zh.wikisource.org/wiki/定風波_(莫聽穿林打葉聲)",
      },
      {
        id: "su-shi-guiqu",
        text: "归去，也无风雨也无晴。",
        source: "苏轼《定风波·莫听穿林打叶声》",
        sourceUrl: "https://zh.wikisource.org/wiki/定風波_(莫聽穿林打葉聲)",
      },
    ],
  },
  {
    ref: ref("tao-yuanming"),
    displayName: "陶渊明",
    honorific: "田园诗人",
    aliasSeal: ["五柳", "先生"],
    identitySubtitle: "与你同心的，是把日子安放在自己节奏里的心意",
    tags: ["田园", "日常", "自然", "自得"],
    posterTagline: "心远自得",
    posterTags: ["东篱", "南山", "日常"],
    invitation: "愿自己的节奏，照见日常山光。",
    baseLines: [
      "愿你在人间日常，留一处安放心意。",
      "让一草一木，也值得慢慢相认。",
    ],
    closureLines: ["心有所安", "日常有光"],
    history: literaryHistory(
      "从诗句走近陶渊明",
      [
        {
          title: "结庐人境",
          text: "《饮酒·其五》从人境与车马写起，讨论身在日常之中如何安放心意。",
        },
        {
          title: "东篱南山",
          text: "采菊、南山、暮色与归鸟，组成诗中可细读的生活画面。",
        },
        {
          title: "不作标签",
          text: "这些诗句是文学阅读的入口，不能据此把人物或读者都概括为永远远离人群。",
        },
      ],
      "引诗据陶渊明《饮酒·其五》，参照《古今图书集成·草木典·菊部艺文》收录文本；介绍与寄语为体验候选。",
    ),
    quotes: [
      {
        id: "tao-jian-nanshan",
        text: "采菊东篱下，悠然见南山。",
        source: "陶渊明《饮酒·其五》",
        sourceUrl:
          "https://zh.wikisource.org/wiki/欽定古今圖書集成/博物彙編/草木典/第091卷",
      },
      {
        id: "tao-feiniao",
        text: "山气日夕佳，飞鸟相与还。",
        source: "陶渊明《饮酒·其五》",
        sourceUrl:
          "https://zh.wikisource.org/wiki/欽定古今圖書集成/博物彙編/草木典/第091卷",
      },
    ],
  },
  {
    ref: ref("li-qingzhao"),
    displayName: "李清照",
    honorific: "易安",
    aliasSeal: ["易安", "居士"],
    identitySubtitle: "与你同心的，是细读光阴也敢向云涛的心意",
    tags: ["细读", "记忆", "游兴", "想象"],
    posterTagline: "词心有光",
    posterTags: ["溪亭", "云涛", "词心"],
    invitation: "愿细微心意，也能向云涛展开。",
    baseLines: [
      "愿你珍惜细微心意，也抬眼看远方。",
      "让这一程相逢，留住自己的声音。",
    ],
    closureLines: ["光阴可记", "词心自明"],
    history: literaryHistory(
      "从词作走近李清照",
      [
        {
          title: "溪亭旧游",
          text: "《如梦令》写日暮、回舟与误入藕花深处，保存了一段鲜活的游兴。",
        },
        {
          title: "云涛记梦",
          text: "《渔家傲》展开云涛、星河与千帆的梦境，又写风鹏与三山。",
        },
        {
          title: "不止离愁",
          text: "这两首词提供不同的阅读入口。人物作品不必收缩为单一的情绪标签。",
        },
      ],
      "引诗据李清照《如梦令·常记溪亭日暮》《渔家傲·天接云涛连晓雾》；介绍与寄语为体验候选。",
    ),
    quotes: [
      {
        id: "li-qingzhao-xiting",
        text: "常记溪亭日暮，沉醉不知归路。",
        source: "李清照《如梦令·常记溪亭日暮》",
        sourceUrl:
          "https://zh.wikisource.org/zh-hans/如夢令_(李清照)/如夢令_(常記溪亭日暮)",
      },
      {
        id: "li-qingzhao-fengpeng",
        text: "九万里风鹏正举。",
        source: "李清照《渔家傲·天接云涛连晓雾》",
        sourceUrl: "https://zh.wikisource.org/zh-hans/漁家傲_(李清照)",
      },
    ],
  },
  {
    ref: ref("mulan-ballad"),
    displayName: "木兰",
    honorific: "巾帼",
    identitySubtitle: "与你同心的，是在自己的选择里走过关山的心意",
    tags: ["关山", "行旅", "归来", "自主"],
    posterTagline: "关山有归",
    posterTags: ["行旅", "归来", "心意"],
    invitation: "愿你走过关山，也照顾好归路。",
    baseLines: [
      "愿你走过关山，也有自己的归路。",
      "把每一次选择，交还给此刻的自己。",
    ],
    closureLines: ["关山可越", "归路在心"],
    history: literaryHistory(
      "在作品中认识木兰",
      [
        {
          title: "代父从军",
          text: "木兰以文学与传说人物参与本轮匹配。《木兰诗》讲述她代父从军的故事。",
        },
        {
          title: "关山行旅",
          text: "诗中以万里赴戎机、关山度若飞写行旅，不等于一份关于读者能力的证明。",
        },
        {
          title: "归来故乡",
          text: "战袍、旧时衣裳与归家场景同时构成故事；人物并不只有单一的战斗形象。",
        },
      ],
      "引句据佚名《木兰诗》（《木兰辞》）；不是木兰本人创作的诗。介绍与寄语为体验候选。",
    ),
    quotes: [
      {
        id: "mulan-guanshan",
        text: "万里赴戎机，关山度若飞。",
        source: "佚名《木兰诗》",
        sourceUrl: "https://zh.wikisource.org/wiki/樂府詩集/卷25",
      },
      {
        id: "mulan-huahuang",
        text: "当窗理云鬓，对镜贴花黄。",
        source: "佚名《木兰诗》（贴字本）",
        sourceUrl:
          "https://zh.wikisource.org/zh-hant/白話文學史/第七章_南北新民族的文學",
      },
    ],
  },
];
function freeze<T>(value: T): T {
  if (value && typeof value === "object") {
    for (const child of Object.values(value)) freeze(child);
    Object.freeze(value);
  }
  return value;
}
freeze(QIANZAI_ROLE_PROFILES_V11);

/** Fixed reading guides, not score bands, personality conclusions or new summaries. */
export const QIANZAI_AXIS_GUIDES_V11 = Object.freeze({
  "axis-1":
    "守心记录表达自身选择与协调共同选择的方向；两端都不代表原则或道德高低。",
  "axis-2":
    "寻远记录陌生尝试与深入已有兴趣的方向；它不是创造力或想象力的能力评级。",
  "axis-3":
    "知情记录先回应感受或先处理问题的方向；它不等于情商、共情能力或冷暖程度。",
  "axis-4":
    "决断记录先体验或先了解条件的方向；它不等于勇敢程度，也不评价行动能力。",
  "axis-5":
    "应变只解释本轮活动重组情境：整体重排或保留结构、局部调整；现有证据不足以概括广义应变能力。",
});
