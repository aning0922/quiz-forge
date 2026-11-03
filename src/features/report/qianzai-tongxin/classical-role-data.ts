import type { QianzaiClassicalRoleProfile } from "./classical-edition";
import { qianzaiTenRoleArtRefs, qianzaiTenRoleRef } from "./ten-role-contract";

const journeySource = "https://zh.wikisource.org/wiki/西遊記/第014回";
const originSource = "https://zh.wikisource.org/wiki/西遊記/第001回";

/** First complete editorial handoff. Only this listed role is ready; the other
 * nine remain in the approved roster until their sourced copy is delivered.
 * Exact source admission, supported-theme selection and shared sections belong
 * to the trusted integration resolver, never this data module. */
export const QIANZAI_CLASSICAL_ROLE_DATA = [
  {
    profile: {
      ref: qianzaiTenRoleRef("sun-wukong"),
      displayName: "孙悟空",
      honorific: "行者",
      aliasSeal: ["齐天", "大圣"],
      sourceKind: "novel-original",
      sourceWork: "《西游记》原著人物",
      identitySubtitle: "从花果山到取经路，走近《西游记》的孙悟空。",
      tags: ["花果山", "求学", "行旅", "同行"],
      posterTagline: "山川有路",
      posterTags: ["山川", "行旅", "同行"],
      invitation: "山川未尽，行路自有新的认识。",
      baseLines: [
        "愿你出发时，看清眼前的一步。",
        "走到转弯处，也容得下重新商量。",
      ],
      closureLines: ["山川有路", "行而相知"],
      quotes: [
        {
          id: "sun-wukong-tudi",
          text: "我愿保你取经，与你做个徒弟。",
          source: "《西游记》第十四回 · 孙悟空语",
          sourceUrl: journeySource,
        },
        {
          id: "sun-wukong-faming",
          text: "我原有个法名，叫做孙悟空。",
          source: "《西游记》第十四回 · 孙悟空语",
          sourceUrl: journeySource,
        },
      ],
      history: {
        title: "原著人物 · 孙悟空",
        timeline: [
          {
            title: "花果山与水帘洞",
            text: "《西游记》第一回写石猴在花果山生活，与群猴循着溪水找到瀑布。他进入瀑布后的洞府，又返回招呼群猴，一处新发现由此成为共同的住处。",
          },
          {
            title: "离山求学",
            text: "第一回后半，猴王因对生死的疑问离开花果山，渡海寻师。辗转来到灵台方寸山后，他拜入菩提祖师门下，得到孙悟空这个名字。",
          },
          {
            title: "取经路上的行者",
            text: "第十四回中，孙悟空与唐僧相见，表示愿意护送取经。脱困后，他向刘伯钦致谢、收拾行李，再启行路；唐僧又称他为行者。故事从此进入与人同行的新阶段。",
          },
        ],
        sourceNote:
          "人物与情节据《西游记》第一、十四回，原句转写为简体；不是历史人物传记。画面为原著意象的艺术想象。",
      },
    } satisfies QianzaiClassicalRoleProfile,
    copy: {
      opening: [
        "与你相逢的，是《西游记》里的孙悟空。从花果山的溪流到离山求学，再到取经路上的行者，同一个人物经历着不同的相遇与选择。",
        "这一卷从原著中的几处细节开始：走向未知、说出自己的名字，也收拾行李与人同行。读到哪一处愿意停留，可以留给自己慢慢辨认。",
      ],
      echo: "这一卷借孙悟空的行旅作文学参照：出发有新的见闻，同行也带来新的相识。",
      historyIntro: "循着花果山、求学与取经路，读原著中的几个片段。",
      historySources: [
        { label: "《西游记》第一回", url: originSource },
        { label: "《西游记》第十四回", url: journeySource },
      ],
      /** These are literary parallels only. Integration appends a string after
       * the corresponding existing accepted theme, never from an axis score. */
      whyByTopic: {
        exploration:
          "孙悟空的故事里，有离开花果山、渡海寻师的行程。借这个片段，可以想到走向陌生时逐步认识新事物的过程；一次尝试与一段求学，各有自己的时间。",
        voice:
          "第十四回里，孙悟空说出自己已有的法名，也明确表示愿意护送取经。这个片段让自己的表达与共同的行程同时出现，给这一回的选择留下一处文学回声。",
        care: "孙悟空脱困后，先向刘伯钦道谢，再收拾行李随唐僧启程。原著中的同行，除了远处的目的地，也有眼前具体的人与需要照料的小事。",
        action:
          "从表示愿意同行，到收拾行李、背起行装，原著把启程写成一连串具体的动作。借这一段，可以回看决定怎样落到眼前的一步，而不必用神通衡量日常的自己。",
        change:
          "从独自寻师到与人同行，孙悟空的行程有了新的安排。这一处只借作活动重组的文学参照：哪些内容继续保留，哪些部分需要重新商量，要放回当时的具体条件里看。",
      },
      neutralWhy: [
        "这次相逢，可以先从花果山的溪流与取经路上的行李读起。人物故事提供了一处想象的入口，眼前的自己仍可以有许多不同的选择。",
        "不妨留下一句有感触的话，或记住一个愿意再读的片段。它与今天的生活有什么联系，可以在往后的经历里慢慢回答。",
      ],
      closing: [
        "山川还有远处，今天的一步也值得认真走过。",
        "想出发时，看看眼前需要准备什么；与人同行时，也留一处听见彼此的空隙。",
        "山川有路，行而相知。",
      ],
    },
    resourceRefs: qianzaiTenRoleArtRefs("sun-wukong"),
  },
] as const;

/** Fixed display corpus for A's font subset. Excludes selectors, resource IDs,
 * URLs and provenance labels; contains no answers or session-derived strings. */
export function qianzaiClassicalRoleText(): readonly string[] {
  const collect = (value: unknown): string[] =>
    typeof value === "string"
      ? [value]
      : Array.isArray(value)
        ? value.flatMap(collect)
        : value && typeof value === "object"
          ? Object.values(value).flatMap(collect)
          : [];
  return QIANZAI_CLASSICAL_ROLE_DATA.flatMap(({ profile, copy }) =>
    collect({
      ...profile,
      ref: undefined,
      sourceKind: undefined,
      quotes: profile.quotes.map(({ text, source }) => ({ text, source })),
      ...copy,
      historySources: copy.historySources.map(({ label }) => label),
    }),
  );
}
