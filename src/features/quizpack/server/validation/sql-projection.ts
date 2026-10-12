import "server-only";
import { parseFoundationJson } from "../../../../lib/foundation-json";
import { canonicalP1Json } from "../../v1/canonical";
import { projectEvidenceEnvelope, sealEvidenceEnvelope } from "./contracts";
import { freezeJson } from "./report";
import {
  assertPersistenceUnicode,
  assertUnicodeString,
  EvidenceError,
} from "./unicode";
import type { EvidenceSqlProjectionResult } from "./adapter-types";
/** SQL texts remain exact canonical UTF8 bytes; caller controls are measured, not declared. */
export function serializeEvidenceSqlProjection(
  input: unknown | null,
  attemptsControlText: string,
): EvidenceSqlProjectionResult {
  try {
    if (typeof attemptsControlText !== "string")
      throw new EvidenceError("EVIDENCE_SCHEMA_INVALID");
    assertUnicodeString(attemptsControlText);
    const bytes = Buffer.byteLength(attemptsControlText, "utf8");
    if (bytes > 8192) throw new EvidenceError("EVIDENCE_METADATA_SIZE_LIMIT");
    const controls = parseFoundationJson(attemptsControlText);
    assertPersistenceUnicode(controls);
    if (canonicalP1Json(controls) !== attemptsControlText)
      throw new EvidenceError("EVIDENCE_SCHEMA_INVALID");
    const projection =
      input === null
        ? {
            evidenceText: null,
            evidenceSha256: null,
            reportTexts: [],
            metadataText: null,
            measuredBytes: {
              envelope: 0,
              reportPayload: 0,
              metadata: 0,
              attemptControls: bytes,
            },
          }
        : projectEvidenceEnvelope(sealEvidenceEnvelope(input), bytes);
    return freezeJson({
      ok: true,
      value: { ...projection, attemptsControlText },
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      code:
        error instanceof EvidenceError ? error.code : "EVIDENCE_SCHEMA_INVALID",
    });
  }
}
