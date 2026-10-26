import { describe, expect, it } from "vitest";
import type { QuizPackValidationReport } from "../../v1/api";
import { buildQuizPack, createStoredArchive } from "../../v1/build";
import { createSyntheticFixture } from "../../v1/fixtures/synthetic";
import { PACK_LIMITS } from "../../v1/limits";
import { hashBytes, validateQuizPack } from "../../v1/validate";
import { readRestrictedZip } from "../../v1/zip";
import {
  P1_UNVERIFIED,
  REPORT_SCHEMA_HASH,
  sealP1Report,
  serializeSealedReport,
} from "./report";
import {
  assertPersistenceUnicode,
  EvidenceError,
  PERSISTENCE_UNICODE_POLICY_HASH,
} from "./unicode";

const hash = "a".repeat(64);
export function syntheticReport(): QuizPackValidationReport {
  return {
    schemaVersion: "quizpack-validation.v1",
    targetProductId: "synthetic-product",
    validatorVersion: "1.0.0",
    policyId: "quizpack-local-p1.v1",
    archiveSha256: hash,
    contentSha256: hash,
    manifestSha256: hash,
    compatibilityPolicyHash: hash,
    effectiveLimitsHash: hash,
    checks: {
      container: "passed",
      structure: "passed",
      references: "passed",
      integrity: "passed",
      media: "passed",
      compatibility: "passed",
    },
    candidateValid: true,
    importable: false,
    publishable: false,
    issues: [],
    issuesTruncated: false,
    unverified: [...P1_UNVERIFIED],
  };
}
describe("strict P1 report persistence evidence", () => {
  it("seals an oversized question collection rejection before parsing its invalid elements", async () => {
    const fixture = await createSyntheticFixture("dimensions");
    const targetProductId = fixture.content.product.productId;
    const built = await buildQuizPack(
      {
        packId: "synthetic-pack",
        packVersion: "1.0.0",
        content: fixture.content,
        assets: fixture.assets,
      },
      { targetProductId },
    );
    if (!built.ok) throw new Error("Synthetic baseline build rejected.");
    const source = async function* (bytes: Uint8Array) {
      yield bytes;
    };
    const zip = await readRestrictedZip(source(built.value.archive), {
      targetProductId,
    });
    if (!zip.ok) throw new Error("Synthetic baseline ZIP rejected.");
    const files = new Map(zip.value.files);
    const content = JSON.parse(files.get("content.json")!.toString());
    content.questions = Array.from({ length: 102 }, () =>
      structuredClone(content.questions[0]),
    );
    content.questions[101].prompt = 123;
    const contentBytes = Buffer.from(JSON.stringify(content));
    files.set("content.json", contentBytes);
    const manifest = JSON.parse(files.get("manifest.json")!.toString());
    const declaration = manifest.files.find(
      (file: { path: string }) => file.path === "content.json",
    );
    declaration.bytes = contentBytes.length;
    declaration.sha256 = hashBytes(contentBytes);
    files.set("manifest.json", Buffer.from(JSON.stringify(manifest)));
    const archive = await createStoredArchive(
      [...files].map(([path, bytes]) => ({ path, bytes })),
      PACK_LIMITS.archiveBytes,
      new AbortController().signal,
    );
    const report = await validateQuizPack(source(archive), { targetProductId });
    expect(report.checks).toMatchObject({
      container: "passed",
      structure: "failed",
      media: "not-run",
    });
    expect(
      report.issues.some(
        (issue) =>
          issue.code === "CONTENT_STRUCTURE" &&
          JSON.stringify(issue.path) === '["questions"]',
      ),
    ).toBe(true);
    expect(report.issues.some((issue) => issue.path?.[1] === 101)).toBe(false);
    expect(sealP1Report(report).value.candidateValid).toBe(false);
  });
  it("copies and freezes report, storing its payload once", () => {
    const value = syntheticReport();
    const sealed = sealP1Report(value);
    value.checks.media = "failed";
    expect(sealed.value.checks.media).toBe("passed");
    expect(Object.isFrozen(sealed.value.checks)).toBe(true);
    expect(sealed).not.toHaveProperty("canonicalText");
    expect(Buffer.byteLength(serializeSealedReport(sealed))).toBe(
      sealed.canonicalBytes,
    );
    expect(REPORT_SCHEMA_HASH).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects unknown or oversized issue codes, extra fields and altered unverified", () => {
    for (const code of ["UNREVIEWED", "X".repeat(270000)]) {
      const value = syntheticReport();
      value.candidateValid = false;
      value.issues = [
        { code, path: [], message: "QuizPack operation rejected." },
      ];
      expect(() => sealP1Report(value)).toThrow(EvidenceError);
    }
    expect(() =>
      sealP1Report({ ...syntheticReport(), published: true }),
    ).toThrow(EvidenceError);
    expect(() =>
      sealP1Report({ ...syntheticReport(), unverified: [] }),
    ).toThrow(EvidenceError);
  });
  it("rejects success with a failed check, invalid path/message or more than 100 issues", () => {
    const value = syntheticReport();
    value.checks.media = "failed";
    expect(() => sealP1Report(value)).toThrow(EvidenceError);
    value.candidateValid = false;
    for (const issue of [
      {
        code: "MEDIA_DECODE_FAILED",
        path: Array(9).fill("resources"),
        message: "QuizPack operation rejected.",
      },
      { code: "MEDIA_DECODE_FAILED", path: [], message: "unreviewed text" },
    ]) {
      expect(() => sealP1Report({ ...value, issues: [issue] })).toThrow(
        EvidenceError,
      );
    }
    value.issues = Array.from({ length: 101 }, () => ({
      code: "MEDIA_DECODE_FAILED",
      path: [],
      message: "QuizPack operation rejected.",
    }));
    expect(() => sealP1Report(value)).toThrow(EvidenceError);
  });
  it("detects altered report hash or byte binding", () => {
    const sealed = sealP1Report(syntheticReport());
    expect(() =>
      serializeSealedReport({ ...sealed, sha256: "b".repeat(64) }),
    ).toThrow(EvidenceError);
    expect(() =>
      serializeSealedReport({
        ...sealed,
        canonicalBytes: sealed.canonicalBytes + 1,
      }),
    ).toThrow(EvidenceError);
  });
});
describe("persistence Unicode policy", () => {
  it("preserves Chinese and paired surrogates including keys", () => {
    expect(() =>
      assertPersistenceUnicode({ "中😀": "合法\t\n\r😀" }),
    ).not.toThrow();
    expect(PERSISTENCE_UNICODE_POLICY_HASH).toMatch(/^[a-f0-9]{64}$/);
  });
  it("rejects NUL and unpaired high/low surrogates anywhere", () => {
    for (const text of ["\0", "\ud800", "\udfff", "\ud800a", "a\udfff"]) {
      expect(() => assertPersistenceUnicode({ nested: [text] })).toThrow(
        EvidenceError,
      );
      expect(() => assertPersistenceUnicode({ [text]: "value" })).toThrow(
        EvidenceError,
      );
    }
  });
});
