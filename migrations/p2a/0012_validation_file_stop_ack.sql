-- B2-2B durable files-and-media ACK. Stop old writers before applying.
-- Historical v1 remains byte-for-byte queryable, with all business mutations disabled.
CREATE FUNCTION qf.validation_file_stop_protocol() RETURNS text LANGUAGE sql IMMUTABLE SET search_path=pg_catalog AS $$ SELECT 'candidate-receipt-db-ack.v1'::text $$;
CREATE FUNCTION qf.validation_file_stop_proof_valid(p jsonb, validation_id uuid, a jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
BEGIN
 IF (jsonb_typeof(p)='object' AND (SELECT count(*) FROM jsonb_object_keys(p))=11
   AND p ?& ARRAY['schemaVersion','protocol','validationId','attemptId','fence','ownerPid','ownerNonce','receiptSha256','scope','mediaStopped','relatedIo']
   AND p->>'schemaVersion'='quizpack-validation-file-stop-proof.v1' AND p->>'protocol'='candidate-receipt-db-ack.v1'
   AND p->>'validationId'=validation_id::text AND p->'attemptId'=a->'attemptId' AND p->'fence'=a->'fence'
   AND p->'ownerPid'=a->'ownerPid' AND p->'ownerNonce'=a->'ownerNonce'
   AND jsonb_typeof(p->'receiptSha256')='string' AND p->>'receiptSha256' ~ '^[0-9a-f]{64}$'
   AND p->>'scope'='files-and-media' AND p->>'mediaStopped' IN ('confirmed','not-started')
   AND p->>'mediaStopped'=a->>'mediaStop' AND p->>'relatedIo'='settled' AND octet_length(p::text)<=1024) IS NOT TRUE THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION qf.validation_file_stop_controls_valid(policy text, validation_id uuid, controls text, metadata text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE a jsonb; item jsonb;
BEGIN
 a:=controls::jsonb;
 IF jsonb_typeof(a)<>'array' THEN RETURN false; END IF;
 IF policy='quizpack-private-archive.v1' THEN
  RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a) x WHERE jsonb_typeof(x)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(x))<>9 OR x ? 'fileStopProof');
 END IF;
 IF policy<>'quizpack-private-archive.v2' OR (metadata IS NOT NULL AND octet_length(metadata)>57344) THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(a) LOOP
  IF (jsonb_typeof(item)='object' AND (SELECT count(*) FROM jsonb_object_keys(item))=10 AND item ? 'fileStopProof') IS NOT TRUE THEN RETURN false; END IF;
  IF item->'fileStopProof'<>'null'::jsonb AND qf.validation_file_stop_proof_valid(item->'fileStopProof',validation_id,item) IS NOT TRUE THEN RETURN false; END IF;
  IF item->>'disposition'='released' AND item->'fileStopProof'='null'::jsonb THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION qf.protect_validation_file_stop_ack() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE olda jsonb; newa jsonb; olditem jsonb; newitem jsonb; i integer; changes integer:=0;
