import { describe, expect, it } from "vitest";
import historicalPlan from "../../../public/assets/themes/historical/asset-plan.json";
import sinsPlan from "../../../public/assets/themes/sins/asset-plan.json";
import animalsPlan from "../../../public/assets/themes/animals/asset-plan.json";
import { getTheme, pageStates, themes } from "./catalog";

describe("D0 theme direction boundary", () => {
  it("resolves only explicitly configured themes", () => {
    expect(getTheme("historical")?.name).toBe("历史人物匹配");
    for (const id of ["", "unknown", "__proto__", "HISTORICAL", "../sins"]) {
      expect(getTheme(id)).toBeUndefined();
    }
  });

  it("keeps all three briefs as directions with all five planned states", () => {
    expect(new Set(themes.map((theme) => theme.id)).size).toBe(3);
    for (const theme of themes) {
      expect(theme.status).toBe("direction-only");
      expect(Object.keys(theme.states).sort()).toEqual([...pageStates].sort());
    }
  });

  it("binds each brief to an explicitly pending asset plan without claiming approval", () => {
    const plans = [historicalPlan, sinsPlan, animalsPlan];
    for (const plan of plans) {
      const theme = getTheme(plan.themeId);
      expect(theme?.assetPackId).toBe(plan.packId);
      expect(plan.status).toBe("planning-only");
      expect(new Set(plan.assets.map((asset) => asset.id)).size).toBe(
        plan.assets.length,
      );
      for (const asset of plan.assets) {
        expect(asset.status).toBe("pending");
        expect(asset.path).toBeNull();
        expect(asset.licenseEvidence).toBeNull();
        expect(asset.approvedBy).toBeNull();
        if (asset.format !== "woff2") {
          expect(asset.dimensions).toHaveLength(2);
          expect(asset.dimensions?.every((value) => value > 0)).toBe(true);
          expect(asset.prompt).toBeTruthy();
        }
      }
    }
  });
});
