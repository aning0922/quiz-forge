import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import { prepareP2b3Source } from "./p2b3-fixture";
import { validateContentReferences } from "@/features/quizpack/v1/references";
import { quizPackManifestSchema } from "@/features/quizpack/v1/manifest";
import { quizPackContentSchema } from "@/features/quizpack/v1/content";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { computeCandidateSha256 } from "@/features/quizpack/server/validation/candidate-hash";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
describe("B3 SQL-only synthetic source fixture", () => {
  it.each([false, true])(
    "binds unique Product and exact hashes, large=%s",
    async (largeContent) => {
      const f = await prepareP2b3Source("p2b3-unique-source", { largeContent });
      const facts = f.candidate.facts;
      expect(quizPackContentSchema.safeParse(facts.content).success).toBe(true);
      const referenceIssues = validateContentReferences(
        quizPackManifestSchema.parse(facts.manifest),
        quizPackContentSchema.parse(facts.content),
        f.productId,
      );
      // A historical SQL snapshot may exceed today's raw-upload byte limit only.
      expect(referenceIssues.map((i) => i.code)).toEqual(
        largeContent ? ["CONTENT_FILE_DECLARATION"] : [],
      );
      expect(facts.content.product.productId).toBe(f.productId);
      expect(facts.canonicalContentSha256).toBe(
        hash(facts.canonicalContentText),
      );
      expect(facts.canonicalManifestSha256).toBe(
        hash(facts.canonicalManifestText),
      );
      expect(facts.assetSetSha256).toBe(hash(facts.assetSetText));
      expect(facts.candidateSha256).toBe(
        computeCandidateSha256({
          archiveSha256: f.archiveSha256,
          canonicalContentSha256: facts.canonicalContentSha256,
          canonicalManifestSha256: facts.canonicalManifestSha256,
          assetSetSha256: facts.assetSetSha256,
          identitySha256: f.identitySha256,
        }),
      );
      expect(
        facts.manifest.files.find((v) => v.path === "content.json")!.sha256,
      ).toBe(f.candidate.contentSha256);
      expect(f.result.evidence.report.status).toBe("sealed");
      if (f.result.evidence.report.status === "sealed") {
        expect(f.result.evidence.report.value.contentSha256).toBe(
          f.candidate.contentSha256,
        );
        expect(f.result.evidence.report.value.manifestSha256).toBe(
          f.candidate.manifestSha256,
        );
      }
      expect(
        canonicalP1Json(facts.content) === facts.canonicalContentText,
      ).toBe(true);
      const bodyBytes = Buffer.byteLength(facts.canonicalContentText);
      expect(bodyBytes > 1048576).toBe(largeContent);
      expect(bodyBytes).toBeLessThanOrEqual(2097152);
      if (largeContent)
        expect(
          Buffer.byteLength(
            JSON.stringify({
              canonicalContentText: facts.canonicalContentText,
            }),
          ),
        ).toBeGreaterThan(2097152);
      expect(Object.isFrozen(facts.content)).toBe(true);
    },
  );
});
