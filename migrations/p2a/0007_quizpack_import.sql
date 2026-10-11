ALTER TABLE qf.audit_event DROP CONSTRAINT audit_target;
ALTER TABLE qf.audit_event ADD CONSTRAINT audit_target CHECK (
 (target_kind IS NULL AND target_id IS NULL AND target_revision IS NULL AND action IN ('bootstrap','operator_disabled','preauth_created','login_succeeded','login_failed','logout','session_revoked'))
 OR (target_kind IS NOT NULL AND target_id IS NOT NULL AND target_revision IS NOT NULL AND target_revision >= 1
 AND actor_id IS NOT NULL AND session_id IS NOT NULL AND outcome = 'success' AND reason_code IS NULL
 AND ((target_kind = 'product' AND target_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND action IN ('product_created','product_updated','product_archived','product_restored'))
 OR (target_kind = 'category' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('category_created','category_updated','category_archived','category_restored'))
 OR (target_kind = 'tag' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('tag_created','tag_updated','tag_archived','tag_restored'))
 OR (target_kind = 'import' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('import_intent_created','import_receive_started','import_receive_completed','import_receive_failed','import_receive_recovered'))))
);

CREATE FUNCTION qf.import_attempts_valid(a jsonb, f integer, current_id uuid, reserved bigint) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = pg_catalog AS $$
DECLARE item jsonb; total bigint := 0; ids text[] := '{}'; prior integer := 0;
BEGIN
 IF jsonb_typeof(a) <> 'array' OR jsonb_array_length(a) > 3 OR octet_length(a::text) > 8192 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(a) LOOP
  IF jsonb_typeof(item) <> 'object' OR (SELECT count(*) FROM jsonb_object_keys(item)) <> 6
    OR NOT (item ?& ARRAY['attemptId','fence','ownerPid','ownerNonce','reservationBytes','disposition'])
    OR jsonb_typeof(item->'attemptId') <> 'string' OR (item->>'attemptId') !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(item->'ownerNonce') <> 'string' OR (item->>'ownerNonce') !~ '^[A-Za-z0-9_-]{43}$'
    OR jsonb_typeof(item->'fence') <> 'number' OR (item->>'fence') !~ '^[1-9][0-9]*$'
    OR jsonb_typeof(item->'ownerPid') <> 'number' OR (item->>'ownerPid') !~ '^[1-9][0-9]*$'
    OR jsonb_typeof(item->'reservationBytes') <> 'number' OR (item->>'reservationBytes') !~ '^[1-9][0-9]*$'
    OR jsonb_typeof(item->'disposition') <> 'string' OR (item->>'disposition') NOT IN ('held','released') THEN RETURN false; END IF;
  IF (item->>'attemptId') = ANY(ids) OR (item->>'fence')::bigint <= prior OR (item->>'fence')::bigint > f
    OR (item->>'ownerPid')::bigint > 2147483647 OR (item->>'reservationBytes')::bigint > 67174400 THEN RETURN false; END IF;
  prior := (item->>'fence')::integer;
  ids := array_append(ids,item->>'attemptId');
  IF item->>'disposition' = 'held' THEN total := total + (item->>'reservationBytes')::bigint; END IF;
 END LOOP;
 RETURN total = reserved AND (current_id IS NULL OR current_id::text = ANY(ids));
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
REVOKE ALL ON FUNCTION qf.import_attempts_valid(jsonb,integer,uuid,bigint) FROM PUBLIC;

