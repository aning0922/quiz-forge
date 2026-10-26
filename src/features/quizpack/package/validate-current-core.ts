import type {
  SupportedCoreExecution,
  SupportedCoreSelection,
  SupportedValidationContext,
} from "./api";
import {
  CURRENT_COMPATIBILITY_HASH,
  CURRENT_COMPATIBILITY_POLICY,
  CURRENT_POLICY_ID,
  CURRENT_REPORT_VERSION,
  CURRENT_VALIDATOR_VERSION,
} from "./current-compatibility";
import { runValidationCore, createValidationReport } from "./internal-core";
import { parseSupportedPack, assertSelection } from "./manifest";
import { validateSupportedPackReferences } from "./references";
import { snapshotSupportedContext, contextTarget } from "./context";
import { checkCurrentCompatibility as checkCompatibility } from "./current-compatibility";
export function validateCurrentQuizPackCore(
  source: AsyncIterable<Uint8Array>,
  context: SupportedValidationContext,
  execution: SupportedCoreExecution,
  selection: SupportedCoreSelection,
) {
  let failure: unknown;
  let safe;
  try {
    assertSelection(selection);
    safe = snapshotSupportedContext(context);
  } catch (error) {
    failure = error;
    safe = { targetProductId: contextTarget(context) };
  }
  return runValidationCore(
    source,
    safe,
    {
      execute: (work) => {
        if (failure) throw failure;
        return execution.execute(work);
      },
      checkpoint: (s) => execution.checkpoint(s),
      readZip: (i, c) => execution.readZip(i, c),
      inspect: (...args) => execution.inspect(...args),
      beforeStructure: (m, c) => execution.beforeStructure?.(m, c),
      parsed: (p, f) => execution.parsed?.(p, f),
      propagate: (e, r, a) => execution.propagate(e, r, a),
    },
    {
      report: createValidationReport(
        contextTarget(context),
        CURRENT_REPORT_VERSION,
        CURRENT_VALIDATOR_VERSION,
        CURRENT_POLICY_ID,
      ),
      snapshot: (value) => {
        const bounded = snapshotSupportedContext(value),
          original = snapshotSupportedContext(safe);
        for (const key of Object.keys(
          bounded.limits,
        ) as (keyof typeof bounded.limits)[])
          if (bounded.limits[key] > original.limits[key])
            throw Error("Trusted execution raised requested limits");
        return {
          context: bounded,
          compatibilityHash: CURRENT_COMPATIBILITY_HASH,
        };
      },
      parse: (manifest, content) =>
        parseSupportedPack(manifest, content, selection),
      references: validateSupportedPackReferences,
      compatibility: (pack) => {
        const p = CURRENT_COMPATIBILITY_POLICY.profiles.find(
          (p) => p.contentSchemaVersion === pack.contentSchemaVersion,
        )!;
        return checkCompatibility(pack.manifest, {
          contentSchemaVersions: [p.contentSchemaVersion],
          engines: CURRENT_COMPATIBILITY_POLICY.engines,
          components: Object.values(p.states).map((id) => ({
            id,
            version: p.componentVersion,
            propsSchemaVersion: p.propsSchemaVersion,
          })),
        });
      },
      consumeTruncation: true,
    },
  );
}
