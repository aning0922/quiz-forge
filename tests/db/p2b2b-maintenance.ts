import type { TestDatabase } from "./p2a-fixture";
import type { MediaOperationContext } from "@/features/quizpack/server/media";
import { ArchiveOperation } from "@/features/quizpack/validation/operation";
export function fixtureMaintenanceOperation(
  database: TestDatabase,
  context: MediaOperationContext,
) {
  return new ArchiveOperation(
    {
      ...database.app,
      sql: database.admin.sql,
      close: () => database.admin.close(),
    },
    context,
  );
}
export type FixtureAuditTarget = Readonly<{
  id: string;
  action: string;
  actor_id: string | null;
  session_id: string | null;
  target_kind: string | null;
  target_id: string | null;
  target_revision: number | null;
}>;
export type FixtureAuditScope = Readonly<{
  productId: string;
  importIds: ReadonlySet<string>;
  validationIds: ReadonlySet<string>;
  actorIds: ReadonlySet<string>;
  sessionIds: ReadonlySet<string>;
}>;
/** Authentication events must be from this fixture's actual sessions; business events must target its closed namespace. */
export function fixtureAuditAllowed(
  row: FixtureAuditTarget,
  scope: FixtureAuditScope,
): boolean {
  if (
    !row.actor_id ||
    !scope.actorIds.has(row.actor_id) ||
    !row.session_id ||
    !scope.sessionIds.has(row.session_id)
  )
    return false;
  if (row.target_kind === null)
    return (
      row.target_id === null &&
      row.target_revision === null &&
      ["login_succeeded", "logout"].includes(row.action)
    );
  if (
    row.target_id === null ||
    !Number.isInteger(row.target_revision) ||
    row.target_revision! < 1
  )
    return false;
  if (row.target_kind === "product")
    return (
      row.target_id === scope.productId &&
      [
        "product_created",
        "product_updated",
        "product_archived",
        "product_restored",
      ].includes(row.action)
    );
  if (row.target_kind === "import")
    return (
      scope.importIds.has(row.target_id) &&
      [
        "import_intent_created",
        "import_receive_started",
        "import_receive_completed",
        "import_receive_failed",
        "import_receive_recovered",
      ].includes(row.action)
    );
  if (row.target_kind === "validation")
    return (
      scope.validationIds.has(row.target_id) &&
      [
        "validation_started",
        "validation_evidenced",
        "validation_rejected",
        "validation_interrupted",
        "validation_completed",
        "validation_recovered",
        "validation_retried",
        "validation_file_stop_acknowledged",
      ].includes(row.action)
    );
  return false;
}
