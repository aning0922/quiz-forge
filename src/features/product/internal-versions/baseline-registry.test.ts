import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { canonicalOrdinaryJson } from "@/lib/json/canonical";
import { quizPackContentV2Schema } from "@/features/quizpack/content/v2";
import {
  baselineDescriptorSchema,
  findBaselineDescriptor,
  matchRegisteredBaseline,
} from "./baseline-registry";
import historical from "./baselines/historical-cabinet-2026-10-18.json";
import synthetic from "./baselines/synthetic-internal-version-v1.json";
const sha = (bytes: string | Buffer) =>
  createHash("sha256").update(bytes).digest("hex");
const source = (e: typeof historical | typeof synthetic) => ({
  productId: e.productId,
  canonicalContentSha256: e.canonicalContentSha256,
  assetSetSha256: e.assetSetSha256,
  canonicalManifestSha256: e.canonicalManifestSha256,
});
it("records an immutable exact entry independently of the extensible registry container", () => {
  for (const entry of [historical, synthetic]) {
    const registered = matchRegisteredBaseline(source(entry), "test");
    expect(registered).not.toBeNull();
    if (!registered) throw Error("MISSING");
    expect(registered.identity.entrySha256).toBe(
      sha(
        canonicalOrdinaryJson(baselineDescriptorSchema.parse(entry), {
          maxBytes: 65536,
          maxDepth: 32,
        }),
      ),
    );
    expect(findBaselineDescriptor(registered.identity)).toBe(registered);
    expect(Object.isFrozen(registered.descriptor.resourceEdges[0])).toBe(true);
    expect(
      Object.isFrozen(registered.descriptor.presentationEdges.results),
    ).toBe(true);
    expect(
      findBaselineDescriptor({
        ...registered.identity,
        entrySha256: "f".repeat(64),
      }),
    ).toBeNull();
    expect(
      findBaselineDescriptor({ ...registered.identity, kind: "renderer" }),
    ).toBeNull();
  }
});
it("requires all three canonical hashes and the exact Product; raw ZIP is not an approval identity", () => {
  const original = source(historical);
  for (const k of [
    "canonicalContentSha256",
    "assetSetSha256",
    "canonicalManifestSha256",
  ] as const)
    expect(
      matchRegisteredBaseline({ ...original, [k]: "0".repeat(64) }, "test"),
    ).toBeNull();
  expect(
    matchRegisteredBaseline(
      { ...original, productId: "different-product" },
      "test",
    ),
  ).toBeNull();
  expect(
    matchRegisteredBaseline(original, "demo")?.descriptor.approval.kind,
  ).toBe("author-baseline");
});
it("synthetic registration is restricted to isolated test purposes and cannot pretend to be author approval", () => {
  for (const purpose of ["test", "ci"] as const)
    expect(
      matchRegisteredBaseline(source(synthetic), purpose)?.descriptor.approval
        .kind,
    ).toBe("synthetic-test");
  expect(matchRegisteredBaseline(source(synthetic), "demo")).toBeNull();
  expect(
    baselineDescriptorSchema.safeParse({
      ...synthetic,
      allowedInstancePurposes: ["test", "demo"],
    }).success,
  ).toBe(false);
  expect(
    baselineDescriptorSchema.safeParse({
      ...synthetic,
      sourceEvidence: historical.sourceEvidence,
    }).success,
  ).toBe(false);
});
it("rejects duplicate resource identities, contradictory alias bytes and foreign semantic edges", () => {
  const duplicated = structuredClone(historical);
  duplicated.resourceEdges[1] = duplicated.resourceEdges[0]!;
  const alias = structuredClone(historical);
  alias.resourceEdges[1]!.bytes++;
  const foreign = structuredClone(historical);
  foreign.presentationEdges.results[0]!.portraitRef.productId =
    "another-product";
  for (const e of [duplicated, alias, foreign])
    expect(baselineDescriptorSchema.safeParse(e).success).toBe(false);
});
it("matches the checked-in synthetic canonical bytes, every physical PNG and all semantic resource edges", async () => {
  const base = new URL(
    "../../../../tests/fixtures/p3e-baseline/",
    import.meta.url,
  );
  const contentBytes = await readFile(new URL("content.json", base)),
    assetBytes = await readFile(new URL("asset-set.json", base)),
    manifestBytes = await readFile(new URL("manifest.json", base));
  expect([sha(contentBytes), sha(assetBytes), sha(manifestBytes)]).toEqual([
    synthetic.canonicalContentSha256,
    synthetic.assetSetSha256,
    synthetic.canonicalManifestSha256,
  ]);
  const c = quizPackContentV2Schema.parse(
    JSON.parse(contentBytes.toString("utf8")),
  );
  expect(synthetic.presentationEdges).toEqual({
    cover: c.visualPresentation.coverSceneRef,
    sections: c.visualPresentation.sections.map((s) => ({
      sectionId: s.id,
      resourceRef: s.sceneRef,
    })),
    results: c.results.map((r) => ({
      resultRef: { id: r.id, productId: r.productId, version: r.version },
      reportTemplateRef: r.reportTemplateRef,
      portraitRef: r.portraitRef,
    })),
  });
  for (const r of c.resources) {
    const bytes = await readFile(new URL(r.path, base));
    expect(bytes.length).toBe(r.bytes);
    expect(sha(bytes)).toBe(r.sha256);
    expect(
      synthetic.resourceEdges.find((e) => e.resourceId === r.id),
    ).toMatchObject({
      version: r.version,
      sha256: r.sha256,
      bytes: r.bytes,
      purpose: r.purpose,
    });
  }
  expect(sha(await readFile(new URL("synthetic-evidence.json", base)))).toBe(
    synthetic.approval.evidenceSha256,
  );
});