BEGIN
 IF NEW.archive_policy_version<>'quizpack-private-archive.v2' OR NEW.archive_policy_sha256<>'f6a2d1ee2e130219fb0a59e9a8ec54a799dd99cb5dab0e993a763c58e3f75bee' THEN RAISE EXCEPTION 'VALIDATION_LEGACY_READ_ONLY' USING ERRCODE='23514'; END IF;
 newa:=NEW.attempts_text::jsonb;
 IF qf.validation_file_stop_controls_valid(NEW.archive_policy_version,NEW.id,NEW.attempts_text,NEW.evidence_metadata_text) IS NOT TRUE THEN RAISE EXCEPTION 'VALIDATION_FILE_STOP_CONTROLS' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF newa->0->'fileStopProof'<>'null'::jsonb THEN RAISE EXCEPTION 'VALIDATION_FILE_STOP_CLAIM' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 olda:=OLD.attempts_text::jsonb;
 FOR i IN 0..jsonb_array_length(olda)-1 LOOP
  olditem:=olda->i; newitem:=newa->i;
  IF olditem->'fileStopProof' IS DISTINCT FROM newitem->'fileStopProof' THEN
   changes:=changes+1;
   IF (olditem->'fileStopProof'='null'::jsonb AND jsonb_typeof(newitem->'fileStopProof')='object'
     AND olditem->>'disposition'='held' AND newitem->>'disposition'='held'
     AND olditem->>'attemptId'=OLD.current_attempt_id::text AND NEW.current_attempt_id=OLD.current_attempt_id
     AND OLD.fence=(olditem->>'fence')::integer AND OLD.lease_until>clock_timestamp()
     AND (olditem->>'mediaStop'='unconfirmed' OR olditem->>'mediaStop'=newitem->>'mediaStop')) IS NOT TRUE THEN RAISE EXCEPTION 'VALIDATION_FILE_STOP_ACK' USING ERRCODE='23514'; END IF;
  END IF;
  IF olditem->>'disposition'='held' AND newitem->>'disposition'='released' AND qf.validation_file_stop_proof_valid(olditem->'fileStopProof',OLD.id,olditem) IS NOT TRUE THEN RAISE EXCEPTION 'VALIDATION_FILE_STOP_RELEASE' USING ERRCODE='23514'; END IF;
 END LOOP;
 IF changes>0 THEN
  IF changes<>1 OR jsonb_array_length(olda)<>jsonb_array_length(newa)
    OR (to_jsonb(NEW)-'attempts_text'-'state_revision'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'attempts_text'-'state_revision'-'updated_at') THEN RAISE EXCEPTION 'VALIDATION_FILE_STOP_ACK_ISOLATION' USING ERRCODE='23514'; END IF;
 END IF;
 IF jsonb_array_length(newa)>jsonb_array_length(olda) AND newa->(jsonb_array_length(newa)-1)->'fileStopProof'<>'null'::jsonb THEN RAISE EXCEPTION 'VALIDATION_FILE_STOP_RETRY' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_validation_file_stop_ack BEFORE INSERT OR UPDATE ON qf.quizpack_validation FOR EACH ROW EXECUTE FUNCTION qf.protect_validation_file_stop_ack();
