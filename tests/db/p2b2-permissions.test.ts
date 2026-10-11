import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, expect, it } from "vitest";
import {
  authenticateTestOperator,
  openTestDatabase,
  resetTestDatabase,
  safeTestOperation,
  type TestDatabase,
} from "./p2a-fixture";
import { workspaceService } from "../../src/features/product/workspace/service";
import { importReceiveService } from "../../src/features/quizpack/import/service";
import { configureImports } from "../../src/features/quizpack/import/config-management";
let db: TestDatabase;
let id: string;
let actor: Awaited<ReturnType<typeof authenticateTestOperator>>;
const fixedCode = async (work: () => PromiseLike<unknown>) => {
  try {
    await work();
    return "SUCCESS";
  } catch (e) {
    const code = (e as { code?: unknown }).code;
    return typeof code === "string" ? code : "UNCLASSIFIED";
  }
};
beforeAll(async () => {
  db = await openTestDatabase();
});
beforeEach(async () => {
  await resetTestDatabase(db);
  await configureImports(db.config.instanceId, true);
  actor = await authenticateTestOperator(db);
  await safeTestOperation(() =>
    workspaceService.createProduct(db.app, actor.credentials, {
      id: "permission-test",
      slug: "permission-test",
      title: "Synthetic",
      primaryCategoryId: null,
      tagIds: [],
    }),
  );
  id = (
    await importReceiveService.createIntent(
      db.app,
      actor.credentials,
      "permission-test",
      randomUUID(),
      {
        expectedArchiveBytes: 1,
        expectedArchiveSha256: "a".repeat(64),
        target: { kind: "new-draft" },
      },
    )
  ).import.id;
});
afterAll(async () => {
  await resetTestDatabase(db);
  await db.close();
});
it("grants exact state/lease/meter/freeze update columns, with no invariant/DELETE/TRUNCATE/DDL", async () => {
  const rows = await safeTestOperation(
    () =>
      db.admin.sql<
        { column_name: string; privilege_type: string }[]
      >`SELECT column_name,privilege_type FROM information_schema.column_privileges WHERE grantee=${db.config.database.user} AND table_schema='qf' AND table_name='quizpack_import' AND privilege_type='UPDATE' ORDER BY column_name`,
  );
  expect(rows.map((r) => r.column_name)).toEqual([
    "accounted_bytes",
    "actual_archive_bytes",
    "actual_archive_sha256",
    "archive_storage_key",
    "attempts",
    "current_attempt_id",
    "fence",
    "last_error_code",
    "lease_until",
    "received_at",
    "reserved_bytes",
    "state_revision",
    "status",
    "storage_condition",
    "updated_at",
  ]);
  for (const column of [
    "id",
    "product_id",
    "created_by",
    "idempotency_key",
    "request_fingerprint",
    "expected_archive_sha256",
    "expected_archive_bytes",
    "target_kind",
    "created_at",
  ]) {
    expect(
      await fixedCode(() =>
        db.app.sql.unsafe(
          `UPDATE qf.quizpack_import SET ${column}=${column} WHERE id=$1`,
          [id],
        ),
      ),
    ).toBe("42501");
  }
  expect(
    await fixedCode(
      () => db.app.sql`DELETE FROM qf.quizpack_import WHERE id=${id}`,
    ),
  ).toBe("42501");
  expect(await fixedCode(() => db.app.sql`TRUNCATE qf.quizpack_import`)).toBe(
    "42501",
  );
  expect(
    await fixedCode(
      () => db.app.sql`ALTER TABLE qf.quizpack_import ADD COLUMN forbidden int`,
    ),
  ).toBe("42501");
});
it("rejects counter skips, invalid attempts/reservations, terminal mutation and immutable identity even as owner", async () => {
  expect(
    await fixedCode(
      () =>
        db.app
          .sql`UPDATE qf.quizpack_import SET state_revision=state_revision+2 WHERE id=${id}`,
    ),
  ).toBe("23514");
  expect(
    await fixedCode(
      () =>
        db.app
          .sql`UPDATE qf.quizpack_import SET state_revision=state_revision+1,reserved_bytes=1 WHERE id=${id}`,
    ),
  ).toBe("23514");
  expect(
    await fixedCode(
      () =>
        db.admin
          .sql`UPDATE qf.quizpack_import SET state_revision=state_revision+1,expected_archive_bytes=2 WHERE id=${id}`,
    ),
  ).toBe("23514");
  expect(
    await fixedCode(
      () =>
        db.app
          .sql`UPDATE qf.quizpack_import SET state_revision=state_revision+1,attempts='[{}]'::jsonb WHERE id=${id}`,
    ),
  ).toBe("23514");
  await safeTestOperation(
    () =>
      db.app
        .sql`UPDATE qf.quizpack_import SET state_revision=state_revision+1,status='rejected',updated_at=clock_timestamp() WHERE id=${id}`,
  );
  expect(
    await fixedCode(
      () =>
        db.app
          .sql`UPDATE qf.quizpack_import SET state_revision=state_revision+1,status='awaiting-upload',updated_at=clock_timestamp() WHERE id=${id}`,
    ),
  ).toBe("23514");
});
it("keeps import audits finite and no-op replay does not append audit", async () => {
  const created = await safeTestOperation(
    () =>
      db.admin.sql<
        { idempotency_key: string }[]
      >`SELECT idempotency_key FROM qf.quizpack_import WHERE id=${id}`,
  );
  await importReceiveService.createIntent(
    db.app,
    actor.credentials,
    "permission-test",
    created[0]!.idempotency_key,
    {
      expectedArchiveBytes: 1,
      expectedArchiveSha256: "a".repeat(64),
      target: { kind: "new-draft" },
    },
  );
  const audits = await safeTestOperation(
    () =>
      db.admin.sql<
        { action: string; target_kind: string; target_revision: number }[]
      >`SELECT action,target_kind,target_revision FROM qf.audit_event WHERE target_kind='import'`,
  );
  expect(audits).toEqual([
    {
      action: "import_intent_created",
      target_kind: "import",
      target_revision: 1,
    },
  ]);
  const [valid] = await safeTestOperation(
    () =>
      db.admin.sql<
        { valid: boolean }[]
      >`SELECT qf.import_attempts_valid('[]'::jsonb,3,NULL,0) valid`,
  );
  expect(valid?.valid).toBe(true);
});
it("attempt identity and same-fence lease cannot mutate, and released disposition cannot return to held", async () => {
  const { createDatabase } = await import("../../src/lib/db/client"),
    { createImportReceiveService, importReceiveService } =
      await import("../../src/features/quizpack/import/service"),
    { createReceiveContext } =
      await import("../../src/features/quizpack/import/context");
  const c = createReceiveContext(new AbortController().signal),
    request = await createDatabase(db.config, c.context);
  const service = createImportReceiveService({
    beforeIo: async (op) => {
      if (op === "write") throw new Error("TEST_IO_FAILED");
    },
  });
  try {
    await expect(
      service.receiveArchive(
        request,
        actor.credentials,
        "permission-test",
        id,
        {
          chunks: {
            async *[Symbol.asyncIterator]() {
              yield new Uint8Array([1]);
            },
          },
          cancel: async () => {},
        },
        c.context,
      ),
    ).rejects.toThrow("RECEIVE_STORAGE_CONFLICT");
  } finally {
    c.dispose();
    await request.close();
  }
  expect(
    await fixedCode(
      () =>
        db.app
          .sql`UPDATE qf.quizpack_import SET state_revision=state_revision+1,updated_at=clock_timestamp(),lease_until=clock_timestamp()+interval '120 seconds' WHERE id=${id}`,
    ),
  ).toBe("23514");
  for (const key of ["fence", "ownerPid", "ownerNonce", "reservationBytes"]) {
    expect(
      await fixedCode(
        () =>
          db.app
            .sql`UPDATE qf.quizpack_import SET state_revision=state_revision+1,updated_at=clock_timestamp(),attempts=jsonb_set(attempts,${`{0,${key}}`}::text[], '0'::jsonb) WHERE id=${id}`,
      ),
    ).toBe("23514");
  }
  const snapshot = await importReceiveService.readImport(
      db.app,
      actor.session.raw,
      "permission-test",
      id,
    ),
    next = createReceiveContext(new AbortController().signal),
    fresh = await createDatabase(db.config, next.context);
  try {
    await importReceiveService.recoverReceive(
      fresh,
      actor.credentials,
      "permission-test",
      id,
      { expectedStateRevision: snapshot.stateRevision },
      next.context,
    );
  } finally {
    next.dispose();
    await fresh.close();
  }
  expect(
    await fixedCode(
      () =>
        db.app
          .sql`UPDATE qf.quizpack_import SET state_revision=state_revision+1,updated_at=clock_timestamp(),attempts=jsonb_set(attempts,'{0,disposition}', '"held"'::jsonb),reserved_bytes=65538 WHERE id=${id}`,
    ),
  ).toBe("23514");
});
it("revision/fence ceilings reject before consuming source or creating an attempt", async () => {
  const { createDatabase } = await import("../../src/lib/db/client"),
    { createReceiveContext } =
      await import("../../src/features/quizpack/import/context");
  await safeTestOperation(
    () =>
      db.admin
        .sql`UPDATE qf.quizpack_import SET state_revision=state_revision+1,updated_at=clock_timestamp(),fence=2147483647 WHERE id=${id}`,
  );
  let consumed = false;
  const test = async (importId: string) => {
    const c = createReceiveContext(new AbortController().signal),
      request = await createDatabase(db.config, c.context);
    try {
      await expect(
        importReceiveService.receiveArchive(
          request,
          actor.credentials,
          "permission-test",
          importId,
          {
            chunks: {
              async *[Symbol.asyncIterator]() {
                consumed = true;
                yield new Uint8Array([1]);
              },
            },
            cancel: async () => {},
          },
          c.context,
        ),
      ).rejects.toThrow("REVISION_LIMIT");
    } finally {
      c.dispose();
      await request.close();
    }
  };
  await test(id);
  expect(consumed).toBe(false);
  const maxId = randomUUID();
  await safeTestOperation(
    () =>
      db.admin
        .sql`INSERT INTO qf.quizpack_import(id,product_id,created_by,idempotency_key,request_fingerprint,expected_archive_sha256,expected_archive_bytes,target_kind,created_at,status,state_revision,updated_at) SELECT ${maxId},product_id,created_by,${randomUUID()},request_fingerprint,expected_archive_sha256,expected_archive_bytes,target_kind,created_at,'awaiting-upload',2147483647,updated_at FROM qf.quizpack_import WHERE id=${id}`,
  );
  await test(maxId);
  expect(consumed).toBe(false);
  const [fact] = await safeTestOperation(
    () =>
      db.admin.sql<
        { count: number }[]
      >`SELECT jsonb_array_length(attempts)::int count FROM qf.quizpack_import WHERE id=${maxId}`,
  );
  expect(fact?.count).toBe(0);
});
