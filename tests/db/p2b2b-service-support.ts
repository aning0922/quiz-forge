import { randomUUID } from "node:crypto";
import type { StudioWriteCredentials } from "@/lib/auth/write";
import {
  loginVersionFixtureAccount,
  type FixtureAccount,
} from "./version-account-fixture";
import { createDatabase, type P2aDatabase } from "@/lib/db/client";
import { createValidationContext } from "@/features/quizpack/validation/operation";
import type { MediaOperationContext } from "@/features/quizpack/server/media";
import type { ValidationRow } from "@/features/quizpack/validation/repository";
import { safeTestOperation as safe, type TestDatabase } from "./p2a-fixture";

/** Always closes the exclusive real request connection; never grants cleanup authority. */
export async function serviceRequest<T>(
  fixture: TestDatabase,
  work: (db: P2aDatabase, context: MediaOperationContext) => Promise<T>,
): Promise<T> {
  const { context, dispose } = createValidationContext(
    new AbortController().signal,
  );
  let database: P2aDatabase | undefined;
  try {
    database = await createDatabase(fixture.config, {
      signal: context.signal,
      deadlineMonotonicMs: context.deadlineMonotonicMs,
    });
    return await safe(() => work(database!, context));
  } finally {
    try {
      await database?.close();
    } finally {
      dispose();
    }
  }
}

export async function fixtureCredentials(
  database: TestDatabase,
  actor: FixtureAccount,
): Promise<StudioWriteCredentials> {
  const session = await safe(() => loginVersionFixtureAccount(database, actor));
  return {
    sessionToken: session.raw,
    csrfToken: session.dto.csrfToken,
    requestId: randomUUID(),
  };
}

export async function serviceRow(database: TestDatabase, key: string) {
  const rows = await safe(
    () => database.admin.sql<ValidationRow[]>`
    SELECT * FROM qf.quizpack_validation WHERE validation_key=${key} LIMIT 2`,
  );
  if (rows.length !== 1) throw new Error("TEST_SERVICE_EXACT_RECORD_REQUIRED");
  return rows[0]!;
}

export async function validationAuditCount(database: TestDatabase, id: string) {
  const [row] = await safe(
    () => database.admin.sql<{ count: number }[]>`
    SELECT count(*)::int count FROM qf.audit_event WHERE target_kind='validation' AND target_id=${id}`,
  );
  if (!row) throw new Error("TEST_SERVICE_AUDIT_REQUIRED");
  return row.count;
}
