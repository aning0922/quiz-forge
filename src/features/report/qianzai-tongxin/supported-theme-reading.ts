import type { ComposedReportBodyV1 } from "@/lib/assessment-contract/composed-report-v1";
import { qianzaiSupportedThemes } from "./supported-themes";

/** Opt-in editorial layer. The retained consumer-copy.v2 and sealed body are unchanged.
 * A new candidate's adapter owns the consumer copy identity and Web/PNG wiring. */
export const QIANZAI_EVIDENCE_READING_VERSION =
  "qianzai-evidence-reading.v1" as const;
type SupportedTheme = ReturnType<typeof qianzaiSupportedThemes>[number];
type Reading = Readonly<{
  choice: string;
  meaning: string;
  condition: string;
  nextStep: string;
}>;

/** Original prose for the existing qualified themes only. These conditional
 * suggestions add no observed trait, skill, historical analogy or new selector. */
const READING = {
  尝试新意: {
    choice: "在空闲体验与小作品的表达方式上，你都为陌生做法留了位置。",
    meaning: "在这些情境里，亲自接触是你愿意采用的探索入口。",
    condition:
      "作品的两种做法效果与用时相近；遇到长期承诺，还需另看投入和退出成本。",
    nextStep: "下次可挑一个小环节试新做法，做完记下哪些部分想继续。",
  },
  深耕与探索: {
    choice:
      "眼前的计划或技艺，你选择继续深入；生活稳定后的方向，你又愿意走向陌生。",
    meaning: "这两次选择的时间跨度不同，可以分别安排深耕与探索。",
    condition:
      "两条路若同时占用时间，新增的投入可能挤压已有练习，先看可用精力。",
    nextStep: "先保留一段原有练习时间，再给新方向安排一次短体验。",
  },
  稳中尝新: {
    choice:
      "小作品以熟悉做法为主，旅程也想重访旧地；另一情境里，你又选择了尝新。",
    meaning: "熟悉与新鲜分别出现在不同选择里，可以逐件看它们的位置。",
    condition: "想保留原有体验时，改动过多可能掩盖真正喜欢的部分。",
    nextStep: "下次只换一种材料或一段路线，做完比较这一处变化是否合意。",
  },
  分清步调: {
    choice: "轻巧的体验或作品尝试，与长期生活方向，你选了不同的熟悉程度。",
    meaning: "这里的差别落在投入的时间尺度上，还需按具体事情理解。",
    condition:
      "一次体验容易结束，长期投入会持续占用时间，两者需要分别确认承诺。",
    nextStep: "为眼前尝试和长期计划各写一个回看时点，再决定何时继续。",
  },
  表达主张: {
    choice: "共同选路与安排自己的新计划时，你都选择说清想走的方向。",
    meaning: "在路线条件相近、时间可兼顾的情境里，你愿意让自己的偏好进入商量。",
    condition:
      "这仍需要听见对方的顾虑；若花费、风险或相处时间变了，要重新协商。",
    nextStep: "下次先说一项想保留的安排及理由，再问对方最担心哪一点。",
  },
  兼顾彼此: {
    choice:
      "共同选路时，你先听同行者的理由；另一些安排里，你又保留了自己的方向。",
    meaning: "这些选择呈现了商量与主张的不同先后，还不能把差别归成固定性格。",
    condition:
      "先协调可能让自己的需要暂时不清楚；若大家都等对方表态，决定也可能拖住。",
    nextStep: "下次听完理由，再补一句自己想保留什么，并约定何时作决定。",
  },
  先听感受: {
    choice: "朋友谈疲惫与分享好消息时，你都选择先聊心情，再一起看办法或安排。",
    meaning: "在这些谈话里，感受是你选择的开场，后续仍留有处理事情的位置。",
    condition: "若出现明确期限或急需处理的后果，需要先确认哪些事情不能等待。",
    nextStep: "下次可问：现在想先聊一会儿，还是先处理一件最急的事？",
  },
  因境关照: {
    choice: "朋友遇到困扰时，你先找阻碍；换一个自责的情境，你又先陪他聊感受。",
    meaning: "帮助的开场随情境出现了差别，眼下只能据此讨论先后次序。",
    condition:
      "对方此刻需要什么，还要当面确认；凭自己的判断直接开场，可能接不上他的需要。",
    nextStep: "下次先问想一起理事情还是先说感受，再选一个入口。",
  },
  先行体验: {
    choice: "免费体验与可补救的小疏漏面前，你都选择先做一段，再检查细节。",
    meaning: "在可以停止或修正的情境里，行动是你取得具体信息的入口。",
    condition:
      "这两次选择都有回转余地；涉及难以撤回的承诺时，应先确认后果和边界。",
    nextStep: "下次可先试十分钟，并约好一个停下来检查的时点。",
  },
  按事起步: {
    choice:
      "在一些具体安排中，你先推进眼前的一步；面对一件想做很久的事，又选择先把整套规划想清楚。",
    meaning: "这里呈现的是不同任务下的起步差别，还需逐件看准备和行动各占多少。",
    condition:
      "完整规划需要时间，小试也有成本；先确认能否撤回，再决定准备到哪一步。",
    nextStep:
      "下次先写一个不能越过的边界，再选最小可试的一步或一项待确认条件。",
  },
  重整安排: {
    choice:
      "活动与资料顺序有变时，你选择重新组合；展示空间缩小时，又保留了主体位置。",
    meaning: "重排次序与保留主体可以同时出现，调整范围要放回具体安排看。",
    condition:
      "原情境里几种做法都来得及完成；若改动会增加协作成本，先确认谁需要配合。",
    nextStep: "下次先圈出必须保留的主体，再只重排最先受影响的一段。",
  },
  按境调整: {
    choice: "一次安排变化时你保留结构、补上缺口，另一次则重新组织整体。",
    meaning: "两种调整范围都出现在选择里，可以先比较眼前的问题需要改动多少。",
    condition: "整体重排会牵动更多环节；局部修补若仍解决不了问题，再扩大范围。",
    nextStep: "下次先列一项必须保留的内容，比较局部修改是否已经足够。",
  },
} as const satisfies Record<SupportedTheme["feature"]["tag"], Reading>;

export type QianzaiSupportedThemeReading = Reading &
  Readonly<{
    topic: SupportedTheme["feature"]["topic"];
    tag: SupportedTheme["feature"]["tag"];
    title: string;
    snapshot: SupportedTheme["snapshot"];
  }>;

/** Display only: uses the original accepted/full-ref/positive-and-counter support
 * gate, topic ordering and maximum of three. No role ID, scores or raw answer
 * text can select additional prose. An empty result leaves neutral to the caller. */
export function qianzaiSupportedThemeReading(
  body: ComposedReportBodyV1,
): readonly QianzaiSupportedThemeReading[] {
  return qianzaiSupportedThemes(body).map(({ feature, snapshot }) => ({
    topic: feature.topic,
    tag: feature.tag,
    title: feature.title,
    ...READING[feature.tag],
    snapshot,
  }));
}

/** Fixed corpus only; consumer answers and snapshot text never enter font inputs. */
export function qianzaiSupportedThemeReadingText(): readonly string[] {
  return Object.values(READING).flatMap(
    ({ choice, meaning, condition, nextStep }) => [
      choice,
      meaning,
      condition,
      nextStep,
    ],
  );
}
