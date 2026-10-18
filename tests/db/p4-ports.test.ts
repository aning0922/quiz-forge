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
import {
  consumerRead,
  consumerWrite,
  operatorRead,
  type ConsumerWriteObservation,
} from "@/features/fulfillment/consumer-flow/transaction";
import { assertLockWitness } from "@/lib/db/consumer-transaction";
import {
  lockConsumerProduct,
  readFixedInternalPlay,
  readConsumerParent,
} from "@/features/product/internal-play/repository";
import {
  lockAccessKey,
  readKeyFact,
  listKeyIssueFacts,
  findKeyIssueOperation,
} from "@/features/fulfillment/access/repository";
import {
  lockConsumerSession,
  readConsumerSession,
  readClaimMetadata,
} from "@/features/fulfillment/consumer-session/repository";
import {
  readPersistedReport,
  readCompletionMetadata,
} from "@/features/report/persisted/repository";
import { ConsumerError } from "@/lib/consumer-contract/v1/errors";
let db: TestDatabase,
  f: Awaited<ReturnType<typeof p4Fixture>>,
  failed = false;
const checkpoint = () => {};
const observation = (): ConsumerWriteObservation => ({ kind: "not-started" });
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
it("verifies actual immutable play/parent, issue operations and bounded Key facts without trusting row JSON alone", async () => {
  const key = await f.issue();
  await consumerRead(db.app, checkpoint, async (tx) => {
    expect((await readFixedInternalPlay(tx, f.playRef)).play).toEqual(
      f.play!.play,
    );
    expect(await readConsumerParent(tx, f.play!.snapshot.parent)).toEqual(
      f.parent,
    );
    const issue = await readKeyFact(tx, f.playRef.productId, String(key.id));
    expect(issue?.issue.binding.keyId).toBe(key.id);
    expect(
      await findKeyIssueOperation(
        tx,
        f.playRef.productId,
        String(key.issue_operation_key),
      ),
    ).toEqual(issue);
    const page = await listKeyIssueFacts(tx, f.playRef.productId, null);
    expect(page.keys).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
    expect(await readCompletionMetadata(tx, [String(key.id)])).toEqual([]);
  });
});
it("requires the actual product/Key/session lock witnesses from the same live transaction", async () => {
  const key = await f.issue(),
    session = await f.claim(key);
  let escaped: object | undefined;
  await consumerWrite(db.app, checkpoint, observation(), async (tx) => {
    const product = await lockConsumerProduct(tx, f.playRef.productId);
    assertLockWitness(tx, product, "product", f.playRef.productId);
    const k = await lockAccessKey(tx, { keyId: String(key.id) });
    if (!k) throw Error("P4_PORT_KEY_MISSING");
    const s = await lockConsumerSession(tx, k, String(session.id));
    if (!s) throw Error("P4_PORT_SESSION_MISSING");
    expect(s.state.stateRevision).toBe(0);
    escaped = k;
    expect(() =>
      assertLockWitness(tx, { ...k }, "key", String(key.id)),
    ).toThrow("UNAVAILABLE");
    assertLockWitness(tx, s, "session", String(session.id));
  });
  await expect(
    consumerWrite(db.app, checkpoint, observation(), async (tx) =>
      assertLockWitness(tx, escaped!, "key", String(key.id)),
    ),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
});
it("verifies complete real answer/report rows and composes only bounded claim/completion metadata", async () => {
  const key = await f.issue(),
    session = await f.claim(key);
  const content = JSON.parse(f.evidence.canonicalContentText) as {
    questions: { id: string; options: { id: string }[] }[];
  };
  const saved = await f.save(
    session,
    content.questions.map((q) => ({
      questionId: q.id,
      optionId: q.options[0]!.id,
    })),
  );
  const report = await f.complete(saved);
  await consumerRead(db.app, checkpoint, async (tx) => {
    const s = await readConsumerSession(tx, String(key.id));
    expect(s?.stateRevision).toBe(1);
    const r = await readPersistedReport(tx, String(key.id));
    expect(r?.receipt.reportId).toBe(report.id);
    expect(r?.snapshot.answers).toEqual(s?.answers);
    expect((await readClaimMetadata(tx, [String(key.id)]))[0]?.sessionId).toBe(
      session.id,
    );
    expect(
      (await readCompletionMetadata(tx, [String(key.id)]))[0]?.reportId,
    ).toBe(report.id);
  });
});
it("preserves known rollback errors and never calls a confirmed rollback a commit", async () => {
  const state = observation();
  await expect(
    consumerWrite(db.app, checkpoint, state, async () => {
      throw new ConsumerError("STATE_CONFLICT");
    }),
  ).rejects.toMatchObject({ code: "STATE_CONFLICT" });
  expect(state.kind).toBe("rolled-back");
  const primitive = observation();
  await expect(
    consumerWrite(db.app, checkpoint, primitive, async () => {
      throw null;
    }),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(primitive.kind).toBe("rolled-back");
});
it("reauthorizes in a new fresh transaction after an RR snapshot, refusing a concurrently disabled operator", async () => {
  try {
    await expect(
      operatorRead(db.app, f.auth.session.raw, checkpoint, async (tx) => {
        await db.admin
          .sql`UPDATE qf.operator SET status='disabled',disabled_at=clock_timestamp() WHERE id=${f.auth.id}`;
        const [old] =
          await tx.sql`SELECT status FROM qf.operator WHERE id=${f.auth.id}`;
        expect(old?.status).toBe("active"); // A recheck in this SAME RR snapshot would incorrectly pass.
        return "stale-authority-must-not-publish";
      }),
    ).rejects.toMatchObject({ code: "OPERATOR_REQUIRED" });
  } finally {
    await db.admin
      .sql`UPDATE qf.operator SET status='active',disabled_at=NULL WHERE id=${f.auth.id}`;
  }
});
