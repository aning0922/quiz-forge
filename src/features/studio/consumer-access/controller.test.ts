import { expect, it } from "vitest";
import { StudioConsumerControllerV1 } from "./controller";
import { readStudioConsumerPendingV1 } from "./pending";
import {
  internalPlayFixture,
  testUuid,
  testMoment,
} from "@/features/product/internal-play/contracts.test-support";
import {
  issueAccessKeyBindingSha256,
  type IssueAccessKeyBinding,
  type AccessKeyDetail,
} from "@/features/fulfillment/access/contracts";
import type { ConsumerPendingStorage } from "@/features/theme/consumer-v1/pending";
import type { StudioSessionDto } from "../contracts";
const json = (v: unknown, status = 200) =>
  new Response(JSON.stringify(v), {
    status,
    headers: { "content-type": "application/json" },
  });
async function fixture() {
  const { play } = await internalPlayFixture();
  const scope = {
    origin: "http://127.0.0.1:3201",
    instanceId: "a".repeat(32),
    issuerId: testUuid(7),
    productId: play.snapshot.parent.productId,
  };
  const session: StudioSessionDto = {
    operator: {
      id: scope.issuerId,
      label: "Synthetic operator",
      role: "operator",
    },
    csrfToken: "A".repeat(43),
    idleExpiresAt: "2026-10-18T08:00:00.000Z",
    absoluteExpiresAt: "2026-10-18T08:00:00.000Z",
  };
  const values = new Map<string, string>();
  const storage: ConsumerPendingStorage = {
    getItem: (k) => values.get(k) ?? null,
    setItem: (k, v) => {
      values.set(k, v);
    },
    removeItem: (k) => {
      values.delete(k);
    },
  };
  let actor = session,
    mode = "applied",
    key: AccessKeyDetail | null = null;
  const posts: IssueAccessKeyBinding[] = [];
  let release: ((r: Response) => void) | undefined,
    notify: (() => void) | undefined;
  const entered = new Promise<void>((r) => {
    notify = r;
  });
  async function keyFrom(
    binding: IssueAccessKeyBinding,
  ): Promise<AccessKeyDetail> {
    return {
      issue: {
        schemaVersion: "quizforge.access-key-issue-receipt.v1",
        binding,
        bindingSha256: await issueAccessKeyBindingSha256(binding),
        issuedBy: scope.issuerId,
        issuedAt: testMoment,
        expiresAt: new Date(
          Date.parse(testMoment) + binding.validForSeconds * 1000,
        ).toISOString(),
      },
      current: {
        observedAt: testMoment,
        claim: null,
        completion: null,
        voidReceipt: null,
      },
    };
  }
  const fetcher: typeof fetch = async (url, options) => {
    const path = String(url);
    if (path.endsWith("auth/session")) return json(actor);
    if (options?.method === "POST") {
      const binding = JSON.parse(String(options.body)) as IssueAccessKeyBinding;
      if (path.endsWith("/resolve"))
        return json({
          schemaVersion: "quizforge.access-key-issue-resolution.v1",
          kind: "unresolved",
          binding,
          bindingSha256: await issueAccessKeyBindingSha256(binding),
        });
      posts.push(binding);
      key = await keyFrom(binding);
      if (mode === "unknown") throw Error("synthetic lost response");
      if (mode === "late") {
        notify?.();
        return new Promise<Response>((r) => {
          release = r;
        });
      }
      return json({ created: true, key }, 201);
    }
    if (path.endsWith("play-versions"))
      return json({ productId: scope.productId, versions: [play.play] });
    if (path.endsWith("access-keys"))
      return json({
        productId: scope.productId,
        keys: key ? [key] : [],
        nextCursor: null,
      });
    return json(key);
  };
  const c = new StudioConsumerControllerV1(
    scope,
    play.snapshot.renderer,
    storage,
    fetcher,
    async () => ({ productId: scope.productId, versions: [] }),
  );
  return {
    c,
    scope,
    play,
    values,
    storage,
    posts,
    entered,
    setActor: (value: StudioSessionDto) => {
      actor = value;
    },
    session,
    setMode: (value: string) => {
      mode = value;
    },
    release: async () => {
      release?.(json({ created: true, key }, 201));
    },
  };
}
it("escrows before POST, sends no raw and exposes only after fresh issuer plus exact current Key checks", async () => {
  const f = await fixture();
  try {
    await f.c.refresh();
    await f.c.issueKey(f.play.play.id, 604800);
    expect(f.posts).toHaveLength(1);
    const pending = await readStudioConsumerPendingV1(f.storage, f.scope);
    if (pending?.operation.kind !== "issue") throw Error("synthetic fixture");
    expect(JSON.stringify(f.posts)).not.toContain(pending.operation.raw!);
    expect(JSON.stringify(f.c.getSnapshot())).not.toContain(
      pending.operation.raw!,
    );
    expect(f.c.getSnapshot()).toMatchObject({
      phase: "pending",
      pending: { hasRaw: true },
      evidence: { kind: "issue", value: { kind: "applied" } },
    });
    let copied = false;
    await f.c.exposeSecret(async (link, current) => {
      const url = new URL(link);
      expect(url.origin).toBe(f.scope.origin);
      expect(url.pathname).toBe("/access");
      expect(url.search).toBe("");
      expect(new URLSearchParams(url.hash.slice(1)).get("key")).toBe(
        pending.operation.kind === "issue" ? pending.operation.raw : null,
      );
      expect(current()).toBe(true);
      copied = true;
    }, "copied");
    expect(copied).toBe(true);
    expect(f.c.getSnapshot().notice).toBe("copied");
    expect(
      await readStudioConsumerPendingV1(f.storage, f.scope),
    ).not.toBeNull();
    await f.c.finish();
    expect(await readStudioConsumerPendingV1(f.storage, f.scope)).toBeNull();
  } finally {
    f.c.dispose();
  }
});
it("UNKNOWN preserves the original raw and binding; unresolved never clears or enables a new issuance", async () => {
  const f = await fixture();
  try {
    await f.c.refresh();
    f.setMode("unknown");
    await f.c.issueKey(f.play.play.id, 604800);
    const pending = await readStudioConsumerPendingV1(f.storage, f.scope);
    expect(f.c.getSnapshot().phase).toBe("pending");
    await f.c.issueKey(f.play.play.id, 86400);
    expect(f.posts).toHaveLength(1);
    await f.c.recover();
    await f.c.finish();
    expect(await readStudioConsumerPendingV1(f.storage, f.scope)).toEqual(
      pending,
    );
    f.setMode("applied");
    await f.c.recover(true);
    expect(f.posts).toHaveLength(2);
    expect(f.posts[1]).toEqual(f.posts[0]);
    expect(
      (await readStudioConsumerPendingV1(f.storage, f.scope))?.operation,
    ).toEqual(pending?.operation);
  } finally {
    f.c.dispose();
  }
});
it("a fresh different operator or role downgrade revokes before any private-link exposure", async () => {
  for (const changed of ["operator", "role"]) {
    const f = await fixture();
    try {
      await f.c.refresh();
      await f.c.issueKey(f.play.play.id, 604800);
      f.setActor({
        ...f.session,
        operator: {
          ...f.session.operator,
          ...(changed === "operator"
            ? { id: testUuid(100) }
            : { role: "read-only" as const }),
        },
      });
      let copied = false;
      await f.c.exposeSecret(async () => {
        copied = true;
      }, "copied");
      expect(copied).toBe(false);
      expect(f.c.getSnapshot()).toMatchObject({
        phase: "lost",
        session: null,
        pending: null,
      });
      expect(
        await readStudioConsumerPendingV1(f.storage, f.scope),
      ).not.toBeNull();
    } finally {
      f.c.dispose();
    }
  }
});
it("failed local escrow results in zero issuance POST", async () => {
  const f = await fixture();
  f.storage.setItem = () => {};
  try {
    await f.c.refresh();
    await f.c.issueKey(f.play.play.id, 604800);
    expect(f.posts).toHaveLength(0);
    expect(f.c.getSnapshot().phase).toBe("unavailable");
  } finally {
    f.c.dispose();
  }
});
it("revocation ignores a late successful issue and retains the original secret pending", async () => {
  const f = await fixture();
  try {
    await f.c.refresh();
    f.setMode("late");
    const sending = f.c.issueKey(f.play.play.id, 604800);
    await f.entered;
    f.c.revoke();
    await f.release();
    await sending;
    expect(f.c.getSnapshot()).toMatchObject({
      phase: "lost",
      evidence: null,
      pending: null,
    });
    expect(
      (await readStudioConsumerPendingV1(f.storage, f.scope))?.mayHaveBeenSent,
    ).toBe(true);
  } finally {
    f.c.dispose();
  }
});
it("restoring a raw-lost original allows resolve but never replay or metadata reconstruction", async () => {
  const f = await fixture();
  try {
    await f.c.refresh();
    f.setMode("unknown");
    await f.c.issueKey(f.play.play.id, 604800);
    const storageKey = [...f.values.keys()][0]!,
      record = JSON.parse(f.values.get(storageKey)!);
    record.operation.raw = null;
    f.values.set(storageKey, JSON.stringify(record));
    await f.c.refresh();
    expect(f.c.getSnapshot().pending?.hasRaw).toBe(false);
    await f.c.recover(true);
    expect(f.posts).toHaveLength(1);
    await f.c.recover();
    expect(f.c.getSnapshot().evidence?.value.kind).toBe("unresolved");
    let copied = false;
    await f.c.exposeSecret(async () => {
      copied = true;
    }, "copied");
    expect(copied).toBe(false);
    expect(
      await readStudioConsumerPendingV1(f.storage, f.scope),
    ).not.toBeNull();
  } finally {
    f.c.dispose();
  }
});
