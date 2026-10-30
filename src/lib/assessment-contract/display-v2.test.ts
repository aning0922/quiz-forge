import { expect, it } from "vitest";
import {
  displayCapabilitiesV2Schema,
  matchesDisplayCapabilitiesV2,
} from "./display-v2";
it("separates payload vocabulary from the fixed structured-only implementation capability", () => {
  const fixed = {
    presentationMode: "structured-only" as const,
    exports: { posterPng: false, fullReportPng: false },
  };
  const authored = {
    presentationMode: "authored-product" as const,
    exports: { posterPng: true, fullReportPng: true },
  };
  expect(displayCapabilitiesV2Schema.safeParse(authored).success).toBe(true);
  expect(
    displayCapabilitiesV2Schema.safeParse({
      ...fixed,
      exports: { posterPng: true, fullReportPng: false },
    }).success,
  ).toBe(false);
  expect(matchesDisplayCapabilitiesV2(fixed, fixed)).toBe(true);
  expect(matchesDisplayCapabilitiesV2(authored, fixed)).toBe(false);
});
