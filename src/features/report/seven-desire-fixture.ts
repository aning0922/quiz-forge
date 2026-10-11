import {
  prepareResultAtlas,
  referencedDimensions,
  type ResultAtlasView,
} from "./result-atlas";

/** Display vocabulary only; not a published scoring or QuizPack schema. */
export const sevenDesireDimensionIds = [
  "pride",
  "envy",
  "wrath",
  "sloth",
  "greed",
  "gluttony",
  "lust",
] as const;
export type SevenDesireDimensionId = (typeof sevenDesireDimensionIds)[number];

export interface SevenDesireStudyView {
  readonly kind: "synthetic-preview";
  readonly displayId: string;
  readonly source: "fixed-editorial-fixture";
  readonly disclosure: string;
  readonly identity: {
    readonly name: string;
    readonly title: string;
    readonly declaration: string;
    readonly archetypeId: SevenDesireDimensionId;
  };
  readonly atlas: ResultAtlasView;
  /** Fixed editorial references, never computed from answers or ranked scores. */
  readonly topDimensionIds: readonly SevenDesireDimensionId[];
  readonly traits: readonly string[];
  readonly relationships: readonly string[];
  readonly tensions: readonly string[];
  readonly strengths: readonly string[];
  readonly imbalances: readonly string[];
  readonly characterStory: string;
}

const scaleDescription =
  "独立的 0–100 合成展示刻度；各维不合计为 100，不是概率，也不代表善恶、健康或能力。";

export const sevenDesireFixture: SevenDesireStudyView = {
  kind: "synthetic-preview",
  displayId: "seven-desire.d1d.vili.synthetic.v1",
  source: "fixed-editorial-fixture",
  disclosure: "合成演示 · 非答题结论 · 娱乐性格测评，不作为心理诊断",
  identity: {
    name: "维璃",
    title: "镜曜执冠者",
    declaration: "看见自己的光，也为他人的光留一席。",
    archetypeId: "pride",
  },
  atlas: {
    kind: "synthetic",
    fixtureId: "seven-desire.d1d.atlas.synthetic.v1",
    dimensions: [
      {
        dimensionId: "pride",
        label: "傲慢 / Pride",
        normalizedScore: 88,
        interpretation:
          "以自我表达为幻想象征，描绘愿意让自己的声音被听见的叙事倾向。",
        lowLabel: "留在幕后",
        highLabel: "站到台前",
        scaleDescription,
        displayOrder: 0,
      },
      {
        dimensionId: "envy",
        label: "嫉妒 / Envy",
        normalizedScore: 54,
        interpretation:
          "以他人的光为幻想象征，描绘对比较、向往与自身期待的注意。",
        lowLabel: "沿自己的路",
        highLabel: "留意他人光芒",
        scaleDescription,
        displayOrder: 1,
      },
      {
        dimensionId: "wrath",
        label: "愤怒 / Wrath",
        normalizedScore: 66,
        interpretation: "以火焰为幻想象征，描绘面对摩擦时表达界限的叙事节奏。",
        lowLabel: "先缓一缓",
        highLabel: "即刻表达",
        scaleDescription,
        displayOrder: 2,
      },
      {
        dimensionId: "sloth",
        label: "怠惰 / Sloth",
        normalizedScore: 38,
        interpretation: "以静夜为幻想象征，描绘对停留、休息与慢节奏的偏好。",
        lowLabel: "向前探索",
        highLabel: "安静停留",
        scaleDescription,
        displayOrder: 3,
      },
      {
        dimensionId: "greed",
        label: "贪婪 / Greed",
        normalizedScore: 79,
        interpretation: "以藏品为幻想象征，描绘对积累、拥有与延续故事的兴趣。",
        lowLabel: "轻装而行",
        highLabel: "细心收藏",
        scaleDescription,
        displayOrder: 4,
      },
      {
        dimensionId: "gluttony",
        label: "暴食 / Gluttony",
        normalizedScore: 61,
        interpretation:
          "以盛宴为幻想象征，描绘对丰富感官体验与当下乐趣的兴趣。",
        lowLabel: "简约体验",
        highLabel: "丰盛体验",
        scaleDescription,
        displayOrder: 5,
      },
      {
        dimensionId: "lust",
        label: "心动与亲密 / Lust",
        normalizedScore: 72,
        interpretation:
          "以色欲的幻想象征转译心动与亲密，描绘对情感联结的向往，不涉及露骨内容。",
        lowLabel: "保留距离",
        highLabel: "靠近联结",
        scaleDescription,
        displayOrder: 6,
      },
    ],
  },
  topDimensionIds: ["pride", "greed", "lust"],
  traits: [
    "愿意留下鲜明的个人表达",
    "珍藏能延续故事的事物",
    "在联结中寻找回应",
  ],
  relationships: [
    "希望彼此都能被看见",
    "通过分享珍藏开启对话",
    "为靠近保留双方的选择",
  ],
  tensions: [
    "想被理解，也希望保持自己的节奏",
    "期待回应，也需要给沉默留出空间",
  ],
  strengths: ["把想法说得具体", "为共同经历留下记忆", "主动表达欣赏与邀请"],
  imbalances: [
    "当舞台占满视线时，可以问问还有谁未被听见",
    "当收藏越来越多时，可以选一件此刻真正想陪伴的事物",
  ],
  characterStory:
    "镜城每逢长夜便点亮七座灯塔。维璃守着其中一面旧镜，起初只想让它映出自己的冠冕。一次庆典里，她发现镜面也能折回远处细小的灯光，于是为尚未登台的人留出一席。她仍喜欢站在光里，只是收藏的故事渐渐有了更多名字。这是原创幻想角色故事，不描述参与者的真实经历或未来。",
};

