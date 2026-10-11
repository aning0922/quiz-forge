import "server-only";
import { createHash } from "node:crypto";
import { canonicalP1Json } from "../../v1/canonical";

export const PERSISTENCE_UNICODE_POLICY = Object.freeze({
  schemaVersion: "quizpack-persistence-policy.v1",
  encoding: "UTF-8",
  nul: "reject",
  unpairedSurrogate: "reject",
  repair: false,
});
export const PERSISTENCE_UNICODE_POLICY_HASH = createHash("sha256")
  .update(canonicalP1Json(PERSISTENCE_UNICODE_POLICY), "utf8")
  .digest("hex");

export class EvidenceError extends Error {
  constructor(public readonly code: EvidenceFailureCode) {
    super("QuizPack evidence rejected.");
  }
}
export type EvidenceFailureCode =
  | "UNICODE_NUL"
  | "UNICODE_UNPAIRED_SURROGATE"
  | "REPORT_SCHEMA_INVALID"
  | "REPORT_SIZE_LIMIT"
  | "REPORT_BINDING_MISMATCH"
  | "EVIDENCE_SCHEMA_INVALID"
  | "EVIDENCE_METADATA_SIZE_LIMIT"
  | "EVIDENCE_REPORT_PAYLOAD_LIMIT"
  | "EVIDENCE_ENVELOPE_SIZE_LIMIT"
  | "INVALID_CANDIDATE";

/** Reject invalid UTF-16 without replacement, truncation, or input mutation. */
export function assertUnicodeString(value: string): void {
  for (let index = 0; index < value.length; index++) {
    const unit = value.charCodeAt(index);
    if (unit === 0) throw new EvidenceError("UNICODE_NUL");
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = value.charCodeAt(++index);
      if (!(next >= 0xdc00 && next <= 0xdfff))
        throw new EvidenceError("UNICODE_UNPAIRED_SURROGATE");
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      throw new EvidenceError("UNICODE_UNPAIRED_SURROGATE");
    }
  }
}

/** Canonical ordinary-JSON snapshot prevents accessors/proxies from executing. */
export function assertPersistenceUnicode(input: unknown): void {
  const value: unknown = JSON.parse(canonicalP1Json(input));
  const walk = (current: unknown): void => {
    if (typeof current === "string") assertUnicodeString(current);
    else if (current !== null && typeof current === "object") {
      for (const [key, child] of Object.entries(current)) {
        assertUnicodeString(key);
        walk(child);
      }
    }
  };
  walk(value);
}
