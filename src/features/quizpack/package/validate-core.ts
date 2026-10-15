import type {
  SupportedCoreSelection,
  ValidateSupportedQuizPackCore,
} from "./api";
import {
  SUPPORTED_COMPATIBILITY_HASH,
  SUPPORTED_COMPATIBILITY_POLICY,
  SUPPORTED_POLICY_ID,
  SUPPORTED_REPORT_VERSION,
  SUPPORTED_VALIDATOR_VERSION,
} from "./compatibility";
import { contextTarget, snapshotSupportedContext } from "./context";
import { runValidationCore, createValidationReport } from "./internal-core";
import { assertSelection, parseSupportedPack } from "./manifest";
import { validateSupportedPackReferences } from "./references";
import { checkCompatibility } from "../v1/compatibility";

export const validateSupportedQuizPackCore: ValidateSupportedQuizPackCore = (
  source,
  context,
  execution,
  selection,
) => {
  let fixedSelection: SupportedCoreSelection = { kind: "backend-matrix" };
  let failure: unknown;
  let safeContext;
  try {
    assertSelection(selection);
    fixedSelection =
      selection.kind === "backend-matrix"
        ? { kind: "backend-matrix" }
        : {
            kind: "expected-version",
            expectedContentVersion: selection.expectedContentVersion,
          };
    safeContext = snapshotSupportedContext(context);
  } catch (error) {
    failure = error;
    safeContext = { targetProductId: contextTarget(context) };
  }
  return runValidationCore(
    source,
    safeContext,
    {
      ...execution,
      execute: (work) => {
        if (failure) throw failure;
        return execution.execute(work);
      },
    },
    {
      report: createValidationReport(
        contextTarget(context),
        SUPPORTED_REPORT_VERSION,
        SUPPORTED_VALIDATOR_VERSION,
        SUPPORTED_POLICY_ID,
      ),
      snapshot: (value) => {
        const bounded = snapshotSupportedContext(value);
        const original = snapshotSupportedContext(safeContext);
        for (const key of Object.keys(
          bounded.limits,
        ) as (keyof typeof bounded.limits)[]) {
          if (bounded.limits[key] > original.limits[key])
            throw new Error("Trusted execution raised requested limits");
        }
        return {
          context: bounded,
          compatibilityHash: SUPPORTED_COMPATIBILITY_HASH,
        };
      },
      parse: (manifest, content) =>
        parseSupportedPack(manifest, content, fixedSelection),
      references: validateSupportedPackReferences,
      compatibility: (pack) => {
        const profile = SUPPORTED_COMPATIBILITY_POLICY.profiles.find(
          (item) => item.contentSchemaVersion === pack.contentSchemaVersion,
        )!;
        // Structural declaration sharing does not narrow or reinterpret content.v2.
        return checkCompatibility(pack.manifest, {
          contentSchemaVersions: [profile.contentSchemaVersion],
          engines: SUPPORTED_COMPATIBILITY_POLICY.engines,
          components: Object.values(profile.states).map((id) => ({
            id,
            version: profile.componentVersion,
            propsSchemaVersion: profile.propsSchemaVersion,
          })),
        });
      },
      consumeTruncation: true,
    },
  );
};
