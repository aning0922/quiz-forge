import "server-only";
import { sql } from "drizzle-orm";
import {
  char,
  bigint,
  boolean,
  jsonb,
  text,
  check,
  index,
  integer,
  primaryKey,
  foreignKey,
  unique,
  pgSchema,
  smallint,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";

export const qf = pgSchema("qf");
export const operatorRole = qf.enum("operator_role", [
  "operator",
  "read-only",
  "admin",
]);
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
  "account_operation",
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
  "validation_started",
  "validation_evidenced",
  "validation_rejected",
  "validation_interrupted",
  "validation_completed",
  "validation_recovered",
  "validation_retried",
  "validation_file_stop_acknowledged",
  "draft_applied",
  "draft_baseline_recorded",
  "internal_version_sealed",
  "internal_play_created",
  "access_key_issued",
  "access_key_voided",
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
    credentialDigest: char("credential_digest", { length: 64 }).unique(),
    loginName: varchar("login_name", { length: 64 }).unique(),
    displayName: varchar("display_name", { length: 320 }),
    passwordHash: varchar("password_hash", { length: 256 }),
    accountRevision: integer("account_revision").notNull().default(1),
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
    passwordAttemptId: uuid("password_attempt_id"),
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
    targetKind: varchar("target_kind", { length: 16 }),
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

// Exact relationships and immutable transition checks live in migration 0010.
export const quizpackValidations = qf.table("quizpack_validation", {
  id: uuid("id").notNull().primaryKey(),
  productId: varchar("product_id", { length: 80 }).notNull(),
  importId: uuid("import_id").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: time("created_at").notNull(),
  validationKey: char("validation_key", { length: 64 }).notNull(),
  archiveSha256: char("archive_sha256", { length: 64 }).notNull(),
  archiveBytes: integer("archive_bytes").notNull(),
  identityText: text("identity_text").notNull(),
  identitySha256: char("identity_sha256", { length: 64 }).notNull(),
  archivePolicyVersion: varchar("archive_policy_version", {
    length: 64,
  }).notNull(),
  archivePolicySha256: char("archive_policy_sha256", { length: 64 }).notNull(),
  status: text("status").notNull(),
  stateRevision: integer("state_revision").notNull(),
  updatedAt: time("updated_at").notNull(),
  fence: integer("fence").notNull(),
  leaseUntil: time("lease_until"),
  currentAttemptId: uuid("current_attempt_id").notNull(),
  attemptsText: text("attempts_text").notNull(),
  storageCondition: text("storage_condition").notNull(),
  lastErrorCode: varchar("last_error_code", { length: 64 }),
  reservedBytes: bigint("reserved_bytes", { mode: "number" }).notNull(),
  accountedBytes: bigint("accounted_bytes", { mode: "number" }).notNull(),
  evidenceText: text("evidence_text"),
  evidenceSha256: char("evidence_sha256", { length: 64 }),
  reportTexts: text("report_texts").array().notNull(),
  evidenceMetadataText: text("evidence_metadata_text"),
  packId: varchar("pack_id", { length: 80 }),
  packVersion: varchar("pack_version", { length: 32 }),
  containerSchemaVersion: varchar("container_schema_version", { length: 64 }),
  contentSchemaVersion: varchar("content_schema_version", { length: 64 }),
  contentKind: varchar("content_kind", { length: 32 }),
  manifestSha256: char("manifest_sha256", { length: 64 }),
  contentSha256: char("content_sha256", { length: 64 }),
  canonicalManifestText: text("canonical_manifest_text"),
  canonicalManifestSha256: char("canonical_manifest_sha256", { length: 64 }),
  canonicalContentText: text("canonical_content_text"),
  canonicalContentSha256: char("canonical_content_sha256", { length: 64 }),
  assetSetText: text("asset_set_text"),
  assetSetSha256: char("asset_set_sha256", { length: 64 }),
  candidateSha256: char("candidate_sha256", { length: 64 }),
  resourceCount: smallint("resource_count"),
  identityKind: text("identity_kind").notNull(),
  canonicalValidationId: uuid("canonical_validation_id"),
  validatedAt: time("validated_at"),
  readyAt: time("ready_at"),
});

// Exact relationships and immutable transition checks live in migration 0010.
export const assetBlobs = qf.table("asset_blob", {
  sha256: char("sha256", { length: 64 }).notNull().primaryKey(),
  bytes: integer("bytes").notNull(),
  mediaType: varchar("media_type", { length: 32 }).notNull(),
  width: integer("width").notNull(),
  height: integer("height").notNull(),
  frames: smallint("frames").notNull(),
  storageKey: varchar("storage_key", { length: 96 }).notNull(),
  createdAt: time("created_at").notNull(),
});

// Exact relationships and immutable transition checks live in migration 0010.
export const productAssets = qf.table("product_asset", {
  productId: varchar("product_id", { length: 80 }).notNull(),
  resourceId: varchar("resource_id", { length: 80 }).notNull(),
  resourceVersion: varchar("resource_version", { length: 32 }).notNull(),
  blobSha256: char("blob_sha256", { length: 64 }).notNull(),
  declarationText: text("declaration_text").notNull(),
  declarationSha256: char("declaration_sha256", { length: 64 }).notNull(),
  purpose: varchar("purpose", { length: 16 }).notNull(),
  sourceValidationId: uuid("source_validation_id").notNull(),
  platformApproval: varchar("platform_approval", { length: 16 }).notNull(),
  createdAt: time("created_at").notNull(),
});

// Composite closure/permissions are defined in 0014; supported admission is defined in 0015.
export const productDrafts = qf.table("product_draft", {
  id: uuid("id").notNull().primaryKey(),
  productId: varchar("product_id", { length: 80 }).notNull(),
  currentRevision: integer("current_revision").notNull(),
  initialApplicationId: uuid("initial_application_id").notNull(),
  initialRevision: integer("initial_revision").notNull().default(1),
  createdBy: uuid("created_by").notNull(),
  createdAt: time("created_at").notNull(),
});

// Composite closure/permissions are defined in 0014; supported admission is defined in 0015.
export const draftRevisions = qf.table("draft_revision", {
  productId: varchar("product_id", { length: 80 }).notNull(),
  draftId: uuid("draft_id").notNull(),
  revision: integer("revision").notNull(),
  applicationId: uuid("application_id").notNull(),
  sourceImportId: uuid("source_import_id").notNull(),
  sourceValidationId: uuid("source_validation_id").notNull(),
  sourceValidationStateRevision: integer(
    "source_validation_state_revision",
  ).notNull(),
  canonicalContentText: text("canonical_content_text").notNull(),
  canonicalContentSha256: char("canonical_content_sha256", {
    length: 64,
  }).notNull(),
  assetSetText: text("asset_set_text").notNull(),
  assetSetSha256: char("asset_set_sha256", { length: 64 }).notNull(),
  canonicalManifestSha256: char("canonical_manifest_sha256", {
    length: 64,
  }).notNull(),
  candidateSha256: char("candidate_sha256", { length: 64 }).notNull(),
  containerSchemaVersion: varchar("container_schema_version", {
    length: 64,
  }).notNull(),
  contentSchemaVersion: varchar("content_schema_version", {
    length: 64,
  }).notNull(),
  contentKind: varchar("content_kind", { length: 32 }).notNull(),
  packId: varchar("pack_id", { length: 80 }).notNull(),
  packVersion: varchar("pack_version", { length: 32 }).notNull(),
  contentVersion: varchar("content_version", { length: 32 }).notNull(),
  visualVersion: varchar("visual_version", { length: 32 }).notNull(),
  reportVersion: varchar("report_version", { length: 32 }).notNull(),
  resourceVersion: varchar("resource_version", { length: 32 }).notNull(),
  componentVersion: varchar("component_version", { length: 32 }).notNull(),
  engineId: varchar("engine_id", { length: 32 }).notNull(),
  engineVersion: varchar("engine_version", { length: 32 }).notNull(),
  resourceCount: smallint("resource_count").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: time("created_at").notNull(),
});

// Composite closure/permissions are defined in 0014; supported admission is defined in 0015.
export const draftApplications = qf.table("draft_application", {
  id: uuid("id").notNull().primaryKey(),
  productId: varchar("product_id", { length: 80 }).notNull(),
  idempotencyKey: uuid("idempotency_key").notNull(),
  fingerprint: char("fingerprint", { length: 64 }).notNull(),
  sourceImportId: uuid("source_import_id").notNull(),
  sourceValidationId: uuid("source_validation_id").notNull(),
  expectedValidationStateRevision: integer(
    "expected_validation_state_revision",
  ).notNull(),
  expectedCandidateSha256: char("expected_candidate_sha256", {
    length: 64,
  }).notNull(),
  targetKind: text("target_kind").notNull(),
  expectedDraftRevision: integer("expected_draft_revision"),
  expectedBaseContentSha256: char("expected_base_content_sha256", {
    length: 64,
  }),
  expectedBaseAssetSetSha256: char("expected_base_asset_set_sha256", {
    length: 64,
  }),
  draftId: uuid("draft_id").notNull(),
  revision: integer("revision").notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: time("created_at").notNull(),
});

// Exact composite references, source checks and finite ACL are authoritative in 0017.
export const draftReviews = qf.table("draft_review", {
  id: uuid("id").primaryKey(),
  productId: varchar("product_id", { length: 80 }).notNull(),
  draftId: uuid("draft_id").notNull(),
  revision: integer("revision").notNull(),
  canonicalContentSha256: char("canonical_content_sha256", {
    length: 64,
  }).notNull(),
  assetSetSha256: char("asset_set_sha256", { length: 64 }).notNull(),
  canonicalManifestSha256: char("canonical_manifest_sha256", {
    length: 64,
  }).notNull(),
  sourceImportId: uuid("source_import_id").notNull(),
  sourceValidationId: uuid("source_validation_id").notNull(),
  sourceValidationStateRevision: integer(
    "source_validation_state_revision",
  ).notNull(),
  purpose: text("purpose").notNull(),
  idempotencyKey: uuid("idempotency_key").notNull(),
  bindingText: text("binding_text").notNull(),
  fingerprint: char("fingerprint", { length: 64 }).notNull(),
  factsText: text("facts_text").notNull(),
  reviewSha256: char("review_sha256", { length: 64 }).notNull(),
  recordedBy: uuid("recorded_by").notNull(),
  recordedAt: time("recorded_at").notNull(),
});
export const productVersions = qf.table("product_version", {
  id: uuid("id").primaryKey(),
  productId: varchar("product_id", { length: 80 }).notNull(),
  slot: integer("slot").notNull(),
  draftId: uuid("draft_id").notNull(),
  revision: integer("revision").notNull(),
  canonicalContentSha256: char("canonical_content_sha256", {
    length: 64,
  }).notNull(),
  assetSetSha256: char("asset_set_sha256", { length: 64 }).notNull(),
  canonicalManifestSha256: char("canonical_manifest_sha256", {
    length: 64,
  }).notNull(),
  reviewId: uuid("review_id").notNull(),
  reviewSha256: char("review_sha256", { length: 64 }).notNull(),
  purpose: text("purpose").notNull(),
  publicationApproved: boolean("publication_approved").notNull(),
  idempotencyKey: uuid("idempotency_key").notNull(),
  bindingText: text("binding_text").notNull(),
  fingerprint: char("fingerprint", { length: 64 }).notNull(),
  snapshotText: text("snapshot_text").notNull(),
  snapshotSha256: char("snapshot_sha256", { length: 64 }).notNull(),
  createdBy: uuid("created_by").notNull(),
  createdAt: time("created_at").notNull(),
});

// P4: exact SQL CHECK/trigger/ACL definitions are owned by immutable migration 0018.
export const internalPlayVersions = qf.table(
  "internal_play_version",
  {
    id: uuid("id").primaryKey(),
    productId: varchar("product_id", { length: 80 }).notNull(),
    slot: integer("slot").notNull(),
    parentVersionId: uuid("parent_version_id").notNull(),
    parentSnapshotSha256: char("parent_snapshot_sha256", {
      length: 64,
    }).notNull(),
    operationKey: uuid("operation_key").notNull(),
    bindingText: text("binding_text").notNull(),
    bindingSha256: char("binding_sha256", { length: 64 }).notNull(),
    snapshotText: text("snapshot_text").notNull(),
    snapshotSha256: char("snapshot_sha256", { length: 64 }).notNull(),
    createdBy: uuid("created_by").notNull(),
    createdAt: time("created_at").notNull(),
  },
  (t) => [
    unique("internal_play_capacity").on(t.productId, t.slot),
    unique("internal_play_exact").on(t.id, t.productId, t.snapshotSha256),
    unique("internal_play_operation").on(t.productId, t.operationKey),
    foreignKey({
      name: "internal_play_parent",
      columns: [t.parentVersionId, t.productId, t.parentSnapshotSha256],
      foreignColumns: [
        productVersions.id,
        productVersions.productId,
        productVersions.snapshotSha256,
      ],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    unique("internal_play_snapshot").on(t.productId, t.snapshotSha256),
    check(
      "internal_play_text_exact",
      sql.raw("((qf.consumer_play_valid(internal_play_version.*) IS TRUE))"),
    ),
    check(
      "internal_play_version_binding_sha256_check",
      sql.raw("((binding_sha256 ~ '^[a-f0-9]{64}$'::text))"),
    ),
    foreignKey({
      name: "internal_play_version_created_by_fkey",
      columns: [t.createdBy],
      foreignColumns: [operators.id],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    check(
      "internal_play_version_slot_check",
      sql.raw("(((slot >= 1) AND (slot <= 100)))"),
    ),
    check(
      "internal_play_version_snapshot_sha256_check",
      sql.raw("((snapshot_sha256 ~ '^[a-f0-9]{64}$'::text))"),
    ),
  ],
);
export const accessKeys = qf.table(
  "access_key",
  {
    id: uuid("id").primaryKey(),
    productId: varchar("product_id", { length: 80 }).notNull(),
    playVersionId: uuid("play_version_id").notNull(),
    playSnapshotSha256: char("play_snapshot_sha256", { length: 64 }).notNull(),
    credentialDigest: char("credential_digest", { length: 64 }).notNull(),
    issueOperationKey: uuid("issue_operation_key").notNull(),
    issueBindingText: text("issue_binding_text").notNull(),
    issueBindingSha256: char("issue_binding_sha256", { length: 64 }).notNull(),
    validForSeconds: integer("valid_for_seconds").notNull(),
    issuedBy: uuid("issued_by").notNull(),
    issuedAt: time("issued_at").notNull(),
    expiresAt: time("expires_at").notNull(),
    revokedAt: time("revoked_at"),
    voidOperationKey: uuid("void_operation_key"),
    voidBindingText: text("void_binding_text"),
    voidBindingSha256: char("void_binding_sha256", { length: 64 }),
    voidedBy: uuid("voided_by"),
  },
  (t) => [
    check(
      "access_key_credential_digest_check",
      sql.raw("((credential_digest ~ '^[a-f0-9]{64}$'::text))"),
    ),
    unique("access_key_credential_digest_key").on(t.credentialDigest),
    unique("access_key_exact").on(
      t.id,
      t.productId,
      t.playVersionId,
      t.playSnapshotSha256,
    ),
    check(
      "access_key_issue_binding_sha256_check",
      sql.raw("((issue_binding_sha256 ~ '^[a-f0-9]{64}$'::text))"),
    ),
    unique("access_key_issue_operation").on(t.productId, t.issueOperationKey),
    foreignKey({
      name: "access_key_issued_by_fkey",
      columns: [t.issuedBy],
      foreignColumns: [operators.id],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    foreignKey({
      name: "access_key_play",
      columns: [t.playVersionId, t.productId, t.playSnapshotSha256],
      foreignColumns: [
        internalPlayVersions.id,
        internalPlayVersions.productId,
        internalPlayVersions.snapshotSha256,
      ],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    check(
      "access_key_text_exact",
      sql.raw("((qf.consumer_key_valid(access_key.*) IS TRUE))"),
    ),
    check(
      "access_key_valid_for_seconds_check",
      sql.raw(
        "(((valid_for_seconds >= 3600) AND (valid_for_seconds <= 2592000)))",
      ),
    ),
    unique("access_key_void_operation").on(t.productId, t.voidOperationKey),
    foreignKey({
      name: "access_key_voided_by_fkey",
      columns: [t.voidedBy],
      foreignColumns: [operators.id],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
  ],
);
export const consumerSessions = qf.table(
  "consumer_session",
  {
    id: uuid("id").primaryKey(),
    keyId: uuid("key_id").notNull(),
    productId: varchar("product_id", { length: 80 }).notNull(),
    playVersionId: uuid("play_version_id").notNull(),
    playSnapshotSha256: char("play_snapshot_sha256", { length: 64 }).notNull(),
    createdAt: time("created_at").notNull(),
    stateRevision: integer("state_revision").notNull(),
    answersText: text("answers_text").notNull(),
    consumerStateAnswersSha256: char("consumer_state_answers_sha256", {
      length: 64,
    }).notNull(),
    progressText: text("progress_text").notNull(),
    progressSha256: char("progress_sha256", { length: 64 }).notNull(),
    lastBindingText: text("last_binding_text"),
    lastBindingSha256: char("last_binding_sha256", { length: 64 }),
    lastReceiptText: text("last_receipt_text"),
    lastReceiptSha256: char("last_receipt_sha256", { length: 64 }),
  },
  (t) => [
    unique("consumer_session_claim").on(t.keyId, t.id),
    unique("consumer_session_final").on(
      t.id,
      t.keyId,
      t.productId,
      t.playVersionId,
      t.playSnapshotSha256,
      t.stateRevision,
      t.consumerStateAnswersSha256,
      t.progressSha256,
    ),
    foreignKey({
      name: "consumer_session_key",
      columns: [t.keyId, t.productId, t.playVersionId, t.playSnapshotSha256],
      foreignColumns: [
        accessKeys.id,
        accessKeys.productId,
        accessKeys.playVersionId,
        accessKeys.playSnapshotSha256,
      ],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    unique("consumer_session_key_id_key").on(t.keyId),
    check(
      "consumer_session_state_revision_check",
      sql.raw("(((state_revision >= 0) AND (state_revision <= 2147483647)))"),
    ),
    check(
      "consumer_session_text_exact",
      sql.raw("((qf.consumer_session_valid(consumer_session.*) IS TRUE))"),
    ),
  ],
);
export const consumerGrants = qf.table(
  "consumer_grant",
  {
    keyId: uuid("key_id").notNull(),
    slot: smallint("slot").notNull(),
    sessionId: uuid("session_id").notNull(),
    grantId: uuid("grant_id").notNull(),
    credentialDigest: char("credential_digest", { length: 64 }).notNull(),
    issuedAt: time("issued_at").notNull(),
    expiresAt: time("expires_at").notNull(),
    revokedAt: time("revoked_at"),
  },
  (t) => [
    check(
      "consumer_grant_credential_digest_check",
      sql.raw("((credential_digest ~ '^[a-f0-9]{64}$'::text))"),
    ),
    unique("consumer_grant_credential_digest_key").on(t.credentialDigest),
    unique("consumer_grant_grant_id_key").on(t.grantId),
    primaryKey({ name: "consumer_grant_pkey", columns: [t.keyId, t.slot] }),
    foreignKey({
      name: "consumer_grant_session",
      columns: [t.keyId, t.sessionId],
      foreignColumns: [consumerSessions.keyId, consumerSessions.id],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    check(
      "consumer_grant_slot_check",
      sql.raw("(((slot >= 1) AND (slot <= 16)))"),
    ),
    check(
      "consumer_grant_times",
      sql.raw(
        "((((qf.consumer_moment(issued_at) IS NOT NULL) AND (qf.consumer_moment(expires_at) IS NOT NULL) AND (expires_at = (issued_at + '08:00:00'::interval)) AND ((revoked_at IS NULL) OR ((qf.consumer_moment(revoked_at) IS NOT NULL) AND (revoked_at >= issued_at)))) IS TRUE))",
      ),
    ),
  ],
);
export const quizReports = qf.table(
  "quiz_report",
  {
    id: uuid("id").primaryKey(),
    keyId: uuid("key_id").notNull(),
    sessionId: uuid("session_id").notNull(),
    productId: varchar("product_id", { length: 80 }).notNull(),
    playVersionId: uuid("play_version_id").notNull(),
    playSnapshotSha256: char("play_snapshot_sha256", { length: 64 }).notNull(),
    stateRevision: integer("state_revision").notNull(),
    consumerStateAnswersSha256: char("consumer_state_answers_sha256", {
      length: 64,
    }).notNull(),
    progressSha256: char("progress_sha256", { length: 64 }).notNull(),
    completionKey: uuid("completion_key").notNull(),
    bindingText: text("binding_text").notNull(),
    bindingSha256: char("binding_sha256", { length: 64 }).notNull(),
    snapshotText: text("snapshot_text").notNull(),
    snapshotSha256: char("snapshot_sha256", { length: 64 }).notNull(),
    displaySha256: char("display_sha256", { length: 64 }).notNull(),
    completedAt: time("completed_at").notNull(),
  },
  (t) => [
    unique("quiz_report_key_id_key").on(t.keyId),
    unique("quiz_report_operation").on(t.sessionId, t.completionKey),
    foreignKey({
      name: "quiz_report_session_final",
      columns: [
        t.sessionId,
        t.keyId,
        t.productId,
        t.playVersionId,
        t.playSnapshotSha256,
        t.stateRevision,
        t.consumerStateAnswersSha256,
        t.progressSha256,
      ],
      foreignColumns: [
        consumerSessions.id,
        consumerSessions.keyId,
        consumerSessions.productId,
        consumerSessions.playVersionId,
        consumerSessions.playSnapshotSha256,
        consumerSessions.stateRevision,
        consumerSessions.consumerStateAnswersSha256,
        consumerSessions.progressSha256,
      ],
    })
      .onUpdate("restrict")
      .onDelete("restrict"),
    unique("quiz_report_session_id_key").on(t.sessionId),
    check(
      "quiz_report_text_exact",
      sql.raw("((qf.consumer_report_valid(quiz_report.*) IS TRUE))"),
    ),
  ],
);
export const consumerExchangeBudgets = qf.table(
  "consumer_exchange_budget",
  {
    singleton: boolean("singleton").primaryKey(),
    windowIndex: bigint("window_index", { mode: "bigint" }).notNull(),
    used: smallint("used").notNull(),
  },
  () => [
    check(
      "consumer_exchange_budget_singleton_check",
      sql.raw("((singleton IS TRUE))"),
    ),
    check(
      "consumer_exchange_budget_used_check",
      sql.raw("(((used >= 0) AND (used <= 60)))"),
    ),
    check(
      "consumer_exchange_budget_window_index_check",
      sql.raw("((window_index >= 0))"),
    ),
  ],
);

// The account SQL migration owns fixed-function ACLs and complete constraints.
export const operatorPasswordTokens = qf.table("operator_password_token", {
  id: uuid("id").primaryKey(),
  operatorId: uuid("operator_id")
    .notNull()
    .references(() => operators.id),
  purpose: text("purpose").notNull(),
  tokenDigest: char("token_digest", { length: 64 }).notNull().unique(),
  issuedBy: uuid("issued_by").references(() => operators.id),
  operationId: uuid("operation_id").notNull().unique(),
  issuedAt: time("issued_at").notNull(),
  expiresAt: time("expires_at").notNull(),
  consumedAt: time("consumed_at"),
  revokedAt: time("revoked_at"),
  attemptId: uuid("attempt_id"),
});
export const operatorAccountOperations = qf.table(
  "operator_account_operation",
  {
    operationId: uuid("operation_id").primaryKey(),
    actorId: uuid("actor_id").references(() => operators.id),
    targetId: uuid("target_id")
      .notNull()
      .references(() => operators.id),
    action: text("action").notNull(),
    binding: jsonb("binding").notNull(),
    status: text("status").notNull(),
    errorCode: varchar("error_code", { length: 64 }),
    tokenId: uuid("token_id").references(() => operatorPasswordTokens.id),
    createdAt: time("created_at")
      .notNull()
      .default(sql`clock_timestamp()`),
  },
);
export const operatorKdfAttempts = qf.table("operator_kdf_attempt", {
  id: uuid("id").primaryKey(),
  cost: integer("cost").notNull(),
  kind: text("kind").notNull(),
  operatorId: uuid("operator_id").references(() => operators.id),
  sessionId: uuid("session_id").references(() => operatorSessions.id),
  tokenId: uuid("token_id").references(() => operatorPasswordTokens.id),
  operationId: uuid("operation_id"),
  accountRevision: integer("account_revision"),
  createdAt: time("created_at").notNull(),
  expiresAt: time("expires_at").notNull(),
  finishedAt: time("finished_at"),
});
