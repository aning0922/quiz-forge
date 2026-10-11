import { historicalReportFixture } from "./historical-fixture";
import type { HistoricalReportView } from "./historical-view";
import type { TemperamentInscription } from "./temperament-inscription";

/** Explicit layout stress content, never a newly matched person or calculated report. */
export const historicalArtLongReportFixture: HistoricalReportView = {
  ...historicalReportFixture,
  identity: {
    ...historicalReportFixture.identity,
    name: "长名样例",
    title: "向着远方寻找灵感与自由并珍视每次相逢的行路者",
  },
};

export const historicalArtLongInscriptionFixture: TemperamentInscription = {
  id: "v2b-layout-stress.original",
  kind: "original",
  lines: [
    "借一程山河与清风，写下心中未尽的远意，",
    "循满天星月与江水，珍藏此刻相逢的回声。",
  ],
  posterLine: "循满天星月与江水，珍藏此刻相逢的回声。",
  credit: "QuizForge · 排版压力样例",
  interpretation:
    "仅用于长文本视觉检查的原创拟古，非古诗引用，未进行动态匹配。",
};
