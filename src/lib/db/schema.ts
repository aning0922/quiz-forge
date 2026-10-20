import "server-only";
import { sql } from "drizzle-orm";
import {
  char,
  bigint,
  jsonb,
  text,
  check,
  index,
  integer,
  primaryKey,
  unique,
  pgSchema,
  smallint,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const qf = pgSchema("qf");
export const operatorRole = qf.enum("operator_role", ["operator", "read-only"]);
export const operatorStatus = qf.enum("operator_status", [
  "active",
  "disabled",
]);
export const sessionKind = qf.enum("session_kind", [
  "preauth",
  "authenticated",
]);
export const auditAction = qf.enum("audit_action", [
  "bootstrap",
  "operator_disabled",
  "preauth_created",
  "login_succeeded",
  "login_failed",
  "logout",
  "session_revoked",
  "product_created",
  "product_updated",
  "product_archived",
  "product_restored",
  "category_created",
  "category_updated",
  "category_archived",
  "category_restored",
  "tag_created",
  "tag_updated",
  "tag_archived",
  "tag_restored",
  "import_intent_created",
  "import_receive_started",
  "import_receive_completed",
  "import_receive_failed",
  "import_receive_recovered",
]);
export const auditOutcome = qf.enum("audit_outcome", ["success", "rejected"]);
export const auditReason = qf.enum("audit_reason", [
  "AUTHENTICATION_FAILED",
  "PREAUTH_EXPIRED",
  "PREAUTH_REVOKED",
  "RATE_LIMITED",
  "SESSION_EXPIRED",
  "SESSION_REVOKED",
  "OPERATOR_DISABLED",
  "MANUAL",
]);
const time = (name: string) =>
  timestamp(name, { withTimezone: true, mode: "date" });

export const operators = qf.table(
  "operator",
  {
    id: uuid("id").primaryKey(),
    label: varchar("label", { length: 64 }).notNull().unique(),
    credentialDigest: char("credential_digest", { length: 64 })
      .notNull()
      .unique(),
    role: operatorRole("role").notNull(),
    status: operatorStatus("status").notNull(),
    createdAt: time("created_at").notNull().defaultNow(),
    disabledAt: time("disabled_at"),
  },
  (t) => [
    check("operator_label", sql`${t.label} ~ '^[a-z0-9-]{1,64}$'`),
    check("operator_digest", sql`${t.credentialDigest} ~ '^[0-9a-f]{64}$'`),
    check(
      "operator_status_time",
      sql`(${t.status} = 'active' AND ${t.disabledAt} IS NULL) OR (${t.status} = 'disabled' AND ${t.disabledAt} IS NOT NULL AND ${t.disabledAt} >= ${t.createdAt})`,
    ),
  ],
);

export const operatorSessions = qf.table(
  "operator_session",
  {
    id: uuid("id").primaryKey(),
    tokenDigest: char("token_digest", { length: 64 }).notNull().unique(),
    kind: sessionKind("kind").notNull(),
    operatorId: uuid("operator_id").references(() => operators.id, {
      onDelete: "restrict",
    }),
    createdAt: time("created_at").notNull(),
    lastSeenAt: time("last_seen_at").notNull(),
    idleExpiresAt: time("idle_expires_at").notNull(),
    absoluteExpiresAt: time("absolute_expires_at").notNull(),
    revokedAt: time("revoked_at"),
    failedAttempts: smallint("failed_attempts").notNull().default(0),
  },
  (t) => [
    index("session_operator_revoked").on(t.operatorId, t.revokedAt),
    index("session_absolute").on(t.absoluteExpiresAt),
    check("session_digest", sql`${t.tokenDigest} ~ '^[0-9a-f]{64}$'`),
    check("session_attempts", sql`${t.failedAttempts} BETWEEN 0 AND 5`),
    check(
      "session_identity",
      sql`(${t.kind} = 'preauth' AND ${t.operatorId} IS NULL) OR (${t.kind} = 'authenticated' AND ${t.operatorId} IS NOT NULL AND ${t.failedAttempts} = 0)`,
    ),
    check(
      "session_times",
      sql`${t.createdAt} <= ${t.lastSeenAt} AND ${t.lastSeenAt} < ${t.absoluteExpiresAt} AND ${t.createdAt} < ${t.idleExpiresAt} AND ${t.idleExpiresAt} <= ${t.absoluteExpiresAt} AND (${t.revokedAt} IS NULL OR ${t.revokedAt} >= ${t.createdAt})`,
    ),
    check(
      "session_lifetime",
      sql`(${t.kind} = 'preauth' AND ${t.absoluteExpiresAt} = ${t.createdAt} + interval '5 minutes' AND ${t.idleExpiresAt} = ${t.absoluteExpiresAt}) OR (${t.kind} = 'authenticated' AND ${t.absoluteExpiresAt} = ${t.createdAt} + interval '8 hours' AND ${t.idleExpiresAt} <= ${t.lastSeenAt} + interval '30 minutes')`,
    ),
  ],
);

export const auditEvents = qf.table(
  "audit_event",
  {
    id: uuid("id").primaryKey(),
    occurredAt: time("occurred_at").notNull().defaultNow(),
    action: auditAction("action").notNull(),
    outcome: auditOutcome("outcome").notNull(),
    reasonCode: auditReason("reason_code"),
    actorId: uuid("actor_id").references(() => operators.id, {
      onDelete: "restrict",
    }),
    sessionId: uuid("session_id"),
    requestId: uuid("request_id").notNull(),
    targetKind: varchar("target_kind", { length: 8 }),
    targetId: varchar("target_id", { length: 80 }),
    targetRevision: integer("target_revision"),
  },
  (t) => [index("audit_action_time").on(t.action, t.occurredAt)],
);

export type Operator = typeof operators.$inferSelect;
export type OperatorSession = typeof operatorSessions.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;

// SQL migration owns the full CHECK constraints, including Unicode text and audit targets.
const taxonomyColumns = () => ({
  id: uuid("id").primaryKey(),
  slug: varchar("slug", { length: 80 }).notNull().unique(),
  name: varchar("name", { length: 40 }).notNull(),
  revision: integer("revision").notNull().default(1),
  createdAt: time("created_at")
    .notNull()
    .default(sql`clock_timestamp()`),
  updatedAt: time("updated_at").notNull(),
  archivedAt: time("archived_at"),
});
export const categories = qf.table("category", taxonomyColumns(), (t) => [
  index("category_archived_created").on(t.archivedAt, t.createdAt.desc(), t.id),
]);
export const tags = qf.table("tag", taxonomyColumns(), (t) => [
  index("tag_archived_created").on(t.archivedAt, t.createdAt.desc(), t.id),
]);
export const products = qf.table(
  "product",
  {
    id: varchar("id", { length: 80 }).primaryKey(),
    slug: varchar("slug", { length: 80 }).notNull().unique(),
    title: varchar("title", { length: 120 }).notNull(),
    primaryCategoryId: uuid("primary_category_id").references(
      () => categories.id,
      { onUpdate: "restrict", onDelete: "restrict" },
    ),
    metadataRevision: integer("metadata_revision").notNull().default(1),
    createdAt: time("created_at")
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: time("updated_at").notNull(),
    archivedAt: time("archived_at"),
  },
  (t) => [
    index("product_archived_created").on(
      t.archivedAt,
      t.createdAt.desc(),
      t.id,
    ),
    index("product_category").on(t.primaryCategoryId),
  ],
);
export const productTags = qf.table(
  "product_tag",
  {
    productId: varchar("product_id", { length: 80 })
      .notNull()
      .references(() => products.id, {
        onUpdate: "restrict",
        onDelete: "restrict",
      }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, {
        onUpdate: "restrict",
        onDelete: "restrict",
      }),
    slot: smallint("slot").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.productId, t.tagId] }),
    unique("product_tag_product_id_slot_key").on(t.productId, t.slot),
    check("product_tag_slot_check", sql`${t.slot} BETWEEN 1 AND 8`),
    index("product_tag_reverse").on(t.tagId, t.productId),
  ],
);
export type Product = typeof products.$inferSelect;
export type Category = typeof categories.$inferSelect;
export type Tag = typeof tags.$inferSelect;

