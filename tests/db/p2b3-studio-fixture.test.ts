import { afterAll, beforeAll, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import {
  openTestDatabase,
  safeTestOperation as safe,
  type TestDatabase,
} from "./p2a-fixture";
import {
  prepareStudioDraftFixture,
  finishStudioDraftFixture,
  readStudioDraftFixture,
  cleanupStudioDraftFixture,
} from "./p2b3-studio-fixture";
import { createDatabase } from "@/lib/db/client";
import { createPreauth, login } from "@/lib/auth/service";
import { createProductDraftService } from "@/features/product/drafts/service";

let db: TestDatabase;
beforeAll(async () => {
  db = await safe(openTestDatabase);
});
afterAll(async () => {
  await db?.close();
});

it("refuses every foreign backend without deletion, then clears only the completed owned fixture while holding its own StorageLock", async () => {
  await safe(async () => {
    const runId = randomUUID(),
      value = await prepareStudioDraftFixture(db, runId),
      source = value.sources[0]!,
      preauth = await createPreauth(db.app, null, randomUUID()),
      session = await login(
        db.app,
        preauth.raw,
        preauth.dto.csrfToken,
        value.operator.secret,
        randomUUID(),
      );
    await createProductDraftService().applyReadyValidation(
      db.app,
      {
        sessionToken: session.raw,
        csrfToken: session.dto.csrfToken,
        requestId: randomUUID(),
      },
      {
        productId: source.productId,
        sourceImportId: source.sourceImportId,
        sourceValidationId: source.sourceValidationId,
      },
      {
        idempotencyKey: randomUUID(),
        expectedValidationStateRevision: source.stateRevision,
        expectedCandidateSha256: source.candidateSha256,
        target: { kind: "new-draft" },
      },
    );
    const completed = await finishStudioDraftFixture(db, runId),
      foreign = await createDatabase(db.config);
    try {
      await foreign.sql`SELECT 1`;
      await expect(cleanupStudioDraftFixture(db, completed)).rejects.toThrow(
        "DRAFTS_FIXTURE_SERVER_STILL_CONNECTED",
      );
      expect((await readStudioDraftFixture(db, runId)).completed).toBe(true);
      const [retained] = await db.admin.sql<
        { drafts: number; sources: number }[]
      >`
        SELECT (SELECT count(*)::int FROM qf.product_draft WHERE product_id=${source.productId}) drafts,
          (SELECT count(*)::int FROM qf.quizpack_validation WHERE product_id=ANY(${db.admin.sql.array(completed.sources.map((s) => s.productId))})) sources`;
      expect(retained).toMatchObject({ drafts: 1, sources: 2 });
    } finally {
      await foreign.close();
    }
    // A driver's close completion is not proof that the server has removed every backend.
    // Observe disappearance; never terminate connections or ignore unknown PIDs.
    const [app] = await db.app.sql<
      { pid: number }[]
    >`SELECT pg_backend_pid() pid`;
    const deadline = performance.now() + 3000;
    for (;;) {
      const [other] = await db.admin.sql<{ present: boolean }[]>`
        SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
          AND pid<>pg_backend_pid() AND pid<>${app!.pid}) present`;
      if (!other?.present) break;
      if (performance.now() >= deadline)
        throw new Error("TEST_FOREIGN_BACKEND_NOT_EXITED");
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    await cleanupStudioDraftFixture(db, completed);
    const [remaining] = await db.admin.sql<{ present: boolean }[]>`
      SELECT EXISTS(SELECT 1 FROM qf.product WHERE id=ANY(${db.admin.sql.array(completed.sources.map((s) => s.productId))})) present`;
    expect(remaining?.present).toBe(false);
    await expect(readStudioDraftFixture(db, runId)).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});
