import "server-only";
import { createHash } from "node:crypto";
import { z } from "zod";
import { sha256Schema } from "../../v1/manifest";
import { canonicalP1Json } from "../../v1/canonical";

const inputSchema = z.strictObject({
  archiveSha256: sha256Schema,
  canonicalManifestSha256: sha256Schema,
  canonicalContentSha256: sha256Schema,
  assetSetSha256: sha256Schema,
  identitySha256: sha256Schema,
});
export type CandidateHashInput = Readonly<z.infer<typeof inputSchema>>;
/** The sole candidate digest algorithm. It conveys neither opaque issuance nor IO/approval authority. */
export function computeCandidateSha256(input: CandidateHashInput): string {
  const value = inputSchema.parse(input);
  return createHash("sha256")
    .update(
      canonicalP1Json({
        schemaVersion: "quizpack-candidate-hash.v1",
        archiveSha256: value.archiveSha256,
        canonicalManifestSha256: value.canonicalManifestSha256,
        canonicalContentSha256: value.canonicalContentSha256,
        assetSetSha256: value.assetSetSha256,
        identitySha256: value.identitySha256,
      }),
      "utf8",
    )
    .digest("hex");
}
