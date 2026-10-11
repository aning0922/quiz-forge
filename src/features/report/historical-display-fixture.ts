import { historicalReportFixture } from "./historical-fixture";
import { historicalAtlasFixture } from "./historical-atlas-fixture";
import { historicalVisualCopyFixture } from "./historical-visual-copy";
import { getStudyInscription } from "./historical-inscriptions";
import type { HistoricalDisplayBundle } from "./historical-poster-view";

/** One fixed presentation source for D1-C reveal/report/poster. Never calculated from answers. */
export const historicalDisplayFixture: HistoricalDisplayBundle = {
  displayId: "historical-d1c-display.v1",
  report: historicalReportFixture,
  atlas: historicalAtlasFixture,
  copy: historicalVisualCopyFixture,
  inscription: getStudyInscription("classical"),
};