CREATE TABLE qf.quizpack_import (
 id uuid PRIMARY KEY, product_id varchar(80) NOT NULL REFERENCES qf.product(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 created_by uuid NOT NULL REFERENCES qf.operator(id) ON DELETE RESTRICT,
 idempotency_key uuid NOT NULL, request_fingerprint char(64) NOT NULL CHECK(request_fingerprint ~ '^[0-9a-f]{64}$'),
 expected_archive_sha256 char(64) NOT NULL CHECK(expected_archive_sha256 ~ '^[0-9a-f]{64}$'),
 expected_archive_bytes integer NOT NULL CHECK(expected_archive_bytes BETWEEN 1 AND 33554432),
 target_kind text NOT NULL CHECK(target_kind='new-draft'), created_at timestamptz NOT NULL,
 status text NOT NULL CHECK(status IN ('awaiting-upload','receiving','received','retryable-failed','rejected')),
 state_revision integer NOT NULL DEFAULT 1 CHECK(state_revision BETWEEN 1 AND 2147483647), updated_at timestamptz NOT NULL CHECK(updated_at >= created_at),
 storage_condition text NOT NULL DEFAULT 'clean' CHECK(storage_condition IN ('clean','cleanup-required','unknown')),
 last_error_code text CHECK(last_error_code IN ('RECEIVE_TIMEOUT','RECEIVE_LENGTH_MISMATCH','RECEIVE_HASH_MISMATCH','RECEIVE_LOCK_LOST','RECEIVE_RECOVERY_REQUIRED','RECEIVE_STORAGE_CONFLICT','RECEIVE_SCAN_LIMIT','WRITE_OUTCOME_UNKNOWN','STUDIO_UNAVAILABLE')),
 fence integer NOT NULL DEFAULT 0 CHECK(fence BETWEEN 0 AND 2147483647), lease_until timestamptz, current_attempt_id uuid,
 attempts jsonb NOT NULL DEFAULT '[]', actual_archive_sha256 char(64), actual_archive_bytes integer,
 archive_storage_key varchar(160), received_at timestamptz,
 reserved_bytes bigint NOT NULL DEFAULT 0 CHECK(reserved_bytes BETWEEN 0 AND 536870912), accounted_bytes bigint NOT NULL DEFAULT 0 CHECK(accounted_bytes BETWEEN 0 AND 536870912),
 UNIQUE(product_id,id), UNIQUE(product_id,idempotency_key),
 CHECK(qf.import_attempts_valid(attempts,fence,current_attempt_id,reserved_bytes)),
 CHECK((actual_archive_sha256 IS NULL AND actual_archive_bytes IS NULL AND archive_storage_key IS NULL AND received_at IS NULL AND status <> 'received')
 OR (actual_archive_sha256 IS NOT NULL AND actual_archive_bytes IS NOT NULL AND archive_storage_key IS NOT NULL AND received_at IS NOT NULL
 AND actual_archive_sha256=expected_archive_sha256 AND actual_archive_bytes=expected_archive_bytes
 AND archive_storage_key='imports/'||id::text||'/archive.quizpack' AND received_at >= created_at AND status='received')),
 CHECK(status <> 'receiving' OR (lease_until IS NOT NULL AND current_attempt_id IS NOT NULL))
);
CREATE INDEX import_product_created ON qf.quizpack_import(product_id,created_at DESC,id);
CREATE FUNCTION qf.protect_import_update() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE i integer; old_item jsonb; new_item jsonb;
BEGIN
 IF ROW(NEW.id,NEW.product_id,NEW.created_by,NEW.idempotency_key,NEW.request_fingerprint,NEW.expected_archive_sha256,NEW.expected_archive_bytes,NEW.target_kind,NEW.created_at)
 IS DISTINCT FROM ROW(OLD.id,OLD.product_id,OLD.created_by,OLD.idempotency_key,OLD.request_fingerprint,OLD.expected_archive_sha256,OLD.expected_archive_bytes,OLD.target_kind,OLD.created_at)
 OR NEW.fence < OLD.fence OR NEW.state_revision <> OLD.state_revision + 1 OR NEW.updated_at < OLD.updated_at
 OR jsonb_array_length(NEW.attempts) < jsonb_array_length(OLD.attempts) OR jsonb_array_length(NEW.attempts) > jsonb_array_length(OLD.attempts)+1 THEN RAISE EXCEPTION 'IMPORT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF OLD.status IN ('received','rejected') AND NEW.status <> OLD.status THEN RAISE EXCEPTION 'IMPORT_TERMINAL' USING ERRCODE='23514'; END IF;
 IF OLD.status='received' AND ROW(NEW.actual_archive_sha256,NEW.actual_archive_bytes,NEW.archive_storage_key,NEW.received_at) IS DISTINCT FROM ROW(OLD.actual_archive_sha256,OLD.actual_archive_bytes,OLD.archive_storage_key,OLD.received_at) THEN RAISE EXCEPTION 'IMPORT_FROZEN' USING ERRCODE='23514'; END IF;
 FOR i IN 0..jsonb_array_length(OLD.attempts)-1 LOOP
  old_item := OLD.attempts->i; new_item := NEW.attempts->i;
  IF (old_item-'disposition') IS DISTINCT FROM (new_item-'disposition') OR (old_item->>'disposition'='released' AND new_item->>'disposition'<>'released') THEN RAISE EXCEPTION 'IMPORT_ATTEMPT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF jsonb_array_length(NEW.attempts)>jsonb_array_length(OLD.attempts) THEN
  new_item := NEW.attempts->(jsonb_array_length(NEW.attempts)-1);
  IF (new_item->>'fence')::integer <> NEW.fence OR new_item->>'attemptId' <> NEW.current_attempt_id::text OR new_item->>'disposition'<>'held' OR NEW.fence <= OLD.fence
  OR (new_item->>'reservationBytes')::bigint <> 2*NEW.expected_archive_bytes::bigint+65536 THEN RAISE EXCEPTION 'IMPORT_ATTEMPT_INVALID' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION qf.protect_import_update() FROM PUBLIC;
CREATE TRIGGER protect_import_update BEFORE UPDATE ON qf.quizpack_import FOR EACH ROW EXECUTE FUNCTION qf.protect_import_update();
