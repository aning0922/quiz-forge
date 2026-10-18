import {
  beforeAll,
  afterAll,
  beforeEach,
  onTestFailed,
  expect,
  it,
} from "vitest";
import { openTestDatabase, type TestDatabase } from "./p2a-fixture";
import { p4Fixture } from "./p4-fixture";
import { StorageLock } from "@/features/quizpack/import/storage-lock";
import {
  assertOnlyOwnedInternalReferences,
  assertNoRetainedInternalReferences,
} from "@/features/product/internal-versions/retention";
import { iso } from "@/features/product/workspace/repository";
import type { DatabaseTime } from "@/lib/auth/internal";
import { randomUUID } from "node:crypto";
import { readP4OldGraph } from "./p4-fixture";
let db: TestDatabase,
  f: Awaited<ReturnType<typeof p4Fixture>>,
  failed = false;
beforeAll(async () => {
  db = await openTestDatabase();
  f = await p4Fixture(db);
});
beforeEach(() =>
  onTestFailed(() => {
    failed = true;
  }),
);
afterAll(async () => {
  try {
    if (f && !failed) await f.cleanup();
  } finally {
    await db?.close();
  }
});
it("samples issue time once and fixes its duration without granting app renewal rights", async () => {
  const key = await f.issue();
  expect(
    Date.parse(iso(key.expires_at as DatabaseTime)) -
      Date.parse(iso(key.issued_at as DatabaseTime)),
  ).toBe(3600000);
  await expect(
    db.app
      .sql`UPDATE qf.access_key SET expires_at=expires_at+interval '1 hour' WHERE id=${String(key.id)}`,
  ).rejects.toMatchObject({ code: "42501" });
});
it("rejects direct valid revision0 claim after void, and rejects void after permanent claim", async () => {
  const unused = await f.issue();
  await f.voidKey(unused);
  await expect(f.claim(unused)).rejects.toMatchObject({ code: "23514" });
  const claimed = await f.issue();
  await f.claim(claimed);
  await expect(f.voidKey(claimed)).rejects.toMatchObject({ code: "23514" });
});
it("serializes reverse claim/void transactions on one Key so exactly one commits", async () => {
  const key = await f.issue();
  const outcomes = await Promise.allSettled([
    db.app.sql.begin((tx) => f.claim(key, tx)),
    db.app.sql.begin((tx) => f.voidKey(key, tx)),
  ]);
  expect(outcomes.filter((x) => x.status === "fulfilled")).toHaveLength(1);
  const rejected = outcomes.find((x) => x.status === "rejected");
  expect(
    rejected?.status === "rejected" &&
      (rejected.reason as { code: string }).code,
  ).toBe("23514");
  const [row] = await db.app.sql<
    { claimed: boolean; voided: boolean }[]
  >`SELECT EXISTS(SELECT 1 FROM qf.consumer_session WHERE key_id=${String(key.id)}) claimed,(SELECT revoked_at IS NOT NULL FROM qf.access_key WHERE id=${String(key.id)}) voided`;
  expect(row?.claimed).not.toBe(row?.voided);
});
it("requires every accepted update including equal-value save to increase revision with exact last receipt", async () => {
  const key = await f.issue(),
    session = await f.claim(key);
  const once = await f.save(session, []),
    twice = await f.save(once, []);
  expect(once.state_revision).toBe(1);
  expect(twice.state_revision).toBe(2);
  await expect(
    db.app
      .sql`UPDATE qf.consumer_session SET last_receipt_text=last_receipt_text WHERE id=${String(session.id)}`,
  ).rejects.toMatchObject({ code: "23514" });
});
it("pins a real complete score/report and immediately prevents final-state mutation", async () => {
  const key = await f.issue(),
    session = await f.claim(key);
  const content = JSON.parse(f.evidence.canonicalContentText) as {
    questions: { id: string; options: { id: string }[] }[];
  };
  const answers = content.questions.map((q) => ({
    questionId: q.id,
    optionId: q.options[0]!.id,
  }));
  const saved = await f.save(session, answers);
  await f.complete(saved);
  await expect(f.save(saved, answers)).rejects.toMatchObject({ code: "23001" });
  await expect(
    db.app
      .sql`UPDATE qf.consumer_session SET answers_text=answers_text WHERE id=${String(session.id)}`,
  ).rejects.toMatchObject({ code: "23514" });
  await expect(
    db.app
      .sql`DELETE FROM qf.quiz_report WHERE session_id=${String(session.id)}`,
  ).rejects.toMatchObject({ code: "42501" });
});
it("retains the entire graph before even fixture-owned parent ledgers can be deleted", async () => {
  const lock = await StorageLock.acquire(db.config);
  try {
    const before = await db.admin
      .sql`SELECT id,snapshot_sha256 FROM qf.product_version WHERE id=${f.parent.version.id}`;
    await expect(
      assertOnlyOwnedInternalReferences(
        lock,
        {
          revisions: [
            {
              productId: f.playRef.productId,
              draftId: f.parent.snapshot.target.draftId,
              revision: 1,
            },
          ],
          imports: [],
          validations: [],
          blobSha256: [],
        },
        { reviews: [f.review], versions: [f.parent.version] },
      ),
    ).rejects.toThrow("CONSUMER_REFERENCE_RETAINED");
    const assetSet = JSON.parse(f.evidence.assetSetText) as {
      resources: { blobSha256: string }[];
    };
    expect(assetSet.resources.length).toBeGreaterThan(0);
    for (const scope of [
      {
        revisions: [
          {
            productId: f.playRef.productId,
            draftId: f.parent.snapshot.target.draftId,
            revision: 1,
          },
        ],
        imports: [],
        validations: [],
        blobSha256: [],
      },
      {
        revisions: [],
        imports: [
          { productId: f.playRef.productId, id: f.source.scope.sourceImportId },
        ],
        validations: [],
        blobSha256: [],
      },
      {
        revisions: [],
        imports: [],
        validations: [
          {
            productId: f.playRef.productId,
            id: f.source.scope.sourceValidationId,
          },
        ],
        blobSha256: [],
      },
      {
        revisions: [],
        imports: [],
        validations: [],
        blobSha256: [assetSet.resources[0]!.blobSha256],
      },
    ]) {
      await expect(
        assertNoRetainedInternalReferences(lock, scope),
      ).rejects.toThrow("CONSUMER_REFERENCE_RETAINED");
    }
    expect(
      await db.admin
        .sql`SELECT id,snapshot_sha256 FROM qf.product_version WHERE id=${f.parent.version.id}`,
    ).toEqual(before);
  } finally {
    await lock.close();
  }
});
it("refuses fixture cleanup before its first delete when an unobserved old row exists", async () => {
  const id = randomUUID(),
    digest = "4".repeat(64);
  await db.admin
    .sql`INSERT INTO qf.operator(id,label,credential_digest,role,status) VALUES(${id},${`unobserved-${id}`},${digest},'operator','active')`;
  const before = await readP4OldGraph(db.admin.sql);
  const [children] = await db.admin
    .sql`SELECT (SELECT jsonb_agg(to_jsonb(t)) FROM qf.internal_play_version t) plays,(SELECT jsonb_agg(to_jsonb(t)) FROM qf.access_key t) keys,(SELECT jsonb_agg(to_jsonb(t)) FROM qf.consumer_session t) sessions,(SELECT jsonb_agg(to_jsonb(t)) FROM qf.consumer_grant t) grants,(SELECT jsonb_agg(to_jsonb(t)) FROM qf.quiz_report t) reports`;
  await expect(f.cleanup()).rejects.toThrow("P4_TEST_OLD_GRAPH_CHANGED");
  expect(await readP4OldGraph(db.admin.sql)).toEqual(before);
  const [after] = await db.admin
    .sql`SELECT (SELECT jsonb_agg(to_jsonb(t)) FROM qf.internal_play_version t) plays,(SELECT jsonb_agg(to_jsonb(t)) FROM qf.access_key t) keys,(SELECT jsonb_agg(to_jsonb(t)) FROM qf.consumer_session t) sessions,(SELECT jsonb_agg(to_jsonb(t)) FROM qf.consumer_grant t) grants,(SELECT jsonb_agg(to_jsonb(t)) FROM qf.quiz_report t) reports`;
  expect(after).toEqual(children);
  // Only remove the exact extra synthetic row introduced above, after zero-deletion proof succeeded.
  await db.admin
    .sql`DELETE FROM qf.operator WHERE id=${id} AND credential_digest=${digest}`;
});
