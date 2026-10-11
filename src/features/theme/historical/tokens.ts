/** Exploratory visual values; these are not a released ThemeDefinition or registry. */
export const directions = ["folio", "cabinet"] as const;
export const states = ["cover", "portrait"] as const;
export type HistoricalDirection = (typeof directions)[number];
export type HistoricalStudyState = (typeof states)[number];

export const historicalStudies = {
  folio: {
    name: "东方人物志",
    number: "01",
    label: "THE ORIENTAL FOLIO",
    surface: "#f3ebdd",
    ink: "#292d29",
    muted: "#585e52",
    accent: "#963f32",
    jade: "#36594d",
    gold: "#887044",
    recipe: "historical.folio.exploration-v1",
  },
  cabinet: {
    name: "青金藏品卡",
    number: "02",
    label: "THE JADE COLLECTION",
    surface: "#142f2e",
    ink: "#f3ebdd",
    muted: "#c4ccbc",
    accent: "#dfc28a",
    jade: "#264743",
    gold: "#dfc28a",
    recipe: "historical.cabinet.exploration-v1",
  },
} as const;

export const historicalAssets = {
  character: "/assets/themes/historical/d1a/li-bai-concept.webp",
  landscape: "/assets/themes/historical/d1a/jade-landscape.webp",
} as const;
