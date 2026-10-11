import type { PackIssue, TrustedCompatibilityPolicy } from "./api";
import type { QuizPackManifest } from "./manifest";

/** Trusted parser contracts, not a rendering registry or approval list. */
export const DEFAULT_COMPATIBILITY_POLICY: TrustedCompatibilityPolicy =
  Object.freeze({
    contentSchemaVersions: Object.freeze(["quizpack-content.v1"]),
    engines: Object.freeze([
      Object.freeze({ id: "dimensions", version: "1.0.0" }),
      Object.freeze({ id: "archetype", version: "1.0.0" }),
    ]),
    components: Object.freeze(
      [
        "folio-cover",
        "folio-question",
        "folio-resume",
        "cabinet-result",
        "folio-report",
        "folio-poster",
      ].map((id) =>
        Object.freeze({ id, version: "1.0.0", propsSchemaVersion: "1.0.0" }),
      ),
    ),
  });
export function checkCompatibility(
  manifest: QuizPackManifest,
  policy: TrustedCompatibilityPolicy,
): PackIssue[] {
  const issues: PackIssue[] = [];
  if (!policy.contentSchemaVersions.includes(manifest.contentSchemaVersion))
    issues.push({
      code: "UNSUPPORTED_CONTENT_SCHEMA",
      path: ["contentSchemaVersion"],
      message: "Content schema is not supported by the trusted policy.",
    });
  if (
    !policy.engines.some(
      (engine) =>
        engine.id === manifest.engine.id &&
        engine.version === manifest.engine.version,
    )
  )
    issues.push({
      code: "UNSUPPORTED_ENGINE",
      path: ["engine"],
      message: "Engine contract is not supported by the trusted policy.",
    });
  manifest.components.forEach((component, i) => {
    if (
      !policy.components.some(
        (known) =>
          known.id === component.id &&
          known.version === component.version &&
          known.propsSchemaVersion === component.propsSchemaVersion,
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

/** P1 finite state capability contracts; renderer availability remains unverified. */
export const P1_STATE_COMPONENT_CONTRACTS = Object.freeze({
  cover: Object.freeze({
    id: "folio-cover",
    version: "1.0.0",
    propsSchemaVersion: "1.0.0",
  }),
  question: Object.freeze({
    id: "folio-question",
    version: "1.0.0",
    propsSchemaVersion: "1.0.0",
  }),
  resume: Object.freeze({
    id: "folio-resume",
    version: "1.0.0",
    propsSchemaVersion: "1.0.0",
  }),
  result: Object.freeze({
    id: "cabinet-result",
    version: "1.0.0",
    propsSchemaVersion: "1.0.0",
  }),
  report: Object.freeze({
    id: "folio-report",
    version: "1.0.0",
    propsSchemaVersion: "1.0.0",
  }),
  poster: Object.freeze({
    id: "folio-poster",
    version: "1.0.0",
    propsSchemaVersion: "1.0.0",
  }),
});
