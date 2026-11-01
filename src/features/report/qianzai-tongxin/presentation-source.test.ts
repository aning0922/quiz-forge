import { describe, expect, it } from "vitest";
import local from "@/features/quizpack/content/qianzai-local-art-fixture.json";
import {
  privateTestAssetMatches,
  registeredPrivateTestSource,
  PRIVATE_TEST_REGISTRATIONS,
} from "@/features/quizpack/content/private-test";
import { qianzaiPresentationFixture } from "./result-presentation.test-support";
import { deriveQianzaiResultPresentation } from "./result-presentation";
import { qianzaiPresentationSourceMatches } from "./presentation-source";
describe("local art fixture boundary", () => {
  it("preserves presentation for the exact new source without rewriting its sealed identity", async () => {
    const f = await qianzaiPresentationFixture();
    f.view.display.canonicalContentSha256 = local.canonicalContentSha256;
    f.body.provenance.canonicalContentSha256 = local.canonicalContentSha256;
    const original = JSON.stringify(f.body),
      p = deriveQianzaiResultPresentation(f.view, f.binding);
    expect(p?.source.canonicalContentSha256).toBe(local.canonicalContentSha256);
    expect(JSON.stringify(f.body)).toBe(original);
    f.body.provenance.canonicalContentSha256 = local.baseContentSha256;
    expect(deriveQianzaiResultPresentation(f.view, f.binding)).toBeNull();
    expect(qianzaiPresentationSourceMatches("a".repeat(64))).toBe(false);
  });
  it("accepts exact fixture image facts, rejects mutated facts, and never grants a source triple", () => {
    const r = local.resources[0]!;
    const a = {
      resourceRef: { productId: r.productId, id: r.id, version: r.version },
      sha256: r.sha256,
      bytes: r.bytes,
      width: r.width,
      height: r.height,
      mediaType: r.mediaType,
      purpose: r.purpose,
      approval: "private-test-only",
    };
    expect(privateTestAssetMatches(a)).toBe(true);
    for (const changed of [
      { ...a, sha256: "a".repeat(64) },
      { ...a, resourceRef: { ...a.resourceRef, id: "different" } },
      { ...a, width: a.width + 1 },
      { ...a, approval: "pending" },
    ])
      expect(privateTestAssetMatches(changed)).toBe(false);
    for (const old of PRIVATE_TEST_REGISTRATIONS)
      expect(
        registeredPrivateTestSource({
          productId: old.productId,
          canonicalContentSha256: local.canonicalContentSha256,
          assetSetSha256: old.assetSetSha256,
          canonicalManifestSha256: old.canonicalManifestSha256,
        }),
      ).toBeNull();
  });
});