// Full state/attempt/immutable constraints are owned by the append-only SQL migrations.
export const quizpackImports = qf.table("quizpack_import", {
  id: uuid("id").primaryKey(),
  productId: varchar("product_id", { length: 80 })
    .notNull()
    .references(() => products.id, { onDelete: "restrict" }),
  createdBy: uuid("created_by")
    .notNull()
    .references(() => operators.id, { onDelete: "restrict" }),
  idempotencyKey: uuid("idempotency_key").notNull(),
  requestFingerprint: char("request_fingerprint", { length: 64 }).notNull(),
  expectedArchiveSha256: char("expected_archive_sha256", {
    length: 64,
  }).notNull(),
  expectedArchiveBytes: integer("expected_archive_bytes").notNull(),
  targetKind: text("target_kind").notNull(),
  createdAt: time("created_at").notNull(),
  status: text("status").notNull(),
  stateRevision: integer("state_revision").notNull(),
  updatedAt: time("updated_at").notNull(),
  storageCondition: text("storage_condition").notNull(),
  lastErrorCode: text("last_error_code"),
  fence: integer("fence").notNull(),
  leaseUntil: time("lease_until"),
  currentAttemptId: uuid("current_attempt_id"),
  attempts: jsonb("attempts").notNull(),
  actualArchiveSha256: char("actual_archive_sha256", { length: 64 }),
  actualArchiveBytes: integer("actual_archive_bytes"),
  archiveStorageKey: varchar("archive_storage_key", { length: 160 }),
  receivedAt: time("received_at"),
  reservedBytes: bigint("reserved_bytes", { mode: "number" }).notNull(),
  accountedBytes: bigint("accounted_bytes", { mode: "number" }).notNull(),
});
