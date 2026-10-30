import { createHash } from "node:crypto";
import { canonicalP1Json } from "../v1/canonical";
import { SUPPORTED_COMPATIBILITY_POLICY } from "./compatibility";
import { CONTENT_COMPONENTS_V3 } from "@/lib/assessment-contract/presentation-v3";

export const CURRENT_VALIDATOR_VERSION = "3.0.0" as const;
export const CURRENT_POLICY_ID = "quizpack-local-supported.v2" as const;
export const CURRENT_REPORT_VERSION = "quizpack-validation.v3" as const;
export const CURRENT_IDENTITY_VERSION =
  "quizpack-validation-identity.v3" as const;
export const CURRENT_COMPATIBILITY_POLICY = Object.freeze({
  schemaVersion: "quizpack-supported-compatibility.v2",
  containerSchemaVersion: "quizpack.v1",
  engines: [
    ...SUPPORTED_COMPATIBILITY_POLICY.engines,
    { id: "archetype-l1", version: "1.0.0" },
  ],
  profiles: [
    ...SUPPORTED_COMPATIBILITY_POLICY.profiles,
    {
      contentSchemaVersion: "quizpack-content.v3",
      contentKinds: ["synthetic", "authored"],
      componentVersion: "1.0.0",
      propsSchemaVersion: "1.0.0",
      states: CONTENT_COMPONENTS_V3,
    },
  ],
} as const);
export const CURRENT_COMPATIBILITY_HASH = createHash("sha256")
  .update(canonicalP1Json(CURRENT_COMPATIBILITY_POLICY), "utf8")
  .digest("hex");
export function checkCurrentCompatibility(
  manifest: {
    contentSchemaVersion: string;
    engine: { id: string; version: string };
    components: readonly {
      id: string;
      version: string;
      propsSchemaVersion: string;
    }[];
  },
  policy: {
    contentSchemaVersions: readonly string[];
    engines: readonly { id: string; version: string }[];
    components: readonly {
      id: string;
      version: string;
      propsSchemaVersion: string;
    }[];
  },
) {
  const issues: import("../v1/api").PackIssue[] = [];
  if (!policy.contentSchemaVersions.includes(manifest.contentSchemaVersion))
    issues.push({
      code: "UNSUPPORTED_CONTENT_SCHEMA",
      path: ["contentSchemaVersion"],
      message: "Content schema is not supported by the trusted policy.",
    });
  if (
    !policy.engines.some(
      (e) =>
        e.id === manifest.engine.id && e.version === manifest.engine.version,
    )
  )
    issues.push({
      code: "UNSUPPORTED_ENGINE",
      path: ["engine"],
      message: "Engine contract is not supported by the trusted policy.",
    });
  manifest.components.forEach((c, i) => {
    if (
      !policy.components.some(
        (e) =>
          e.id === c.id &&
          e.version === c.version &&
          e.propsSchemaVersion === c.propsSchemaVersion,
      )
    )
      issues.push({
        code: "UNSUPPORTED_COMPONENT",
        path: ["components", i],
        message: "Component contract is not supported by the trusted policy.",
      });
  });
  return issues;
}