ALTER TABLE qf.quizpack_validation ADD CONSTRAINT validation_file_stop_controls CHECK(qf.validation_file_stop_controls_valid(archive_policy_version,id,attempts_text,evidence_metadata_text)) NOT VALID;
CREATE OR REPLACE FUNCTION qf.validation_attempts_valid(t text, f integer, current_id uuid, reserved bigint) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE a jsonb; item jsonb; ids text[] := '{}'; prior bigint := 0; ordinal integer := 0; total bigint := 0;
BEGIN
 IF current_setting('server_encoding') <> 'UTF8' OR current_setting('client_encoding') <> 'UTF8' OR t IS NULL OR octet_length(t) NOT BETWEEN 2 AND 8192 THEN RETURN false; END IF;
 a := t::jsonb;
 IF (jsonb_typeof(a)='array') IS NOT TRUE THEN RETURN false; END IF;
 IF jsonb_array_length(a) NOT BETWEEN 1 AND 3 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(a) LOOP
  ordinal := ordinal+1;
  IF (jsonb_typeof(item)='object') IS NOT TRUE THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(item)) NOT IN (9,10) OR NOT(item ?& ARRAY['attemptId','ordinal','fence','ownerPid','ownerNonce','kind','reservationBytes','disposition','mediaStop']) THEN RETURN false; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(item))=10 AND NOT(item ? 'fileStopProof') THEN RETURN false; END IF;
  IF ((item->>'attemptId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    AND (item->>'ownerNonce') ~ '^[A-Za-z0-9_-]{43}$'
    AND jsonb_typeof(item->'fence')='number' AND (item->>'fence') ~ '^[1-9][0-9]*$'
    AND jsonb_typeof(item->'ownerPid')='number' AND (item->>'ownerPid') ~ '^[1-9][0-9]*$'
    AND item->'ordinal'=to_jsonb(ordinal) AND item->'reservationBytes'='134283264'::jsonb
    AND item->>'kind' IN ('validate','archive') AND item->>'disposition' IN ('held','released')
    AND item->>'mediaStop' IN ('not-started','unconfirmed','confirmed')) IS NOT TRUE THEN RETURN false; END IF;
  IF item->>'attemptId'=ANY(ids) OR (item->>'fence')::bigint<=prior OR (item->>'fence')::bigint>f OR (item->>'ownerPid')::bigint>2147483647 THEN RETURN false; END IF;
  IF (item->>'kind'='archive' AND item->>'mediaStop'<>'not-started') OR (item->>'disposition'='released' AND item->>'mediaStop'='unconfirmed') THEN RETURN false; END IF;
  prior := (item->>'fence')::bigint; ids := array_append(ids,item->>'attemptId');
  IF item->>'disposition'='held' THEN total := total+134283264; END IF;
 END LOOP;
 RETURN (total=reserved AND current_id::text=ids[array_length(ids,1)]) IS TRUE;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE OR REPLACE FUNCTION qf.protect_validation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE olda jsonb; newa jsonb; olditem jsonb; newitem jsonb; i integer; imp qf.quizpack_import; target qf.quizpack_validation;
BEGIN
 IF qf.validation_shape_valid(NEW) IS NOT TRUE THEN RAISE EXCEPTION 'VALIDATION_SHAPE' USING ERRCODE='23514'; END IF;
 SELECT * INTO imp FROM qf.quizpack_import WHERE product_id=NEW.product_id AND id=NEW.import_id;
 IF (imp.status='received' AND imp.actual_archive_sha256=NEW.archive_sha256 AND imp.actual_archive_bytes=NEW.archive_bytes) IS NOT TRUE THEN RAISE EXCEPTION 'VALIDATION_IMPORT' USING ERRCODE='23514'; END IF;
 newa:=NEW.attempts_text::jsonb;
 IF TG_OP='INSERT' THEN
  IF (NEW.state_revision=1 AND NEW.fence=1 AND NEW.status='validating' AND NEW.identity_kind='unclaimed' AND jsonb_array_length(newa)=1 AND newa->0->>'kind'='validate' AND newa->0->>'mediaStop'='unconfirmed' AND newa->0->>'disposition'='held' AND NEW.reserved_bytes=134283264 AND NEW.accounted_bytes=0 AND NEW.storage_condition='unknown' AND NEW.evidence_text IS NULL AND NEW.validated_at IS NULL AND NEW.ready_at IS NULL AND NEW.lease_until>clock_timestamp()) IS NOT TRUE THEN RAISE EXCEPTION 'VALIDATION_CLAIM' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.product_id,NEW.import_id,NEW.created_by,NEW.created_at,NEW.validation_key,NEW.archive_sha256,NEW.archive_bytes,NEW.identity_text,NEW.identity_sha256,NEW.archive_policy_version,NEW.archive_policy_sha256)
    IS DISTINCT FROM ROW(OLD.id,OLD.product_id,OLD.import_id,OLD.created_by,OLD.created_at,OLD.validation_key,OLD.archive_sha256,OLD.archive_bytes,OLD.identity_text,OLD.identity_sha256,OLD.archive_policy_version,OLD.archive_policy_sha256)
    OR NEW.state_revision<>OLD.state_revision+1 OR NEW.updated_at<OLD.updated_at OR NEW.fence<OLD.fence OR NEW.fence>OLD.fence+1 THEN RAISE EXCEPTION 'VALIDATION_IMMUTABLE' USING ERRCODE='23514'; END IF;
  IF NEW.status<>OLD.status AND NOT (
    (OLD.status='validating' AND NEW.status IN ('validated','rejected','retryable-failed')) OR
    (OLD.status='validated' AND NEW.status IN ('archiving','rejected','retryable-failed')) OR
    (OLD.status='archiving' AND NEW.status IN ('ready','rejected','retryable-failed','validated')) OR
    (OLD.status='retryable-failed' AND NEW.status IN ('validating','archiving','validated','rejected'))
  ) THEN RAISE EXCEPTION 'VALIDATION_TRANSITION' USING ERRCODE='23514'; END IF;
  IF OLD.validated_at IS NULL AND NEW.validated_at IS NOT NULL AND (OLD.status='validating' AND NEW.status IN ('validated','rejected')) IS NOT TRUE THEN RAISE EXCEPTION 'VALIDATION_FIRST_EVIDENCE' USING ERRCODE='23514'; END IF;
  IF OLD.status IN ('ready','rejected') AND NEW.status<>OLD.status THEN RAISE EXCEPTION 'VALIDATION_TERMINAL' USING ERRCODE='23514'; END IF;
  IF NEW.fence=OLD.fence AND NEW.lease_until IS NOT NULL AND NEW.lease_until IS DISTINCT FROM OLD.lease_until THEN RAISE EXCEPTION 'VALIDATION_LEASE' USING ERRCODE='23514'; END IF;
  IF OLD.validated_at IS NOT NULL AND ROW(NEW.pack_id,NEW.pack_version,NEW.container_schema_version,NEW.content_schema_version,NEW.content_kind,NEW.manifest_sha256,NEW.content_sha256,NEW.canonical_manifest_text,NEW.canonical_manifest_sha256,NEW.canonical_content_text,NEW.canonical_content_sha256,NEW.asset_set_text,NEW.asset_set_sha256,NEW.candidate_sha256,NEW.resource_count,NEW.identity_kind,NEW.canonical_validation_id,NEW.validated_at)
    IS DISTINCT FROM ROW(OLD.pack_id,OLD.pack_version,OLD.container_schema_version,OLD.content_schema_version,OLD.content_kind,OLD.manifest_sha256,OLD.content_sha256,OLD.canonical_manifest_text,OLD.canonical_manifest_sha256,OLD.canonical_content_text,OLD.canonical_content_sha256,OLD.asset_set_text,OLD.asset_set_sha256,OLD.candidate_sha256,OLD.resource_count,OLD.identity_kind,OLD.canonical_validation_id,OLD.validated_at) THEN RAISE EXCEPTION 'VALIDATION_CANDIDATE_FROZEN' USING ERRCODE='23514'; END IF;
  olda:=OLD.attempts_text::jsonb;
  IF jsonb_array_length(newa)<jsonb_array_length(olda) OR jsonb_array_length(newa)>jsonb_array_length(olda)+1 THEN RAISE EXCEPTION 'VALIDATION_ATTEMPT' USING ERRCODE='23514'; END IF;
  FOR i IN 0..jsonb_array_length(olda)-1 LOOP
   olditem:=olda->i; newitem:=newa->i;
   IF (olditem-'disposition'-'mediaStop'-'fileStopProof') IS DISTINCT FROM (newitem-'disposition'-'mediaStop'-'fileStopProof') OR (olditem->>'disposition'='released' AND newitem->>'disposition'<>'released')
     OR (olditem->>'mediaStop'<>'unconfirmed' AND newitem->>'mediaStop' IS DISTINCT FROM olditem->>'mediaStop') THEN RAISE EXCEPTION 'VALIDATION_ATTEMPT_FROZEN' USING ERRCODE='23514'; END IF;
  END LOOP;
  IF jsonb_array_length(newa)>jsonb_array_length(olda) THEN
   newitem:=newa->(jsonb_array_length(newa)-1);
   IF (OLD.storage_condition='clean' AND OLD.reserved_bytes=0 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(olda) a WHERE a->>'disposition'<>'released' OR a->>'mediaStop'='unconfirmed')
     AND NEW.fence=OLD.fence+1 AND newitem->'fence'=to_jsonb(NEW.fence) AND newitem->>'disposition'='held' AND NEW.lease_until>clock_timestamp()
     AND ((OLD.validated_at IS NULL AND NEW.status='validating' AND newitem->>'kind'='validate' AND newitem->>'mediaStop'='unconfirmed')
       OR (OLD.validated_at IS NOT NULL AND NEW.status='archiving' AND newitem->>'kind'='archive' AND newitem->>'mediaStop'='not-started'))) IS NOT TRUE THEN RAISE EXCEPTION 'VALIDATION_RETRY' USING ERRCODE='23514'; END IF;
  END IF;
  IF OLD.evidence_text IS NOT NULL THEN
   olda:=OLD.evidence_text::jsonb->'attempts'; newa:=NEW.evidence_text::jsonb->'attempts';
   IF newa IS NULL OR jsonb_array_length(newa)<jsonb_array_length(olda) THEN RAISE EXCEPTION 'VALIDATION_EVIDENCE_FROZEN' USING ERRCODE='23514'; END IF;
   FOR i IN 0..jsonb_array_length(olda)-1 LOOP
    IF newa->i IS DISTINCT FROM olda->i THEN RAISE EXCEPTION 'VALIDATION_EVIDENCE_FROZEN' USING ERRCODE='23514'; END IF;
   END LOOP;
   IF cardinality(NEW.report_texts)<cardinality(OLD.report_texts) THEN RAISE EXCEPTION 'VALIDATION_REPORT_FROZEN' USING ERRCODE='23514'; END IF;
   FOR i IN 1..cardinality(OLD.report_texts) LOOP
    IF NEW.report_texts[i] IS DISTINCT FROM OLD.report_texts[i] THEN RAISE EXCEPTION 'VALIDATION_REPORT_FROZEN' USING ERRCODE='23514'; END IF;
   END LOOP;
  END IF;
 END IF;
 IF NEW.status IN ('validating','archiving') AND (NEW.lease_until>clock_timestamp()) IS NOT TRUE THEN RAISE EXCEPTION 'VALIDATION_LEASE_EXPIRED' USING ERRCODE='23514'; END IF;
 IF NEW.identity_kind='alias' THEN
  SELECT * INTO target FROM qf.quizpack_validation WHERE product_id=NEW.product_id AND id=NEW.canonical_validation_id;
  IF (target.identity_kind='canonical' AND target.pack_id=NEW.pack_id AND target.pack_version=NEW.pack_version AND target.archive_sha256=NEW.archive_sha256 AND target.archive_bytes=NEW.archive_bytes) IS NOT TRUE THEN RAISE EXCEPTION 'VALIDATION_ALIAS' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER TABLE qf.audit_event DROP CONSTRAINT audit_target;
