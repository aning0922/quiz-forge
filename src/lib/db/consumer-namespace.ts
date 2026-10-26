import "server-only";
import type postgres from "postgres";
import { StudioUnavailableError } from "./runtime";

const tables = [
  "operator",
  "operator_password_token",
  "operator_account_operation",
  "operator_kdf_attempt",
  "operator_session",
  "audit_event",
  "category",
  "tag",
  "product",
  "product_tag",
  "quizpack_import",
  "quizpack_validation",
  "asset_blob",
  "product_asset",
  "product_draft",
  "draft_application",
  "draft_revision",
  "draft_review",
  "product_version",
  "internal_play_version",
  "access_key",
  "consumer_session",
  "consumer_grant",
  "quiz_report",
  "consumer_exchange_budget",
] as const;
const enums = [
  "operator_role",
  "operator_status",
  "session_kind",
  "audit_action",
  "audit_outcome",
  "audit_reason",
] as const;

/** Closed qf namespace, complementary to the exact r-table catalog fingerprint.
 * Views can grant owner-mediated writes, so checking only ordinary base-table ACLs is insufficient.
 * Also runs BEFORE any migration DDL/privilege reset, including pristine 1->18 and existing 17/18.
 * No object is automatically removed or repaired. Absent qf is permitted only as migration bootstrap;
 * runtime's exact catalog still requires every table, helper and budget row.
 */
export async function assertConsumerNamespace(
  sql: postgres.Sql | postgres.ReservedSql,
): Promise<void> {
  const [row] = await sql<{ valid: boolean }[]>`
    WITH roles AS (
      SELECT (SELECT oid FROM pg_roles WHERE rolname=replace(current_user,'qf_app_','qf_owner_')) owner_id,
             (SELECT oid FROM pg_roles WHERE rolname=replace(current_user,'qf_owner_','qf_app_')) app_id
    ), ns AS (SELECT * FROM pg_namespace WHERE oid=to_regnamespace('qf'))
    SELECT (
      NOT EXISTS(SELECT 1 FROM ns WHERE nspowner IS DISTINCT FROM roles.owner_id
        OR EXISTS(SELECT 1 FROM aclexplode(coalesce(nspacl,acldefault('n',nspowner))) a
          WHERE NOT(a.grantee=roles.owner_id OR (a.grantee=roles.app_id AND a.privilege_type='USAGE' AND NOT a.is_grantable))))
      AND NOT EXISTS(SELECT 1 FROM pg_class c WHERE c.relnamespace=to_regnamespace('qf')
        AND (c.relowner IS DISTINCT FROM roles.owner_id OR c.relkind NOT IN ('r','i')
          OR (c.relkind='r' AND c.relname<>ALL(${sql.array([...tables])}::text[]))))
      AND NOT EXISTS(SELECT 1 FROM pg_type t WHERE t.typnamespace=to_regnamespace('qf') AND (
        t.typowner IS DISTINCT FROM roles.owner_id OR NOT (
          (t.typtype='c' AND t.typname=ANY(${sql.array([...tables])}::text[]) AND EXISTS(SELECT 1 FROM pg_class c WHERE c.oid=t.typrelid AND c.relkind='r' AND c.relnamespace=to_regnamespace('qf')))
          OR (t.typtype='e' AND t.typname=ANY(${sql.array([...enums])}::text[]))
          OR (t.typtype='b' AND t.typcategory='A' AND EXISTS(SELECT 1 FROM pg_type element WHERE element.oid=t.typelem AND element.typnamespace=to_regnamespace('qf')
            AND element.typname=ANY(${sql.array([...tables, ...enums])}::text[]) AND t.typname='_'||element.typname))
        )))
      AND NOT EXISTS(SELECT 1 FROM pg_rewrite r JOIN pg_class c ON c.oid=r.ev_class WHERE c.relnamespace=to_regnamespace('qf'))
      AND NOT EXISTS(SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid=p.polrelid WHERE c.relnamespace=to_regnamespace('qf'))
      AND NOT EXISTS(SELECT 1 FROM pg_collation WHERE collnamespace=to_regnamespace('qf'))
      AND NOT EXISTS(SELECT 1 FROM pg_operator WHERE oprnamespace=to_regnamespace('qf'))
      AND NOT EXISTS(SELECT 1 FROM pg_opclass WHERE opcnamespace=to_regnamespace('qf'))
      AND NOT EXISTS(SELECT 1 FROM pg_opfamily WHERE opfnamespace=to_regnamespace('qf'))
      AND NOT EXISTS(SELECT 1 FROM pg_default_acl WHERE defaclnamespace=to_regnamespace('qf'))
      AND NOT EXISTS(SELECT 1 FROM pg_conversion WHERE connamespace=to_regnamespace('qf'))
      AND NOT EXISTS(SELECT 1 FROM pg_statistic_ext WHERE stxnamespace=to_regnamespace('qf'))
      AND NOT EXISTS(SELECT 1 FROM pg_ts_config WHERE cfgnamespace=to_regnamespace('qf'))
      AND NOT EXISTS(SELECT 1 FROM pg_ts_dict WHERE dictnamespace=to_regnamespace('qf'))
      AND NOT EXISTS(SELECT 1 FROM pg_ts_parser WHERE prsnamespace=to_regnamespace('qf'))
      AND NOT EXISTS(SELECT 1 FROM pg_ts_template WHERE tmplnamespace=to_regnamespace('qf'))
    ) IS TRUE AS valid FROM roles`;
  if (row?.valid !== true) throw new StudioUnavailableError();
}
