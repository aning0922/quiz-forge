import { expect, it } from "vitest";
import {
  StudioConsumerControllerV1,
  type StudioConsumerRenderers,
} from "./controller";
import { readStudioConsumerPendingV1 } from "./pending";
import {
  internalPlayFixture,
  testMoment,
  testUuid,
} from "@/features/product/internal-play/contracts.test-support";
import { persistedReportFixtureV2 } from "@/features/report/persisted/contracts-v2.test-support";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY } from "@/features/product/internal-play/implementation-catalog";
import { CONSUMER_IMPLEMENTATION_AVAILABILITY_V2 } from "@/features/product/internal-play/implementation-catalog-v2";
import {
  hashInternalText,
  internalSnapshotText,
  sealInternalVersionFingerprint,
  type InternalVersionDetail,
  type InternalVersionSnapshot,
} from "@/features/product/internal-versions/contracts";
import {
  internalPlayBindingSha256,
  type CreateInternalPlayBinding,
} from "@/features/product/internal-play/contracts";

const renderers: StudioConsumerRenderers = {
  "quizforge.internal-version-snapshot.v1":
    CONSUMER_IMPLEMENTATION_AVAILABILITY.rendererV1_2,
  "quizforge.internal-version-snapshot.v2":
    CONSUMER_IMPLEMENTATION_AVAILABILITY_V2.structured,
};
const json = (v: unknown) =>
  new Response(JSON.stringify(v), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
async function fixture(v2 = false, map = renderers) {
  const old = await internalPlayFixture();
  const snapshot = v2
    ? (await persistedReportFixtureV2()).snapshot.play.snapshot.parentSnapshot
    : old.parent.snapshot;
  const makeDetail = async (s: InternalVersionSnapshot, id: string) => {
    const binding = {
      ...old.parent.version.binding,
      productId: s.productId,
      target: s.target,
      reviewId: s.reviewId,
      reviewSha256: s.reviewSha256,
      renderer: s.renderer,
      engine: s.engine,
    };
    return {
      snapshot: s,
      version: {
        ...old.parent.version,
        id,
        binding,
        fingerprint: await sealInternalVersionFingerprint(binding),
        snapshotSha256: await hashInternalText(internalSnapshotText(s)),
      },
    };
  };
  const parent = await makeDetail(snapshot, testUuid(101));
  const other = await makeDetail(
    {
      ...old.parent.snapshot,
      productId: snapshot.productId,
      packId: snapshot.productId,
    },
    testUuid(102),
  );
  const scope = {
    origin: "http://127.0.0.1:3201",
    instanceId: "a".repeat(32),
    issuerId: testUuid(7),
    productId: snapshot.productId,
  };
  const session = {
    operator: {
      loginName: "synthetic.admin",
      accountRevision: 1,
      id: scope.issuerId,
      displayName: "Synthetic admin",
      role: "admin",
    },
    csrfToken: "A".repeat(43),
    idleExpiresAt: testMoment,
    absoluteExpiresAt: testMoment,
  };
  const values = new Map<string, string>(),
    storage = {
      getItem: (k: string) => values.get(k) ?? null,
      setItem: (k: string, v: string) => {
        values.set(k, v);
      },
      removeItem: (k: string) => {
        values.delete(k);
      },
    };
  let response: unknown = parent,
    reads = 0,
    versions = [parent, other];
  const posts: CreateInternalPlayBinding[] = [],
    resolutions: CreateInternalPlayBinding[] = [];
  const fetcher: typeof fetch = async (url, options) => {
    const path = String(url);
    if (path.endsWith("auth/session")) return json(session);
    if (options?.method === "POST") {
      const binding = JSON.parse(
        String(options.body),
      ) as CreateInternalPlayBinding;
      if (path.endsWith("/resolve")) {
        resolutions.push(binding);
        return json({
          schemaVersion: "quizforge.internal-play-resolution.v1",
          kind: "unresolved",
          binding,
          bindingSha256: await internalPlayBindingSha256(binding),
        });
      }
      posts.push(binding);
      throw Error("Synthetic lost create response");
    }
    if (path.endsWith("play-versions"))
      return json({ productId: scope.productId, versions: [] });
    return json({ productId: scope.productId, keys: [], nextCursor: null });
  };
  const listEntry = (d: InternalVersionDetail) => ({
    id: d.version.id,
    productId: d.version.binding.productId,
    slot: d.version.slot,
    target: d.version.binding.target,
    reviewId: d.version.binding.reviewId,
    reviewSha256: d.version.binding.reviewSha256,
    snapshotSha256: d.version.snapshotSha256,
    renderer: d.version.binding.renderer,
    rendererCapability: "studio-internal-preview" as const,
    engine: d.version.binding.engine,
    purpose: d.version.purpose,
    publicationApproved: d.version.publicationApproved,
    createdAt: d.version.createdAt,
    createdBy: d.version.createdBy,
  });
  const c = new StudioConsumerControllerV1(
    scope,
    map,
    storage,
    fetcher,
    async () => ({
      productId: scope.productId,
      versions: versions.map(listEntry),
    }),
    async (productId, id) => {
      expect(productId).toBe(scope.productId);
      expect(id).toBe(parent.version.id);
      reads++;
      return response;
    },
  );
  return {
    c,
    parent,
    other,
    scope,
    storage,
    posts,
    resolutions,
    values,
    reads: () => reads,
    setResponse: (v: unknown) => {
      response = v;
    },
    rehashDifferentSnapshot: async () => {
      response = await makeDetail(
        { ...snapshot, packVersion: "1.0.1" },
        parent.version.id,
      );
    },
    changeListedParent: () => {
      versions = [other];
    },
  };
}
it.each([false, true])(
  "selects the compiled renderer only after verifying the exact selected parent (v2=%s)",
  async (v2) => {
    const f = await fixture(v2);
    try {
      await f.c.refresh();
      await f.c.createPlay(f.parent.version.id);
      expect(f.reads()).toBe(1);
      expect(f.posts).toHaveLength(1);
      expect(f.posts[0]!.renderer).toEqual(
        renderers[f.parent.snapshot.schemaVersion],
      );
      expect(f.posts[0]!.parent).toEqual({
        productId: f.scope.productId,
        versionId: f.parent.version.id,
        snapshotSha256: f.parent.version.snapshotSha256,
      });
    } finally {
      f.c.dispose();
    }
  },
);
it.each([
  "unknown-schema",
  "wrong-parent",
  "wrong-hash",
  "tampered-snapshot",
  "wrong-map",
] as const)("fails closed before escrow or POST for %s", async (mode) => {
  const f = await fixture(
    true,
    mode === "wrong-map"
      ? {
          ...renderers,
          "quizforge.internal-version-snapshot.v2":
            renderers["quizforge.internal-version-snapshot.v1"],
        }
      : renderers,
  );
  try {
    if (mode === "unknown-schema")
      f.setResponse({
        ...f.parent,
        snapshot: {
          ...f.parent.snapshot,
          schemaVersion: "quizforge.internal-version-snapshot.v99",
        },
      });
    if (mode === "wrong-parent") f.setResponse(f.other);
    if (mode === "wrong-hash") await f.rehashDifferentSnapshot();
    if (mode === "tampered-snapshot")
      f.setResponse({
        ...f.parent,
        snapshot: { ...f.parent.snapshot, packVersion: "1.0.1" },
      });
    await f.c.refresh();
    await f.c.createPlay(f.parent.version.id);
    expect(f.posts).toHaveLength(0);
    expect(f.values.size).toBe(0);
    expect(f.c.getSnapshot().phase).toBe("unavailable");
  } finally {
    f.c.dispose();
  }
});
it("keeps the same owner and original pending parent/renderer across a different selection, refresh, resolve and explicit replay", async () => {
  const f = await fixture(true);
  try {
    await f.c.refresh();
    await f.c.createPlay(f.parent.version.id);
    const pending = await readStudioConsumerPendingV1(f.storage, f.scope);
    expect(pending?.operation.kind).toBe("play");
    await f.c.createPlay(f.other.version.id);
    f.changeListedParent();
    await f.c.refresh();
    await f.c.createPlay(f.other.version.id);
    await f.c.recover();
    expect(f.resolutions).toEqual([f.posts[0]]);
    expect(f.posts).toHaveLength(1);
    expect(f.reads()).toBe(1);
    expect(await readStudioConsumerPendingV1(f.storage, f.scope)).toEqual(
      pending,
    );
    await f.c.recover(true);
    expect(f.posts).toHaveLength(2);
    expect(f.posts[1]).toEqual(f.posts[0]);
    expect(await readStudioConsumerPendingV1(f.storage, f.scope)).toEqual(
      pending,
    );
  } finally {
    f.c.dispose();
  }
});