ALTER TABLE qf.audit_event ADD CONSTRAINT audit_target CHECK (
 (target_kind IS NULL AND target_id IS NULL AND target_revision IS NULL AND action IN ('bootstrap','operator_disabled','preauth_created','login_succeeded','login_failed','logout','session_revoked'))
 OR (target_kind IS NOT NULL AND target_id IS NOT NULL AND target_revision IS NOT NULL AND target_revision >= 1
 AND actor_id IS NOT NULL AND session_id IS NOT NULL AND outcome = 'success' AND reason_code IS NULL
 AND ((target_kind = 'product' AND target_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND action IN ('product_created','product_updated','product_archived','product_restored'))
 OR (target_kind = 'category' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('category_created','category_updated','category_archived','category_restored'))
 OR (target_kind = 'tag' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('tag_created','tag_updated','tag_archived','tag_restored'))
 OR (target_kind = 'validation' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('validation_started','validation_evidenced','validation_rejected','validation_interrupted','validation_completed','validation_recovered','validation_retried','validation_file_stop_acknowledged'))
 OR (target_kind = 'import' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('import_intent_created','import_receive_started','import_receive_completed','import_receive_failed','import_receive_recovered'))))
);

-- Explicitly revalidate all affected existing CHECKs after replacing their helper implementation.
DO $$ DECLARE v qf.quizpack_validation; BEGIN
 FOR v IN SELECT * FROM qf.quizpack_validation LOOP
  IF qf.validation_attempts_valid(v.attempts_text,v.fence,v.current_attempt_id,v.reserved_bytes) IS NOT TRUE
    OR qf.validation_evidence_valid(v.evidence_text,v.report_texts,v.evidence_metadata_text,v.attempts_text) IS NOT TRUE
    OR qf.validation_shape_valid(v) IS NOT TRUE THEN RAISE EXCEPTION 'VALIDATION_EXISTING_DATA' USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;
ALTER TABLE qf.quizpack_validation VALIDATE CONSTRAINT validation_file_stop_controls;
REVOKE ALL ON FUNCTION qf.validation_file_stop_protocol(),qf.validation_file_stop_proof_valid(jsonb,uuid,jsonb),qf.validation_file_stop_controls_valid(text,uuid,text,text),qf.protect_validation_file_stop_ack() FROM PUBLIC;
