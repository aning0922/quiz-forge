import { createHash } from "node:crypto";
import { canonicalP1Json } from "../v1/canonical";

export const SUPPORTED_VALIDATOR_VERSION = "2.0.0";
export const SUPPORTED_POLICY_ID = "quizpack-local-supported.v1";
export const SUPPORTED_REPORT_VERSION = "quizpack-validation.v2";
export const SUPPORTED_IDENTITY_VERSION = "quizpack-validation-identity.v2";

const states = Object.freeze({
  cover: "folio-cover",
  question: "folio-question",
  resume: "folio-resume",
  result: "cabinet-result",
  report: "folio-report",
  poster: "folio-poster",
});
const kinds = Object.freeze(["synthetic", "authored"] as const);

/** Parser capability declarations only. No renderer or human approval is asserted. */
export const SUPPORTED_COMPATIBILITY_POLICY = Object.freeze({
  schemaVersion: "quizpack-supported-compatibility.v1" as const,
  containerSchemaVersion: "quizpack.v1" as const,
  engines: Object.freeze([
    Object.freeze({ id: "dimensions", version: "1.0.0" }),
    Object.freeze({ id: "archetype", version: "1.0.0" }),
  ]),
  profiles: Object.freeze([
    Object.freeze({
      contentSchemaVersion: "quizpack-content.v1" as const,
      contentKinds: kinds,
      componentVersion: "1.0.0" as const,
      propsSchemaVersion: "1.0.0" as const,
      states,
    }),
    Object.freeze({
      contentSchemaVersion: "quizpack-content.v2" as const,
      contentKinds: kinds,
      componentVersion: "2.0.0" as const,
      propsSchemaVersion: "1.0.0" as const,
      states,
    }),
  ]),
});

export const SUPPORTED_COMPATIBILITY_HASH = createHash("sha256")
  .update(canonicalP1Json(SUPPORTED_COMPATIBILITY_POLICY), "utf8")
  .digest("hex");
