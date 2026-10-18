import { describe, expect, it } from "vitest";
import {
  internalPlayFixture,
  testUuid,
} from "@/features/product/internal-play/contracts.test-support";
import { sourceBinding } from "@/features/theme/preview/fixtures.test-support";
import { preparePreviewContent } from "@/features/theme/preview/projection";
import { consumerMappingSha256 } from "@/lib/consumer-contract/v1/identities";
import {
  consumerEntryFactsSchema,
  consumerEntryFactsSha256,
  verifyConsumerEntryView,
  consumerResourceSelectorSchema,
} from "./display-contract";
import { consumerPlayPageUrl, consumerResourceUrl, accessKeyUrl } from "./urls";

async function fixture() {
  const { play, content } = await internalPlayFixture();
  // Test-only reuse of the established neutral projection. Production consumer uses its new producer.
  const prepared = preparePreviewContent(content, sourceBinding(content));
  if (!prepared.ok) throw Error("SYNTHETIC_FIXTURE_INVALID");
  const { binding: omitted, ...entry } = prepared.value.entry;
  void omitted;
  const facts = {
    schemaVersion: "quizforge.consumer-entry.v1" as const,
    session: {
      productId: play.snapshot.parent.productId,
      playVersionId: play.play.id,
      playSnapshotSha256: play.play.snapshotSha256,
      keyId: testUuid(300),
      sessionId: testUuid(301),
    },
    parent: play.snapshot.parent,
    renderer: play.snapshot.renderer,
    font: play.snapshot.parentSnapshot.font,
    mapping: play.snapshot.mapping,
    mappingSha256: play.snapshot.mappingSha256,
    entry,
  };
  return { facts, factsSha256: await consumerEntryFactsSha256(facts) };
}

describe("consumer neutral entry transport", () => {
  it("verifies the exact session and projection bytes while rejecting secret or unselected fields", async () => {
    const value = await fixture();
    expect(await verifyConsumerEntryView(value, value.facts.session)).toEqual(
      value,
    );
    await expect(
      verifyConsumerEntryView(value, {
        ...value.facts.session,
        sessionId: testUuid(302),
      }),
    ).rejects.toThrow("CONSUMER_ENTRY_MISMATCH");
    const tampered = structuredClone(value);
    tampered.facts.entry.product.title = "另一份正文";
    await expect(
      verifyConsumerEntryView(tampered, value.facts.session),
    ).rejects.toThrow("CONSUMER_ENTRY_MISMATCH");
    for (const extra of [
      { rawKey: "synthetic" },
      { parentSnapshot: {} },
      { score: {} },
      { reports: [] },
    ])
      expect(
        consumerEntryFactsSchema.safeParse({ ...value.facts, ...extra })
          .success,
      ).toBe(false);
    expect(
      consumerEntryFactsSchema.safeParse({
        ...value.facts,
        entry: { ...value.facts.entry, weights: [] },
      }).success,
    ).toBe(false);
  });
  it("refuses mapping digest drift even after a valid outer hash is recomputed", async () => {
    const value = await fixture();
    const facts = structuredClone(value.facts);
    facts.mapping.states.cover.runtime.id = "consumer-another-cover";
    await expect(
      verifyConsumerEntryView(
        { facts, factsSha256: await consumerEntryFactsSha256(facts) },
        facts.session,
      ),
    ).rejects.toThrow("CONSUMER_ENTRY_MISMATCH");
    facts.mappingSha256 = await consumerMappingSha256(facts.mapping);
    // Metadata self-consistency is not registry admission. The host must still select an exact implementation.
    expect(
      await verifyConsumerEntryView(
        { facts, factsSha256: await consumerEntryFactsSha256(facts) },
        facts.session,
      ),
    ).toBeDefined();
  });
  it("rejects ambiguous question IDs across source versions before they can address a saved answer", async () => {
    const value = await fixture();
    const facts = structuredClone(value.facts);
    const q = facts.entry.questions[1]!;
    const oldId = q.id;
    q.id = facts.entry.questions[0]!.id;
    q.version = "9.0.0";
    const frame = facts.entry.visualPresentation.questionFrames.find(
      (f) => f.questionRef.id === oldId,
    )!;
    frame.questionRef.id = q.id;
    frame.questionRef.version = q.version;
    expect(consumerEntryFactsSchema.safeParse(facts).success).toBe(false);
  });
  it("accepts only finite resource selectors and keeps credentials out of URL constructors", () => {
    const id = testUuid(303);
    expect(consumerPlayPageUrl(id)).toBe(`/play/${id}`);
    const selector = {
      resourceId: "neutral-scene",
      resourceVersion: "1.0.0",
      sha256: "a".repeat(64),
    };
    const url = new URL(
      consumerResourceUrl(id, selector),
      "http://127.0.0.1:3100",
    );
    expect([...url.searchParams.keys()].sort()).toEqual([
      "resourceId",
      "resourceVersion",
      "sha256",
    ]);
    for (const extra of [
      { rawKey: "synthetic" },
      { path: "../other" },
      { url: "https://invalid.example" },
      { productId: "other-product" },
    ])
      expect(
        consumerResourceSelectorSchema.safeParse({ ...selector, ...extra })
          .success,
      ).toBe(false);
    for (const bad of [
      "../other",
      `${id}\n`,
      `${id}?key=synthetic`,
      "synthetic-key",
    ])
      expect(() => consumerPlayPageUrl(bad)).toThrow();
    expect(() => accessKeyUrl("other/product", id)).toThrow();
  });
});
