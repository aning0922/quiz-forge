import { describe, expect, it } from "vitest";
import { canonicalP1Json } from "@/features/quizpack/v1/canonical";
import { consumerCanonicalText } from "@/lib/consumer-contract/v1/integrity";
import {
  createInternalPlayBindingSchema,
  internalPlayBindingSha256,
  internalPlaySnapshotSchema,
  internalPlayResourcesSchema,
  internalPlayListSchema,
  verifyInternalPlayDetail,
  verifyInternalPlayParent,
} from "./contracts";
import {
  internalPlayFixture,
  testSha,
  testUuid,
} from "./contracts.test-support";

describe("internal consumer play contract draft", () => {
  it("inherits exact parent evidence and retains original source components", async () => {
    const { play, parent } = await internalPlayFixture();
    expect(await verifyInternalPlayParent(play, parent)).toEqual(play);
    expect(play.snapshot.parentSnapshot.engine).toEqual(parent.snapshot.engine);
    expect(play.snapshot.mapping.states.cover.source).toEqual(
      parent.snapshot.components.cover,
    );
    expect(play.snapshot.mapping.states.cover.runtime.id).not.toBe(
      parent.snapshot.components.cover.id,
    );
    expect(consumerCanonicalText(play.snapshot.resources, 65536)).toBe(
      canonicalP1Json(play.snapshot.resources),
    );
    expect(
      createInternalPlayBindingSchema.safeParse({
        ...play.play.binding,
        engine: parent.snapshot.engine,
      }).success,
    ).toBe(false);
    expect(
      createInternalPlayBindingSchema.safeParse({
        ...play.play.binding,
        target: parent.snapshot.target,
      }).success,
    ).toBe(false);
    expect(
      createInternalPlayBindingSchema.safeParse({
        ...play.play.binding,
        reviewId: testUuid(50),
      }).success,
    ).toBe(false);
  });
  it("binds original operation key, parent SHA and renderer closure independently", async () => {
    const { play } = await internalPlayFixture();
    for (const change of [
      { ...play.play.binding, operationKey: testUuid(90) },
      {
        ...play.play.binding,
        parent: { ...play.play.binding.parent, snapshotSha256: testSha("f") },
      },
      {
        ...play.play.binding,
        renderer: { ...play.play.binding.renderer, entrySha256: testSha("a") },
      },
    ])
      expect(await internalPlayBindingSha256(change)).not.toBe(
        play.play.bindingSha256,
      );
    expect(
      await internalPlayBindingSha256(
        Object.fromEntries(Object.entries(play.play.binding).reverse()),
      ),
    ).toBe(play.play.bindingSha256);
  });
  it("rejects cross-product/duplicate/unsorted resources and source-to-runtime confusion", async () => {
    const { play } = await internalPlayFixture();
    const resources = structuredClone(play.snapshot.resources);
    resources.resources.push(resources.resources[0]!);
    expect(internalPlayResourcesSchema.safeParse(resources).success).toBe(
      false,
    );
    const cross = structuredClone(play.snapshot);
    cross.resources.productId = "other-product";
    expect(internalPlaySnapshotSchema.safeParse(cross).success).toBe(false);
    const source = structuredClone(play.snapshot);
    source.mapping.states.cover.source.id = "folio-question" as "folio-cover";
    expect(internalPlaySnapshotSchema.safeParse(source).success).toBe(false);
    expect(
      internalPlaySnapshotSchema.safeParse({
        ...play.snapshot,
        available: true,
      }).success,
    ).toBe(false);
  });
  it("verifies parent, resource, mapping and receipt digests rather than only shapes", async () => {
    const { play, parent } = await internalPlayFixture();
    for (const mutate of [
      (v: typeof play) => {
        v.snapshot.parentSnapshot.logicHash = testSha("f");
      },
      (v: typeof play) => {
        v.snapshot.resources.resources[0]!.blobSha256 = testSha("f");
      },
      (v: typeof play) => {
        v.snapshot.mapping.states.cover.runtime.version = "1.0.1";
      },
      (v: typeof play) => {
        v.play.bindingSha256 = testSha("f");
      },
      (v: typeof play) => {
        v.play.snapshotSha256 = testSha("f");
      },
    ]) {
      const changed = structuredClone(play);
      mutate(changed);
      await expect(verifyInternalPlayDetail(changed)).rejects.toThrow();
    }
    await expect(
      verifyInternalPlayParent(play, {
        ...parent,
        version: { ...parent.version, id: testUuid(91) },
      }),
    ).rejects.toThrow("INTERNAL_PLAY_PARENT_MISMATCH");
  });
  it("allows the same parent with a new snapshot while rejecting duplicate slots or identities", async () => {
    const { play } = await internalPlayFixture();
    const newer = {
      ...play.play,
      id: testUuid(92),
      slot: 2,
      snapshotSha256: testSha("f"),
    };
    const list = {
      productId: play.snapshot.parent.productId,
      versions: [newer, play.play],
    };
    expect(internalPlayListSchema.safeParse(list).success).toBe(true);
    expect(
      internalPlayListSchema.safeParse({
        ...list,
        versions: [play.play, newer],
      }).success,
    ).toBe(false);
    expect(
      internalPlayListSchema.safeParse({
        ...list,
        versions: [newer, { ...play.play, slot: 2 }],
      }).success,
    ).toBe(false);
    expect(
      internalPlayListSchema.safeParse({
        ...list,
        versions: Array(101).fill(play.play),
      }).success,
    ).toBe(false);
  });
});
