-- Receiving and recovery each get one bounded lease; same fence cannot renew it.
CREATE OR REPLACE FUNCTION qf.protect_import_update() RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog AS $$
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
 IF NEW.lease_until IS NOT NULL AND (
   NEW.lease_until > clock_timestamp()+interval '120 seconds'
   OR (NEW.fence=OLD.fence AND NEW.lease_until IS DISTINCT FROM OLD.lease_until)
 ) THEN RAISE EXCEPTION 'IMPORT_LEASE_INVALID' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
