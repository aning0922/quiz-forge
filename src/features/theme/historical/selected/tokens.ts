import type { CSSProperties } from "react";
import { historicalAssets } from "../tokens";

/** One product language; reveal is a surface role, not a second theme. */
export const selectedHistoricalTheme = {
  id: "historical.folio-with-collection.v1",
  status: "directed-preview",
  paper: "#f3ebdd",
  ink: "#292d29",
  muted: "#585e52",
  jade: "#36594d",
  cinnabar: "#963f32",
  ornament: "#887044",
  stage: "#142f2e",
  stageMuted: "#c4ccbc",
  gold: "#dfc28a",
  displayFont: '"Historical Directed Serif", "Songti SC", "STSong", serif',
  enterMs: 320,
} as const;

export const selectedHistoricalStyle = {
  "--h-surface": selectedHistoricalTheme.paper,
  "--h-ink": selectedHistoricalTheme.ink,
  "--h-muted": selectedHistoricalTheme.muted,
  "--h-jade": selectedHistoricalTheme.jade,
  "--h-accent": selectedHistoricalTheme.cinnabar,
  "--h-gold": selectedHistoricalTheme.ornament,
  "--h-display": selectedHistoricalTheme.displayFont,
  "--hv-stage": selectedHistoricalTheme.stage,
  "--hv-stage-muted": selectedHistoricalTheme.stageMuted,
  "--hv-gold": selectedHistoricalTheme.gold,
  "--hv-enter": `${selectedHistoricalTheme.enterMs}ms`,
} as CSSProperties;

/** Only fixed project references are resolvable; artwork/commercial approval remains pending. */
export function findConceptPortrait(assetId: string) {
  if (assetId !== "historical.li-bai.concept") return null;
  return {
    src: historicalAssets.character,
    alt: "李白艺术化概念立绘：米白长袍、青绿内衫，手持竹卷",
  };
}
