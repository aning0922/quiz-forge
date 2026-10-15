import { randomUUID } from "node:crypto";
import { expect, it, vi } from "vitest";
import type { TestDatabase } from "./p2a-fixture";
import {
  fixtureMaintenanceOperation,
  fixtureAuditAllowed,
  type FixtureAuditTarget,
} from "./p2b2b-maintenance";
import {
  createMediaOperationContext,
  disposeMediaOperationContext,
} from "@/features/quizpack/server/media";
it("forced maintenance stop invalidates and drains the actual owner SQL rather than the already closed app", async () => {
  const appEnd = vi.fn(async () => {}),
    ownerEnd = vi.fn(async () => {}),
    fixture = {
      app: { sql: { end: appEnd } },
      admin: { sql: { end: ownerEnd }, close: vi.fn(async () => {}) },
    } as unknown as TestDatabase;
  const context = createMediaOperationContext({
      signal: new AbortController().signal,
      deadlineMonotonicMs: performance.now() + 60000,
    }),
    op = fixtureMaintenanceOperation(fixture, context);
  let resolve: () => void = () => {};
  const pending = new Promise<void>((r) => {
    resolve = r;
  });
  try {
    const task = op.databaseAwait("write", () => pending),
      failed = expect(task).rejects.toMatchObject({
        code: "WRITE_OUTCOME_UNKNOWN",
      });
    await Promise.resolve();
    op.stop("CANCELLED");
    await failed;
    expect(ownerEnd).toHaveBeenCalledTimes(1);
    expect(appEnd).not.toHaveBeenCalled();
    expect(op.completion().relatedIo).toBe("unconfirmed");
    resolve();
    await op.settle();
    expect(op.completion().relatedIo).toBe("settled");
    await op.db.close();
    expect(fixture.admin.close).toHaveBeenCalledTimes(1);
  } finally {
    resolve();
    disposeMediaOperationContext(context);
  }
});
const actor = randomUUID(),
  session = randomUUID(),
  importId = randomUUID(),
  validationId = randomUUID(),
  scope = {
    productId: "e2e-validations-12345678",
    importIds: new Set([importId]),
    validationIds: new Set([validationId]),
    actorIds: new Set([actor]),
    sessionIds: new Set([session]),
  };
const row = (
  target_kind: string | null,
  target_id: string | null,
  action: string,
): FixtureAuditTarget => ({
  id: randomUUID(),
  actor_id: actor,
  session_id: session,
  target_kind,
  target_id,
  action,
  target_revision: target_kind === null ? null : 1,
});
it.each([
  ["product", scope.productId, "product_created"],
  ["import", importId, "import_receive_completed"],
  ["validation", validationId, "validation_file_stop_acknowledged"],
  [null, null, "login_succeeded"],
  [null, null, "logout"],
])(
  "known fixture event %s is within its exact cleanup namespace",
  (kind, id, action) => {
    expect(fixtureAuditAllowed(row(kind, id, action!), scope)).toBe(true);
  },
);
it.each([
  ["product", "other-product", "product_created"],
  ["import", randomUUID(), "import_receive_completed"],
  ["validation", randomUUID(), "validation_completed"],
  ["category", randomUUID(), "category_created"],
  [null, null, "operator_disabled"],
  [null, null, "session_revoked"],
])(
  "foreign or unauthorizable %s event prevents cleanup",
  (kind, id, action) => {
    expect(fixtureAuditAllowed(row(kind, id, action!), scope)).toBe(false);
  },
);
it("authentication from another session or actor cannot be deleted as this fixture's authentication", () => {
  const event = row(null, null, "login_succeeded");
  expect(fixtureAuditAllowed({ ...event, actor_id: randomUUID() }, scope)).toBe(
    false,
  );
  expect(
    fixtureAuditAllowed({ ...event, session_id: randomUUID() }, scope),
  ).toBe(false);
});