export interface SevenDesireQuestionView {
  readonly id: string;
  readonly title: string;
  readonly options: readonly string[];
}

/** Seven representative layout scenes; no weights, matching or scoring rules. */
export const sevenDesireQuestions: readonly SevenDesireQuestionView[] = [
  {
    id: "mirror-stage",
    title: "镜城邀你在庆典上留下一个自己的印记，你愿意如何参与？",
    options: [
      "亲自介绍我的作品",
      "与同伴共同登台",
      "留下作品，让它自己说话",
      "先在观众席感受气氛",
    ],
  },
  {
    id: "other-light",
    title: "看见同行者得到期待已久的邀请时，你会怎样安放自己的向往？",
    options: [
      "向对方道贺，也记下自己的期待",
      "询问这次机会的故事",
      "回到自己正在走的路",
      "找朋友聊聊复杂的心情",
    ],
  },
  {
    id: "fire-boundary",
    title: "讨论中有人越过了你在意的边界，你更愿意怎样回应？",
    options: [
      "当场说清楚我的界限",
      "先确认彼此是否误解",
      "暂时离开，之后再谈",
      "邀请第三个人帮助沟通",
    ],
  },
  {
    id: "quiet-night",
    title: "长夜里多出一段自由时间，你会把它留给什么？",
    options: ["安静休息", "随意走走", "完成一个小计划", "与熟悉的人坐一会儿"],
  },
  {
    id: "archive-choice",
    title: "旅程结束时只能带回一件纪念物，你更愿意留下哪一种故事？",
    options: [
      "一件可以反复使用的器物",
      "与同伴共同挑选的纪念物",
      "一本还未读完的故事",
      "一张写着此刻心情的纸",
    ],
  },
  {
    id: "feast-table",
    title: "幻想宴席上出现许多新鲜体验，你想怎样度过这一晚？",
    options: [
      "每样尝试一点",
      "慢慢体验最感兴趣的一样",
      "与朋友分享发现",
      "挑一个安静角落欣赏现场",
    ],
  },
  {
    id: "invitation-letter",
    title:
      "一位相识不久的旅伴邀请你分享一段很长的夜间散步：你欣赏这份邀请，也希望彼此保留舒适的距离。如果可以先约定相处方式，你会怎样表达自己对心动、亲密与独处空间的期待？",
    options: [
      "坦诚告诉对方我很期待，同时说明今晚可以相处多久，让靠近有一个双方都能安心的节奏",
      "先从轻松的话题开始，在不急着定义关系的散步中慢慢了解彼此的偏好和界限",
      "邀请共同认识的朋友一起出发，让这次相处保留更多自在的选择，之后再决定是否单独见面",
      "感谢这份邀请，并提议换一个我更舒服的时间；我希望先留一点独处空间，再认真回应自己的心情",
    ],
  },
];

/** Presentation guard only. Reuses atlas bounds; never transforms or scores data. */
export function prepareSevenDesireStudy(
  view: SevenDesireStudyView,
): SevenDesireStudyView {
  const hasText = (value: unknown) =>
    typeof value === "string" && value.trim().length > 0;
  if (
    !view ||
    view.kind !== "synthetic-preview" ||
    view.source !== "fixed-editorial-fixture" ||
    !hasText(view.displayId) ||
    !hasText(view.disclosure) ||
    !view.disclosure.includes("合成") ||
    !view.disclosure.includes("娱乐性格测评") ||
    !view.disclosure.includes("不作为心理诊断") ||
    !view.identity ||
    ![view.identity.name, view.identity.title, view.identity.declaration].every(
      hasText,
    ) ||
    !sevenDesireDimensionIds.includes(view.identity.archetypeId) ||
    !view.atlas
  ) {
    throw new Error("Invalid seven-desire synthetic display");
  }
  const dimensions = prepareResultAtlas(view.atlas);
  if (
    dimensions.length !== sevenDesireDimensionIds.length ||
    dimensions.some(
      (dimension, index) =>
        dimension.dimensionId !== sevenDesireDimensionIds[index] ||
        dimension.displayOrder !== index,
    ) ||
    !Array.isArray(view.topDimensionIds) ||
    view.topDimensionIds.length !== 3
  ) {
    throw new Error("Invalid seven-desire display references");
  }
  referencedDimensions(view.atlas, view.topDimensionIds);
  if (
    ![
      view.traits,
      view.relationships,
      view.tensions,
      view.strengths,
      view.imbalances,
    ].every(
      (items) =>
        Array.isArray(items) && items.length > 0 && items.every(hasText),
    ) ||
    !hasText(view.characterStory)
  ) {
    throw new Error("Incomplete seven-desire narrative");
  }
  return view;
}
