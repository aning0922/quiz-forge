import "server-only";
/** Frozen PostgreSQL 18 draft definitions after 0017. Original source/closure facts are unchanged. */
export const draftSchemaFacts = {
  columns: [
    {
      table_name: "draft_application",
      column_name: "id",
      column_type: "uuid",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_application",
      column_name: "product_id",
      column_type: "character varying(80)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_application",
      column_name: "idempotency_key",
      column_type: "uuid",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_application",
      column_name: "fingerprint",
      column_type: "character(64)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_application",
      column_name: "source_import_id",
      column_type: "uuid",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_application",
      column_name: "source_validation_id",
      column_type: "uuid",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_application",
      column_name: "expected_validation_state_revision",
      column_type: "integer",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_application",
      column_name: "expected_candidate_sha256",
      column_type: "character(64)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_application",
      column_name: "target_kind",
      column_type: "text",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_application",
      column_name: "draft_id",
      column_type: "uuid",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_application",
      column_name: "revision",
      column_type: "integer",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_application",
      column_name: "created_by",
      column_type: "uuid",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_application",
      column_name: "created_at",
      column_type: "timestamp with time zone",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_application",
      column_name: "expected_draft_revision",
      column_type: "integer",
      required: false,
      default_expression: null,
    },
    {
      table_name: "draft_application",
      column_name: "expected_base_content_sha256",
      column_type: "character(64)",
      required: false,
      default_expression: null,
    },
    {
      table_name: "draft_application",
      column_name: "expected_base_asset_set_sha256",
      column_type: "character(64)",
      required: false,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "product_id",
      column_type: "character varying(80)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "draft_id",
      column_type: "uuid",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "revision",
      column_type: "integer",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "application_id",
      column_type: "uuid",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "source_import_id",
      column_type: "uuid",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "source_validation_id",
      column_type: "uuid",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "source_validation_state_revision",
      column_type: "integer",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "canonical_content_text",
      column_type: "text",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "canonical_content_sha256",
      column_type: "character(64)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "asset_set_text",
      column_type: "text",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "asset_set_sha256",
      column_type: "character(64)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "canonical_manifest_sha256",
      column_type: "character(64)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "candidate_sha256",
      column_type: "character(64)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "container_schema_version",
      column_type: "character varying(64)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "content_schema_version",
      column_type: "character varying(64)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "content_kind",
      column_type: "character varying(32)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "pack_id",
      column_type: "character varying(80)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "pack_version",
      column_type: "character varying(32)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "content_version",
      column_type: "character varying(32)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "visual_version",
      column_type: "character varying(32)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "report_version",
      column_type: "character varying(32)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "resource_version",
      column_type: "character varying(32)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "component_version",
      column_type: "character varying(32)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "engine_id",
      column_type: "character varying(32)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "engine_version",
      column_type: "character varying(32)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "resource_count",
      column_type: "smallint",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "created_by",
      column_type: "uuid",
      required: true,
      default_expression: null,
    },
    {
      table_name: "draft_revision",
      column_name: "created_at",
      column_type: "timestamp with time zone",
      required: true,
      default_expression: null,
    },
    {
      table_name: "product_draft",
      column_name: "id",
      column_type: "uuid",
      required: true,
      default_expression: null,
    },
    {
      table_name: "product_draft",
      column_name: "product_id",
      column_type: "character varying(80)",
      required: true,
      default_expression: null,
    },
    {
      table_name: "product_draft",
      column_name: "current_revision",
      column_type: "integer",
      required: true,
      default_expression: null,
    },
    {
      table_name: "product_draft",
      column_name: "initial_application_id",
      column_type: "uuid",
      required: true,
      default_expression: null,
    },
    {
      table_name: "product_draft",
      column_name: "created_by",
      column_type: "uuid",
      required: true,
      default_expression: null,
    },
    {
      table_name: "product_draft",
      column_name: "created_at",
      column_type: "timestamp with time zone",
      required: true,
      default_expression: null,
    },
    {
      table_name: "product_draft",
      column_name: "initial_revision",
      column_type: "integer",
      required: true,
      default_expression: "1",
    },
  ],
  constraints: [
    {
      table_name: "audit_event",
      name: "audit_target",
      definition:
        "CHECK (((((target_kind IS NULL) AND (target_id IS NULL) AND (target_revision IS NULL) AND (action = ANY (ARRAY['bootstrap'::qf.audit_action, 'operator_disabled'::qf.audit_action, 'preauth_created'::qf.audit_action, 'login_succeeded'::qf.audit_action, 'login_failed'::qf.audit_action, 'logout'::qf.audit_action, 'session_revoked'::qf.audit_action]))) OR ((target_kind IS NOT NULL) AND (target_id IS NOT NULL) AND (target_revision IS NOT NULL) AND (target_revision >= 1) AND (actor_id IS NOT NULL) AND (session_id IS NOT NULL) AND (outcome = 'success'::qf.audit_outcome) AND (reason_code IS NULL) AND ((((target_kind)::text = 'product'::text) AND ((target_id)::text ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'::text) AND (action = ANY (ARRAY['product_created'::qf.audit_action, 'product_updated'::qf.audit_action, 'product_archived'::qf.audit_action, 'product_restored'::qf.audit_action]))) OR (((target_kind)::text = 'category'::text) AND ((target_id)::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) AND (action = ANY (ARRAY['category_created'::qf.audit_action, 'category_updated'::qf.audit_action, 'category_archived'::qf.audit_action, 'category_restored'::qf.audit_action]))) OR (((target_kind)::text = 'tag'::text) AND ((target_id)::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) AND (action = ANY (ARRAY['tag_created'::qf.audit_action, 'tag_updated'::qf.audit_action, 'tag_archived'::qf.audit_action, 'tag_restored'::qf.audit_action]))) OR (((target_kind)::text = 'validation'::text) AND ((target_id)::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) AND (action = ANY (ARRAY['validation_started'::qf.audit_action, 'validation_evidenced'::qf.audit_action, 'validation_rejected'::qf.audit_action, 'validation_interrupted'::qf.audit_action, 'validation_completed'::qf.audit_action, 'validation_recovered'::qf.audit_action, 'validation_retried'::qf.audit_action, 'validation_file_stop_acknowledged'::qf.audit_action]))) OR (((target_kind)::text = 'draft'::text) AND ((target_id)::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) AND ((target_revision >= 1) AND (target_revision <= 100)) AND (action = 'draft_applied'::qf.audit_action)) OR (((target_kind)::text = 'import'::text) AND ((target_id)::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) AND (action = ANY (ARRAY['import_intent_created'::qf.audit_action, 'import_receive_started'::qf.audit_action, 'import_receive_completed'::qf.audit_action, 'import_receive_failed'::qf.audit_action, 'import_receive_recovered'::qf.audit_action]))))) OR ((actor_id IS NOT NULL) AND (session_id IS NOT NULL) AND (target_kind IS NOT NULL) AND (target_revision IS NOT NULL) AND (outcome = 'success'::qf.audit_outcome) AND (reason_code IS NULL) AND (target_id IS NOT NULL) AND ((target_id)::text ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'::text) AND ((target_revision >= 1) AND (target_revision <= 100)) AND ((((target_kind)::text = 'review'::text) AND ((action)::text = 'draft_baseline_recorded'::text)) OR (((target_kind)::text = 'version'::text) AND ((action)::text = 'internal_version_sealed'::text))))) IS TRUE))",
      kind: "c",
    },
    {
      table_name: "draft_application",
      name: "draft_application_closure",
      definition: "TRIGGER DEFERRABLE INITIALLY DEFERRED",
      kind: "t",
    },
    {
      table_name: "draft_application",
      name: "draft_application_created_at_not_null",
      definition: "NOT NULL created_at",
      kind: "n",
    },
    {
      table_name: "draft_application",
      name: "draft_application_created_by_fkey",
      definition:
        "FOREIGN KEY (created_by) REFERENCES qf.operator(id) ON DELETE RESTRICT",
      kind: "f",
    },
    {
      table_name: "draft_application",
      name: "draft_application_created_by_not_null",
      definition: "NOT NULL created_by",
      kind: "n",
    },
    {
      table_name: "draft_application",
      name: "draft_application_draft_id_not_null",
      definition: "NOT NULL draft_id",
      kind: "n",
    },
    {
      table_name: "draft_application",
      name: "draft_application_expected_candidate_sha256_check",
      definition:
        "CHECK ((expected_candidate_sha256 ~ '^[a-f0-9]{64}$'::text))",
      kind: "c",
    },
    {
      table_name: "draft_application",
      name: "draft_application_expected_candidate_sha256_not_null",
      definition: "NOT NULL expected_candidate_sha256",
      kind: "n",
    },
    {
      table_name: "draft_application",
      name: "draft_application_expected_validation_state_revision_check",
      definition:
        "CHECK (((expected_validation_state_revision >= 1) AND (expected_validation_state_revision <= 2147483647)))",
      kind: "c",
    },
    {
      table_name: "draft_application",
      name: "draft_application_expected_validation_state_revision_not_null",
      definition: "NOT NULL expected_validation_state_revision",
      kind: "n",
    },
    {
      table_name: "draft_application",
      name: "draft_application_fingerprint_check",
      definition: "CHECK ((fingerprint ~ '^[a-f0-9]{64}$'::text))",
      kind: "c",
    },
    {
      table_name: "draft_application",
      name: "draft_application_fingerprint_exact",
      definition:
        "CHECK ((\nCASE\n    WHEN (target_kind = 'new-draft'::text) THEN ((fingerprint)::text = qf.draft_application_fingerprint((product_id)::text, source_import_id, source_validation_id, expected_validation_state_revision, (expected_candidate_sha256)::text))\n    WHEN (target_kind = 'append-revision'::text) THEN ((fingerprint)::text = qf.draft_revision_application_fingerprint((product_id)::text, source_import_id, source_validation_id, expected_validation_state_revision, (expected_candidate_sha256)::text, draft_id, expected_draft_revision, (expected_base_content_sha256)::text, (expected_base_asset_set_sha256)::text))\n    ELSE false\nEND IS TRUE))",
      kind: "c",
    },
    {
      table_name: "draft_application",
      name: "draft_application_fingerprint_not_null",
      definition: "NOT NULL fingerprint",
      kind: "n",
    },
    {
      table_name: "draft_application",
      name: "draft_application_id_not_null",
      definition: "NOT NULL id",
      kind: "n",
    },
    {
      table_name: "draft_application",
      name: "draft_application_idempotency_key_not_null",
      definition: "NOT NULL idempotency_key",
      kind: "n",
    },
    {
      table_name: "draft_application",
      name: "draft_application_operation",
      definition:
        "CHECK (((((target_kind = 'new-draft'::text) AND (revision = 1) AND (expected_draft_revision IS NULL) AND (expected_base_content_sha256 IS NULL) AND (expected_base_asset_set_sha256 IS NULL)) OR ((target_kind = 'append-revision'::text) AND (expected_draft_revision IS NOT NULL) AND (expected_base_content_sha256 IS NOT NULL) AND (expected_base_asset_set_sha256 IS NOT NULL) AND ((expected_draft_revision >= 1) AND (expected_draft_revision <= 99)) AND (revision = (expected_draft_revision + 1)) AND (expected_base_content_sha256 ~ '^[a-f0-9]{64}$'::text) AND (expected_base_asset_set_sha256 ~ '^[a-f0-9]{64}$'::text))) IS TRUE))",
      kind: "c",
    },
    {
      table_name: "draft_application",
      name: "draft_application_parent_fk",
      definition:
        "FOREIGN KEY (product_id, draft_id, expected_draft_revision, expected_base_content_sha256, expected_base_asset_set_sha256) REFERENCES qf.draft_revision(product_id, draft_id, revision, canonical_content_sha256, asset_set_sha256) ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED",
      kind: "f",
    },
    {
      table_name: "draft_application",
      name: "draft_application_pkey",
      definition: "PRIMARY KEY (id)",
      kind: "p",
    },
    {
      table_name: "draft_application",
      name: "draft_application_product_id_draft_id_fkey",
      definition:
        "FOREIGN KEY (product_id, draft_id) REFERENCES qf.product_draft(product_id, id) ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED",
      kind: "f",
    },
    {
      table_name: "draft_application",
      name: "draft_application_product_id_draft_id_revision_id_key",
      definition: "UNIQUE (product_id, draft_id, revision, id)",
      kind: "u",
    },
    {
      table_name: "draft_application",
      name: "draft_application_product_id_draft_id_revision_id_source_im_key",
      definition:
        "UNIQUE (product_id, draft_id, revision, id, source_import_id, source_validation_id, expected_validation_state_revision, expected_candidate_sha256)",
      kind: "u",
    },
    {
      table_name: "draft_application",
      name: "draft_application_product_id_draft_id_revision_key",
      definition: "UNIQUE (product_id, draft_id, revision)",
      kind: "u",
    },
    {
      table_name: "draft_application",
      name: "draft_application_product_id_idempotency_key_key",
      definition: "UNIQUE (product_id, idempotency_key)",
      kind: "u",
    },
    {
      table_name: "draft_application",
      name: "draft_application_product_id_not_null",
      definition: "NOT NULL product_id",
      kind: "n",
    },
    {
      table_name: "draft_application",
      name: "draft_application_product_id_source_import_id_key",
      definition: "UNIQUE (product_id, source_import_id)",
      kind: "u",
    },
    {
      table_name: "draft_application",
      name: "draft_application_product_id_source_import_id_source_valid_fkey",
      definition:
        "FOREIGN KEY (product_id, source_import_id, source_validation_id) REFERENCES qf.quizpack_validation(product_id, import_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT",
      kind: "f",
    },
    {
      table_name: "draft_application",
      name: "draft_application_revision_check",
      definition: "CHECK (((revision >= 1) AND (revision <= 100)))",
      kind: "c",
    },
    {
      table_name: "draft_application",
      name: "draft_application_revision_fk",
      definition:
        "FOREIGN KEY (product_id, draft_id, revision, id) REFERENCES qf.draft_revision(product_id, draft_id, revision, application_id) ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED",
      kind: "f",
    },
    {
      table_name: "draft_application",
      name: "draft_application_revision_not_null",
      definition: "NOT NULL revision",
      kind: "n",
    },
    {
      table_name: "draft_application",
      name: "draft_application_source_import_id_not_null",
      definition: "NOT NULL source_import_id",
      kind: "n",
    },
    {
      table_name: "draft_application",
      name: "draft_application_source_validation_id_not_null",
      definition: "NOT NULL source_validation_id",
      kind: "n",
    },
    {
      table_name: "draft_application",
      name: "draft_application_target_kind_not_null",
      definition: "NOT NULL target_kind",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_application_fk",
      definition:
        "FOREIGN KEY (product_id, draft_id, revision, application_id, source_import_id, source_validation_id, source_validation_state_revision, candidate_sha256) REFERENCES qf.draft_application(product_id, draft_id, revision, id, source_import_id, source_validation_id, expected_validation_state_revision, expected_candidate_sha256) ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED",
      kind: "f",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_application_id_not_null",
      definition: "NOT NULL application_id",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_asset_set_sha256_not_null",
      definition: "NOT NULL asset_set_sha256",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_asset_set_text_check",
      definition:
        "CHECK (((octet_length(asset_set_text) >= 2) AND (octet_length(asset_set_text) <= 65536)))",
      kind: "c",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_asset_set_text_not_null",
      definition: "NOT NULL asset_set_text",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_candidate_sha256_check",
      definition: "CHECK ((candidate_sha256 ~ '^[a-f0-9]{64}$'::text))",
      kind: "c",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_candidate_sha256_not_null",
      definition: "NOT NULL candidate_sha256",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_canonical_content_sha256_not_null",
      definition: "NOT NULL canonical_content_sha256",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_canonical_content_text_check",
      definition:
        "CHECK (((octet_length(canonical_content_text) >= 2) AND (octet_length(canonical_content_text) <= 2097152)))",
      kind: "c",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_canonical_content_text_not_null",
      definition: "NOT NULL canonical_content_text",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_canonical_manifest_sha256_check",
      definition:
        "CHECK ((canonical_manifest_sha256 ~ '^[a-f0-9]{64}$'::text))",
      kind: "c",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_canonical_manifest_sha256_not_null",
      definition: "NOT NULL canonical_manifest_sha256",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_check",
      definition:
        "CHECK (((canonical_content_sha256 ~ '^[a-f0-9]{64}$'::text) AND ((canonical_content_sha256)::text = qf.sha256_utf8(canonical_content_text))))",
      kind: "c",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_check1",
      definition:
        "CHECK (((asset_set_sha256 ~ '^[a-f0-9]{64}$'::text) AND ((asset_set_sha256)::text = qf.sha256_utf8(asset_set_text))))",
      kind: "c",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_check2",
      definition:
        "CHECK ((((pack_version)::text ~ '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'::text) AND ((content_version)::text ~ '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'::text) AND ((visual_version)::text ~ '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'::text) AND ((report_version)::text ~ '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'::text) AND ((resource_version)::text ~ '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'::text) AND ((component_version)::text ~ '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$'::text)))",
      kind: "c",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_closure",
      definition: "TRIGGER DEFERRABLE INITIALLY DEFERRED",
      kind: "t",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_component_version_not_null",
      definition: "NOT NULL component_version",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_container_schema_version_check",
      definition:
        "CHECK (((container_schema_version)::text = 'quizpack.v1'::text))",
      kind: "c",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_container_schema_version_not_null",
      definition: "NOT NULL container_schema_version",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_content_kind_check",
      definition:
        "CHECK (((content_kind)::text = ANY ((ARRAY['synthetic'::character varying, 'authored'::character varying])::text[])))",
      kind: "c",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_content_kind_not_null",
      definition: "NOT NULL content_kind",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_content_schema_version_check",
      definition:
        "CHECK (((content_schema_version)::text = ANY ((ARRAY['quizpack-content.v1'::character varying, 'quizpack-content.v2'::character varying])::text[])))",
      kind: "c",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_content_schema_version_not_null",
      definition: "NOT NULL content_schema_version",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_content_version_not_null",
      definition: "NOT NULL content_version",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_created_at_not_null",
      definition: "NOT NULL created_at",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_created_by_fkey",
      definition:
        "FOREIGN KEY (created_by) REFERENCES qf.operator(id) ON DELETE RESTRICT",
      kind: "f",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_created_by_not_null",
      definition: "NOT NULL created_by",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_draft_id_not_null",
      definition: "NOT NULL draft_id",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_engine_id_check",
      definition:
        "CHECK (((engine_id)::text = ANY ((ARRAY['dimensions'::character varying, 'archetype'::character varying])::text[])))",
      kind: "c",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_engine_id_not_null",
      definition: "NOT NULL engine_id",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_engine_version_check",
      definition: "CHECK (((engine_version)::text = '1.0.0'::text))",
      kind: "c",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_engine_version_not_null",
      definition: "NOT NULL engine_version",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_exact_base",
      definition:
        "UNIQUE (product_id, draft_id, revision, canonical_content_sha256, asset_set_sha256)",
      kind: "u",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_exact_target",
      definition:
        "UNIQUE (product_id, draft_id, revision, canonical_content_sha256, asset_set_sha256, canonical_manifest_sha256)",
      kind: "u",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_manifest_once",
      definition: "UNIQUE (product_id, canonical_manifest_sha256)",
      kind: "u",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_pack_id_check",
      definition:
        "CHECK (((pack_id)::text ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'::text))",
      kind: "c",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_pack_id_not_null",
      definition: "NOT NULL pack_id",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_pack_version_not_null",
      definition: "NOT NULL pack_version",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_pkey",
      definition: "PRIMARY KEY (product_id, draft_id, revision)",
      kind: "p",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_product_id_draft_id_revision_application_id_key",
      definition: "UNIQUE (product_id, draft_id, revision, application_id)",
      kind: "u",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_product_id_not_null",
      definition: "NOT NULL product_id",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_product_id_source_import_id_source_validati_fkey",
      definition:
        "FOREIGN KEY (product_id, source_import_id, source_validation_id) REFERENCES qf.quizpack_validation(product_id, import_id, id) ON UPDATE RESTRICT ON DELETE RESTRICT",
      kind: "f",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_report_version_not_null",
      definition: "NOT NULL report_version",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_resource_count_check",
      definition: "CHECK (((resource_count >= 1) AND (resource_count <= 64)))",
      kind: "c",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_resource_count_not_null",
      definition: "NOT NULL resource_count",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_resource_version_not_null",
      definition: "NOT NULL resource_version",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_revision_check",
      definition: "CHECK (((revision >= 1) AND (revision <= 100)))",
      kind: "c",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_revision_not_null",
      definition: "NOT NULL revision",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_source_import_id_not_null",
      definition: "NOT NULL source_import_id",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_source_validation_id_not_null",
      definition: "NOT NULL source_validation_id",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_source_validation_state_revision_check",
      definition:
        "CHECK (((source_validation_state_revision >= 1) AND (source_validation_state_revision <= 2147483647)))",
      kind: "c",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_source_validation_state_revision_not_null",
      definition: "NOT NULL source_validation_state_revision",
      kind: "n",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_visual_version_not_null",
      definition: "NOT NULL visual_version",
      kind: "n",
    },
    {
      table_name: "product_draft",
      name: "draft_root_closure",
      definition: "TRIGGER DEFERRABLE INITIALLY DEFERRED",
      kind: "t",
    },
    {
      table_name: "product_draft",
      name: "product_draft_created_at_not_null",
      definition: "NOT NULL created_at",
      kind: "n",
    },
    {
      table_name: "product_draft",
      name: "product_draft_created_by_fkey",
      definition:
        "FOREIGN KEY (created_by) REFERENCES qf.operator(id) ON DELETE RESTRICT",
      kind: "f",
    },
    {
      table_name: "product_draft",
      name: "product_draft_created_by_not_null",
      definition: "NOT NULL created_by",
      kind: "n",
    },
    {
      table_name: "product_draft",
      name: "product_draft_current_revision_check",
      definition:
        "CHECK (((current_revision >= 1) AND (current_revision <= 100)))",
      kind: "c",
    },
    {
      table_name: "product_draft",
      name: "product_draft_current_revision_fk",
      definition:
        "FOREIGN KEY (product_id, id, current_revision) REFERENCES qf.draft_revision(product_id, draft_id, revision) ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED",
      kind: "f",
    },
    {
      table_name: "product_draft",
      name: "product_draft_current_revision_not_null",
      definition: "NOT NULL current_revision",
      kind: "n",
    },
    {
      table_name: "product_draft",
      name: "product_draft_id_not_null",
      definition: "NOT NULL id",
      kind: "n",
    },
    {
      table_name: "product_draft",
      name: "product_draft_initial_application_fk",
      definition:
        "FOREIGN KEY (product_id, id, initial_revision, initial_application_id) REFERENCES qf.draft_application(product_id, draft_id, revision, id) ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED",
      kind: "f",
    },
    {
      table_name: "product_draft",
      name: "product_draft_initial_application_id_not_null",
      definition: "NOT NULL initial_application_id",
      kind: "n",
    },
    {
      table_name: "product_draft",
      name: "product_draft_initial_revision_check",
      definition: "CHECK ((initial_revision = 1))",
      kind: "c",
    },
    {
      table_name: "product_draft",
      name: "product_draft_initial_revision_not_null",
      definition: "NOT NULL initial_revision",
      kind: "n",
    },
    {
      table_name: "product_draft",
      name: "product_draft_pkey",
      definition: "PRIMARY KEY (id)",
      kind: "p",
    },
    {
      table_name: "product_draft",
      name: "product_draft_product_id_fkey",
      definition:
        "FOREIGN KEY (product_id) REFERENCES qf.product(id) ON UPDATE RESTRICT ON DELETE RESTRICT",
      kind: "f",
    },
    {
      table_name: "product_draft",
      name: "product_draft_product_id_id_key",
      definition: "UNIQUE (product_id, id)",
      kind: "u",
    },
    {
      table_name: "product_draft",
      name: "product_draft_product_id_key",
      definition: "UNIQUE (product_id)",
      kind: "u",
    },
    {
      table_name: "product_draft",
      name: "product_draft_product_id_not_null",
      definition: "NOT NULL product_id",
      kind: "n",
    },
    {
      table_name: "quizpack_validation",
      name: "validation_product_import_id",
      definition: "UNIQUE (product_id, import_id, id)",
      kind: "u",
    },
  ],
  helpers: [
    {
      signature: "qf.check_draft_closure()",
      body_sha256:
        "8d45e29c838713b1685f498898cddbb3637bac47efb2e094f15f8e8bcecf1eda",
      volatility: "v",
    },
    {
      signature:
        "qf.draft_application_fingerprint(text,uuid,uuid,integer,text)",
      body_sha256:
        "b54c14cfbea181c938ca3f72197f15faa3a01eb8e98f7696f00987af5dbff664",
      volatility: "i",
    },
    {
      signature:
        "qf.draft_revision_application_fingerprint(text,uuid,uuid,integer,text,uuid,integer,text,text)",
      body_sha256:
        "50738d02f1a088d67a983b3661f463e68ed35fbca4818f00459e668e9c0d9fd8",
      volatility: "i",
    },
    {
      signature: "qf.protect_draft_progress()",
      body_sha256:
        "a1ca14ddf466d5dcb8d96758147976fd8da3ed8a73c4c6e5c881a172cdb7b921",
      volatility: "v",
    },
    {
      signature: "qf.protect_draft_revision_source()",
      body_sha256:
        "207aed795f0613302038cd81ac000add3345fff4b7fe912e76f84e389b17f3da",
      volatility: "v",
    },
  ],
  triggers: [
    {
      table_name: "draft_application",
      name: "draft_application_closure",
      definition:
        "CREATE CONSTRAINT TRIGGER draft_application_closure AFTER INSERT OR DELETE ON qf.draft_application DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qf.check_draft_closure()",
    },
    {
      table_name: "draft_application",
      name: "draft_application_progress",
      definition:
        "CREATE TRIGGER draft_application_progress BEFORE INSERT ON qf.draft_application FOR EACH ROW EXECUTE FUNCTION qf.protect_draft_progress()",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_closure",
      definition:
        "CREATE CONSTRAINT TRIGGER draft_revision_closure AFTER INSERT OR DELETE ON qf.draft_revision DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qf.check_draft_closure()",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_progress",
      definition:
        "CREATE TRIGGER draft_revision_progress BEFORE INSERT ON qf.draft_revision FOR EACH ROW EXECUTE FUNCTION qf.protect_draft_progress()",
    },
    {
      table_name: "draft_revision",
      name: "draft_revision_source",
      definition:
        "CREATE TRIGGER draft_revision_source BEFORE INSERT ON qf.draft_revision FOR EACH ROW EXECUTE FUNCTION qf.protect_draft_revision_source()",
    },
    {
      table_name: "product_draft",
      name: "draft_root_closure",
      definition:
        "CREATE CONSTRAINT TRIGGER draft_root_closure AFTER INSERT OR DELETE OR UPDATE ON qf.product_draft DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qf.check_draft_closure()",
    },
    {
      table_name: "product_draft",
      name: "draft_root_progress",
      definition:
        "CREATE TRIGGER draft_root_progress BEFORE INSERT OR UPDATE ON qf.product_draft FOR EACH ROW EXECUTE FUNCTION qf.protect_draft_progress()",
    },
  ],
} as const;
