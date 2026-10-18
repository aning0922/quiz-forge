import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";
import { deriveP4BaselineDefinition } from "../../../../tests/support/p4-baseline-definition";
import { canonicalOrdinaryJson } from "@/lib/json/canonical";
import {
  baselineDescriptorSchema,
  matchRegisteredBaseline,
  findBaselineDescriptor,
} from "./baseline-registry";
import consumer from "./baselines/synthetic-consumer-flow-v1.json";
import original from "./baselines/synthetic-internal-version-v1.json";
const hash = (v: string | Uint8Array) =>
  createHash("sha256").update(v).digest("hex");
const facts = {
  productId: consumer.productId,
  canonicalContentSha256: consumer.canonicalContentSha256,
  assetSetSha256: consumer.assetSetSha256,
  canonicalManifestSha256: consumer.canonicalManifestSha256,
};
it("derives every exact canonical artifact and every unchanged private PNG independently of runtime registration", async () => {
  const result = await deriveP4BaselineDefinition();
  expect(result.facts).toEqual(facts);
  expect(result.descriptor).toEqual(consumer);
  for (const [name, bytes] of result.files)
    expect(
      await readFile(
        new URL(
          `../../../../tests/fixtures/p4-baseline/${name}`,
          import.meta.url,
        ),
      ),
      name,
    ).toEqual(bytes);
  for (const [name, bytes] of result.files)
    if (name.startsWith("assets/"))
      expect(
        await readFile(
          new URL(
            `../../../../tests/fixtures/p3e-baseline/${name}`,
            import.meta.url,
          ),
        ),
        name,
      ).toEqual(bytes);
});
it("admits only the independent exact Product and three hashes in test/ci, with no demo or author-approval authority", () => {
  const registered = matchRegisteredBaseline(facts, "test");
  expect(registered).not.toBeNull();
  expect(matchRegisteredBaseline(facts, "ci")).toBe(registered);
  expect(matchRegisteredBaseline(facts, "demo")).toBeNull();
  expect(registered?.descriptor.approval.kind).toBe("synthetic-test");
  expect(registered?.descriptor.sourceEvidence.kind).toBe(
    "synthetic-definition",
  );
  expect(registered?.identity.entrySha256).toBe(
    hash(
      canonicalOrdinaryJson(baselineDescriptorSchema.parse(consumer), {
        maxBytes: 65536,
        maxDepth: 32,
      }),
    ),
  );
  expect(findBaselineDescriptor(registered!.identity)).toBe(registered);
  expect(
    matchRegisteredBaseline(
      { ...facts, productId: original.productId },
      "test",
    ),
  ).toBeNull();
  for (const field of [
    "canonicalContentSha256",
    "assetSetSha256",
    "canonicalManifestSha256",
  ] as const)
    expect(
      matchRegisteredBaseline({ ...facts, [field]: "a".repeat(64) }, "test"),
    ).toBeNull();
});
it("keeps all semantic content, resource declarations and presentation edges inside its own Product", async () => {
  const { files } = await deriveP4BaselineDefinition();
  for (const name of ["content.json", "asset-set.json", "manifest.json"]) {
    const text = files.get(name)!.toString();
    expect(text).not.toContain('"internal-version-fixture"');
    expect(text).toContain('"consumer-flow-fixture"');
  }
  expect(consumer.presentationEdges.cover.productId).toBe(consumer.productId);
  expect(
    consumer.presentationEdges.results.every(
      (r) =>
        r.resultRef.productId === consumer.productId &&
        r.reportTemplateRef.productId === consumer.productId &&
        r.portraitRef.productId === consumer.productId,
    ),
  ).toBe(true);
  const evidence = files.get("synthetic-evidence.json")!;
  expect(hash(evidence)).toBe(consumer.approval.evidenceSha256);
  expect(consumer.sourceEvidence.definitionSha256).toBe(
    consumer.approval.evidenceSha256,
  );
});
