-- First immutable draft: database-only application of an existing ready source.
ALTER TABLE qf.quizpack_validation ADD CONSTRAINT validation_product_import_id UNIQUE(product_id,import_id,id);
CREATE TABLE qf.product_draft (
 id uuid PRIMARY KEY,
 product_id varchar(80) NOT NULL UNIQUE REFERENCES qf.product(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 current_revision integer NOT NULL CHECK(current_revision=1),
 initial_application_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES qf.operator(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL,
 UNIQUE(product_id,id)
);
CREATE TABLE qf.draft_revision (
 product_id varchar(80) NOT NULL,
 draft_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision=1),
 application_id uuid NOT NULL,
 source_import_id uuid NOT NULL,
 source_validation_id uuid NOT NULL,
 source_validation_state_revision integer NOT NULL CHECK(source_validation_state_revision BETWEEN 1 AND 2147483647),
 canonical_content_text text NOT NULL CHECK(octet_length(canonical_content_text) BETWEEN 2 AND 2097152),
 canonical_content_sha256 char(64) NOT NULL CHECK(canonical_content_sha256 ~ '^[a-f0-9]{64}$' AND canonical_content_sha256=qf.sha256_utf8(canonical_content_text)),
 asset_set_text text NOT NULL CHECK(octet_length(asset_set_text) BETWEEN 2 AND 65536),
 asset_set_sha256 char(64) NOT NULL CHECK(asset_set_sha256 ~ '^[a-f0-9]{64}$' AND asset_set_sha256=qf.sha256_utf8(asset_set_text)),
 canonical_manifest_sha256 char(64) NOT NULL CHECK(canonical_manifest_sha256 ~ '^[a-f0-9]{64}$'),
 candidate_sha256 char(64) NOT NULL CHECK(candidate_sha256 ~ '^[a-f0-9]{64}$'),
 container_schema_version varchar(64) NOT NULL CHECK(container_schema_version='quizpack.v1'),
 content_schema_version varchar(64) NOT NULL CHECK(content_schema_version='quizpack-content.v1'),
 content_kind varchar(32) NOT NULL CHECK(content_kind='synthetic'),
 pack_id varchar(80) NOT NULL CHECK(pack_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
 pack_version varchar(32) NOT NULL,
 content_version varchar(32) NOT NULL,
 visual_version varchar(32) NOT NULL,
 report_version varchar(32) NOT NULL,
 resource_version varchar(32) NOT NULL,
 component_version varchar(32) NOT NULL,
 engine_id varchar(32) NOT NULL CHECK(engine_id IN ('dimensions','archetype')),
 engine_version varchar(32) NOT NULL CHECK(engine_version='1.0.0'),
 resource_count smallint NOT NULL CHECK(resource_count BETWEEN 1 AND 64),
 created_by uuid NOT NULL REFERENCES qf.operator(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL,
 PRIMARY KEY(product_id,draft_id,revision),
 UNIQUE(product_id,draft_id,revision,application_id),
 FOREIGN KEY(product_id,source_import_id,source_validation_id) REFERENCES qf.quizpack_validation(product_id,import_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK(pack_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' AND content_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' AND visual_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' AND report_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' AND resource_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' AND component_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')
);
CREATE TABLE qf.draft_application (
 id uuid PRIMARY KEY,
 product_id varchar(80) NOT NULL,
 idempotency_key uuid NOT NULL,
 fingerprint char(64) NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 source_import_id uuid NOT NULL,
 source_validation_id uuid NOT NULL,
 expected_validation_state_revision integer NOT NULL CHECK(expected_validation_state_revision BETWEEN 1 AND 2147483647),
 expected_candidate_sha256 char(64) NOT NULL CHECK(expected_candidate_sha256 ~ '^[a-f0-9]{64}$'),
 target_kind text NOT NULL CHECK(target_kind='new-draft'),
 draft_id uuid NOT NULL,
 revision integer NOT NULL CHECK(revision=1),
 created_by uuid NOT NULL REFERENCES qf.operator(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL,
 UNIQUE(product_id,idempotency_key),
 UNIQUE(product_id,source_import_id),
 UNIQUE(product_id,draft_id,revision),
 UNIQUE(product_id,draft_id,revision,id),
 -- Extra exact request/source binding prevents an application describing a different source than its revision.
 UNIQUE(product_id,draft_id,revision,id,source_import_id,source_validation_id,expected_validation_state_revision,expected_candidate_sha256),
 FOREIGN KEY(product_id,source_import_id,source_validation_id) REFERENCES qf.quizpack_validation(product_id,import_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(product_id,draft_id) REFERENCES qf.product_draft(product_id,id) ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED
);
ALTER TABLE qf.product_draft ADD CONSTRAINT product_draft_current_revision_fk FOREIGN KEY(product_id,id,current_revision) REFERENCES qf.draft_revision(product_id,draft_id,revision) ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE qf.product_draft ADD CONSTRAINT product_draft_initial_application_fk FOREIGN KEY(product_id,id,current_revision,initial_application_id) REFERENCES qf.draft_application(product_id,draft_id,revision,id) ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE qf.draft_revision ADD CONSTRAINT draft_revision_application_fk FOREIGN KEY(product_id,draft_id,revision,application_id,source_import_id,source_validation_id,source_validation_state_revision,candidate_sha256) REFERENCES qf.draft_application(product_id,draft_id,revision,id,source_import_id,source_validation_id,expected_validation_state_revision,expected_candidate_sha256) ON DELETE NO ACTION ON UPDATE RESTRICT DEFERRABLE INITIALLY DEFERRED;

-- Explicit scalar canonical order, identical to the shared application payload.
-- No jsonb::text reconstruction of authoritative content or fingerprint input.
CREATE FUNCTION qf.draft_application_fingerprint(pid text, iid uuid, vid uuid, rev integer, sha text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$
 SELECT qf.sha256_utf8('{"expectedCandidateSha256":'||to_json(sha)::text||',"expectedValidationStateRevision":'||rev::text||',"productId":'||to_json(pid)::text||',"schemaVersion":"quizpack-draft-application.v1","sourceImportId":'||to_json(iid::text)::text||',"sourceValidationId":'||to_json(vid::text)::text||',"target":{"kind":"new-draft"}}')
$$;
ALTER TABLE qf.draft_application ADD CONSTRAINT draft_application_fingerprint_exact CHECK(
 (fingerprint=qf.draft_application_fingerprint(product_id,source_import_id,source_validation_id,expected_validation_state_revision,expected_candidate_sha256)) IS TRUE
);

-- Relationship closure is handled by deferred FKs. This narrow INSERT guard
-- prevents a valid source identity being paired with different copied bytes.
CREATE FUNCTION qf.protect_draft_revision_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE source qf.quizpack_validation; imp qf.quizpack_import; c jsonb; active boolean;
BEGIN
 SELECT archived_at IS NULL INTO active FROM qf.product WHERE id=NEW.product_id FOR UPDATE;
 SELECT * INTO imp FROM qf.quizpack_import WHERE product_id=NEW.product_id AND id=NEW.source_import_id;
 SELECT * INTO source FROM qf.quizpack_validation WHERE product_id=NEW.product_id AND import_id=NEW.source_import_id AND id=NEW.source_validation_id;
 IF (active AND imp.status='received' AND imp.target_kind='new-draft'
   AND source.status='ready' AND source.storage_condition='clean' AND source.reserved_bytes=0
   AND source.identity_kind IN ('canonical','alias')
   AND source.archive_policy_version='quizpack-private-archive.v2'
   AND source.archive_policy_sha256='f6a2d1ee2e130219fb0a59e9a8ec54a799dd99cb5dab0e993a763c58e3f75bee'
   AND qf.validation_file_stop_protocol()='candidate-receipt-db-ack.v1'
   AND qf.validation_file_stop_controls_valid(source.archive_policy_version,source.id,source.attempts_text,source.evidence_metadata_text)
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source.attempts_text::jsonb) a WHERE (a->>'disposition'='released' AND a->>'mediaStop' IN ('confirmed','not-started') AND a->'fileStopProof'<>'null'::jsonb) IS NOT TRUE)
   AND NEW.source_validation_state_revision=source.state_revision
   AND NEW.canonical_content_text=source.canonical_content_text
   AND NEW.canonical_content_sha256=source.canonical_content_sha256
   AND NEW.asset_set_text=source.asset_set_text AND NEW.asset_set_sha256=source.asset_set_sha256
   AND NEW.canonical_manifest_sha256=source.canonical_manifest_sha256
   AND NEW.candidate_sha256=source.candidate_sha256
   AND NEW.container_schema_version=source.container_schema_version
   AND NEW.content_schema_version=source.content_schema_version AND NEW.content_kind=source.content_kind
   AND NEW.pack_id=source.pack_id AND NEW.pack_version=source.pack_version
   AND NEW.resource_count=source.resource_count) IS NOT TRUE THEN
  RAISE EXCEPTION 'DRAFT_SOURCE_INVALID' USING ERRCODE='23514';
 END IF;
 c:=source.canonical_content_text::jsonb;
 IF (c#>>'{product,productId}'=NEW.product_id
   AND NEW.content_version=c->>'contentVersion' AND NEW.visual_version=c->>'visualVersion'
   AND NEW.report_version=c->>'reportVersion' AND NEW.resource_version=c->>'resourceVersion'
   AND NEW.component_version=c->>'componentVersion'
   AND NEW.engine_id=c#>>'{engine,id}' AND NEW.engine_version=c#>>'{engine,version}') IS NOT TRUE THEN
  RAISE EXCEPTION 'DRAFT_SOURCE_INVALID' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER draft_revision_source BEFORE INSERT ON qf.draft_revision FOR EACH ROW EXECUTE FUNCTION qf.protect_draft_revision_source();
REVOKE ALL ON qf.product_draft,qf.draft_revision,qf.draft_application FROM PUBLIC;
REVOKE ALL ON FUNCTION qf.draft_application_fingerprint(text,uuid,uuid,integer,text),qf.protect_draft_revision_source() FROM PUBLIC;

ALTER TABLE qf.audit_event DROP CONSTRAINT audit_target;
ALTER TABLE qf.audit_event ADD CONSTRAINT audit_target CHECK (
 (target_kind IS NULL AND target_id IS NULL AND target_revision IS NULL AND action IN ('bootstrap','operator_disabled','preauth_created','login_succeeded','login_failed','logout','session_revoked'))
 OR (target_kind IS NOT NULL AND target_id IS NOT NULL AND target_revision IS NOT NULL AND target_revision >= 1
 AND actor_id IS NOT NULL AND session_id IS NOT NULL AND outcome = 'success' AND reason_code IS NULL
 AND ((target_kind = 'product' AND target_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND action IN ('product_created','product_updated','product_archived','product_restored'))
 OR (target_kind = 'category' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('category_created','category_updated','category_archived','category_restored'))
 OR (target_kind = 'tag' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('tag_created','tag_updated','tag_archived','tag_restored'))
 OR (target_kind = 'validation' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('validation_started','validation_evidenced','validation_rejected','validation_interrupted','validation_completed','validation_recovered','validation_retried','validation_file_stop_acknowledged'))
 OR (target_kind = 'draft' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND target_revision=1 AND action='draft_applied')
 OR (target_kind = 'import' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('import_intent_created','import_receive_started','import_receive_completed','import_receive_failed','import_receive_recovered'))))
);
