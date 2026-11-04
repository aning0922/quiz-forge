-- Latest-only policy, batch A. New isolated instance + matching future service only.
-- No bootstrap head, no production readiness; existing migrations remain unchanged.
DO $pre$ DECLARE actual text; BEGIN
 IF NOT pg_try_advisory_xact_lock(72461,2) THEN RAISE EXCEPTION 'CONSUMER_IO_PRESENT' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename=replace(current_user,'qf_owner_','qf_app_') AND pid<>pg_backend_pid()) THEN RAISE EXCEPTION 'CONSUMER_WRITERS_PRESENT' USING ERRCODE='55000'; END IF;
 SELECT sha256 INTO actual FROM (
WITH snapshot AS (
WITH roles AS (
 SELECT (SELECT oid FROM pg_roles WHERE rolname=replace(current_user,'qf_app_','qf_owner_')) owner_id,
        (SELECT oid FROM pg_roles WHERE rolname=replace(current_user,'qf_owner_','qf_app_')) app_id
), relations AS (
 SELECT c.* FROM pg_class c WHERE c.relnamespace='qf'::regnamespace AND c.relkind IN ('r','p')
), facts AS (SELECT jsonb_build_object(
 'tables',(SELECT jsonb_agg(jsonb_build_object('name',c.relname,'kind',c.relkind,'owner',c.relowner=roles.owner_id,'rls',c.relrowsecurity,'forceRls',c.relforcerowsecurity,
   'acl',(SELECT jsonb_agg(jsonb_build_array(CASE a.grantee WHEN 0 THEN 'public' WHEN roles.owner_id THEN 'owner' WHEN roles.app_id THEN 'app' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable) ORDER BY a.grantee=0,a.grantee=roles.owner_id,a.privilege_type) FROM aclexplode(coalesce(c.relacl,acldefault('r',c.relowner))) a)) ORDER BY c.relname) FROM relations c),
 'columns',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',a.attname,'type',format_type(a.atttypid,a.atttypmod),'required',a.attnotnull,'default',pg_get_expr(d.adbin,d.adrelid),'identity',a.attidentity,'generated',a.attgenerated,'collation',CASE WHEN a.attcollation=0 THEN '' ELSE a.attcollation::regcollation::text END,
   'acl',(SELECT jsonb_agg(jsonb_build_array(CASE p.grantee WHEN 0 THEN 'public' WHEN roles.owner_id THEN 'owner' WHEN roles.app_id THEN 'app' ELSE pg_get_userbyid(p.grantee) END,p.privilege_type,p.is_grantable) ORDER BY p.grantee=0,p.grantee=roles.owner_id,p.privilege_type) FROM aclexplode(a.attacl) p)) ORDER BY c.relname,a.attnum) FROM relations c JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum),
 'constraints',(SELECT jsonb_agg(jsonb_build_object('table',c.relname,'name',k.conname,'kind',k.contype,'definition',pg_get_constraintdef(k.oid),'valid',k.convalidated,'enforced',k.conenforced,'deferrable',k.condeferrable,'deferred',k.condeferred) ORDER BY c.relname,k.conname) FROM relations c JOIN pg_constraint k ON k.conrelid=c.oid),
 'indexes',(SELECT jsonb_agg(jsonb_build_object('name',i.indexrelid::regclass::text,'definition',pg_get_indexdef(i.indexrelid),'valid',i.indisvalid,'ready',i.indisready,'live',i.indislive,'immediate',i.indimmediate,'nullsNotDistinct',i.indnullsnotdistinct) ORDER BY i.indexrelid::regclass::text) FROM relations c JOIN pg_index i ON i.indrelid=c.oid),
 'triggers',(SELECT jsonb_agg(item ORDER BY item::text) FROM (SELECT jsonb_build_object('table',c.relname,'name',CASE WHEN t.tgisinternal THEN '' ELSE t.tgname END,'internal',t.tgisinternal,'type',t.tgtype,'enabled',t.tgenabled,'function',t.tgfoid::regprocedure::text,'constraint',k.conname,'deferrable',t.tgdeferrable,'deferred',t.tginitdeferred,'args',encode(t.tgargs,'hex'),'nargs',t.tgnargs,'attr',t.tgattr::text,'qual',pg_get_expr(t.tgqual,t.tgrelid),'old',t.tgoldtable,'new',t.tgnewtable,'parent',t.tgparentid=0) AS item FROM relations c JOIN pg_trigger t ON t.tgrelid=c.oid LEFT JOIN pg_constraint k ON k.oid=t.tgconstraint) trigger_facts),
 'functions',(SELECT jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,'body',encode(sha256(convert_to(p.prosrc,'UTF8')),'hex'),'owner',p.proowner=roles.owner_id,'language',l.lanname,'result',p.prorettype::regtype::text,'strict',p.proisstrict,'volatility',p.provolatile,'securityDefiner',p.prosecdef,'leakproof',p.proleakproof,'kind',p.prokind,'retset',p.proretset,'defaults',p.pronargdefaults,'config',p.proconfig,
  'acl',(SELECT jsonb_agg(jsonb_build_array(CASE a.grantee WHEN 0 THEN 'public' WHEN roles.owner_id THEN 'owner' WHEN roles.app_id THEN 'app' ELSE pg_get_userbyid(a.grantee) END,a.privilege_type,a.is_grantable) ORDER BY a.grantee=0,a.grantee=roles.owner_id,a.privilege_type) FROM aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a)) ORDER BY p.oid::regprocedure::text) FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.pronamespace='qf'::regnamespace),
 'enums',(SELECT jsonb_agg(jsonb_build_array(t.typname,e.enumlabel) ORDER BY t.typname,e.enumsortorder) FROM pg_type t JOIN pg_enum e ON e.enumtypid=t.oid WHERE t.typnamespace='qf'::regnamespace)
) value FROM roles)
SELECT value,encode(sha256(convert_to(value::text,'UTF8')),'hex') sha256 FROM facts), reduced AS (
 SELECT value || jsonb_build_object(
   'tables',(SELECT jsonb_agg(x-'acl' ORDER BY n) FROM jsonb_array_elements(value->'tables') WITH ORDINALITY t(x,n)),
   'columns',(SELECT jsonb_agg(x-'acl' ORDER BY n) FROM jsonb_array_elements(value->'columns') WITH ORDINALITY t(x,n)),
   'functions',(SELECT jsonb_agg(x-'acl' ORDER BY n) FROM jsonb_array_elements(value->'functions') WITH ORDINALITY t(x,n))
 ) AS value FROM snapshot
) SELECT value,encode(sha256(convert_to(value::text,'UTF8')),'hex') sha256 FROM reduced) previous;
 IF actual IS DISTINCT FROM '888a87e5d59db4f821a7634c628b05dfcd2165d47bfd174f312811022ce0757c' THEN RAISE EXCEPTION 'CONSUMER_PREVIOUS_SCHEMA_MISMATCH' USING ERRCODE='55000'; END IF;
END $pre$;
LOCK TABLE qf.access_key,qf.audit_event,qf.consumer_session,qf.consumer_grant,qf.internal_play_version,qf.operator,qf.operator_session,qf.product,qf.quiz_report IN SHARE ROW EXCLUSIVE MODE NOWAIT;
-- Internal batch A only. No default activation; old writers are intentionally incompatible.
ALTER TYPE qf.audit_action ADD VALUE 'consumer_product_enabled';

CREATE TABLE qf.consumer_product_activation (
 id uuid PRIMARY KEY, product_id varchar(80) NOT NULL REFERENCES qf.product(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 operation_key uuid NOT NULL, expected_generation integer NOT NULL CHECK(expected_generation BETWEEN 0 AND 2147483646),
 generation integer NOT NULL CHECK(generation BETWEEN 1 AND 2147483647 AND generation=expected_generation+1),
 play_version_id uuid NOT NULL, play_snapshot_sha256 char(64) NOT NULL,
 binding_text text NOT NULL, binding_sha256 char(64) NOT NULL,
 activated_by uuid NOT NULL REFERENCES qf.operator(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 operator_session_id uuid NOT NULL,
 request_id uuid NOT NULL, activated_at timestamptz NOT NULL,
 receipt_text text NOT NULL, receipt_sha256 char(64) NOT NULL,
 CONSTRAINT consumer_activation_operation UNIQUE(product_id,operation_key),
 CONSTRAINT consumer_activation_generation UNIQUE(product_id,generation),
 CONSTRAINT consumer_activation_exact UNIQUE(product_id,generation,play_version_id,play_snapshot_sha256),
 CONSTRAINT consumer_activation_play FOREIGN KEY(play_version_id,product_id,play_snapshot_sha256)
  REFERENCES qf.internal_play_version(id,product_id,snapshot_sha256) ON UPDATE RESTRICT ON DELETE RESTRICT,
 CONSTRAINT consumer_activation_text CHECK((octet_length(binding_text)<=4096 AND octet_length(receipt_text)<=8192
  AND binding_sha256=qf.sha256_utf8(binding_text) AND receipt_sha256=qf.sha256_utf8(receipt_text)) IS TRUE)
);
CREATE TABLE qf.consumer_product_head (
 product_id varchar(80) PRIMARY KEY,
 generation integer NOT NULL CHECK(generation BETWEEN 1 AND 2147483647),
 play_version_id uuid NOT NULL, play_snapshot_sha256 char(64) NOT NULL,
 CONSTRAINT consumer_head_activation FOREIGN KEY(product_id,generation,play_version_id,play_snapshot_sha256)
  REFERENCES qf.consumer_product_activation(product_id,generation,play_version_id,play_snapshot_sha256) ON UPDATE RESTRICT ON DELETE RESTRICT
);

-- Legacy original values are never UPDATE-backfilled, including completed sessions.
ALTER TABLE qf.consumer_session
 ADD COLUMN activation_generation integer NOT NULL DEFAULT 0,
 ADD COLUMN issued_play_version_id uuid,
 ADD COLUMN issued_play_snapshot_sha256 char(64),
 ADD COLUMN key_bound_play_version_id uuid GENERATED ALWAYS AS (coalesce(issued_play_version_id,play_version_id)) STORED NOT NULL,
 ADD COLUMN key_bound_play_snapshot_sha256 char(64) GENERATED ALWAYS AS (coalesce(issued_play_snapshot_sha256,play_snapshot_sha256)) STORED NOT NULL,
 ADD COLUMN activation_ref_generation integer GENERATED ALWAYS AS (nullif(activation_generation,0)) STORED;
ALTER TABLE qf.consumer_session ADD CONSTRAINT consumer_attempt_origin CHECK(
 (activation_generation=0 AND issued_play_version_id IS NULL AND issued_play_snapshot_sha256 IS NULL)
 OR (activation_generation BETWEEN 1 AND 2147483647 AND issued_play_version_id IS NOT NULL AND issued_play_snapshot_sha256 IS NOT NULL));
-- Replace the original FK with the FULL original issue tuple, never just key_id.
ALTER TABLE qf.consumer_session DROP CONSTRAINT consumer_session_key;
ALTER TABLE qf.consumer_session ADD CONSTRAINT consumer_session_key FOREIGN KEY(key_id,product_id,key_bound_play_version_id,key_bound_play_snapshot_sha256)
 REFERENCES qf.access_key(id,product_id,play_version_id,play_snapshot_sha256) ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE qf.consumer_session ADD CONSTRAINT consumer_attempt_play FOREIGN KEY(play_version_id,product_id,play_snapshot_sha256)
 REFERENCES qf.internal_play_version(id,product_id,snapshot_sha256) ON UPDATE RESTRICT ON DELETE RESTRICT;
-- Attempts point to immutable activation history, NEVER the mutable head.
ALTER TABLE qf.consumer_session ADD CONSTRAINT consumer_attempt_activation FOREIGN KEY(product_id,activation_ref_generation,play_version_id,play_snapshot_sha256)
 REFERENCES qf.consumer_product_activation(product_id,generation,play_version_id,play_snapshot_sha256) MATCH SIMPLE ON UPDATE RESTRICT ON DELETE RESTRICT;
ALTER TABLE qf.consumer_session DROP CONSTRAINT consumer_session_key_id_key;
ALTER TABLE qf.consumer_session ADD CONSTRAINT consumer_attempt_per_generation UNIQUE(key_id,activation_generation);

-- Scope lock is SECURITY DEFINER only to acquire row locks on the read-only head.
-- It cannot activate or modify anything. NOWAIT avoids waiting upward if an owner
-- issues a raw UPDATE whose tuple was implicitly locked before its row trigger.
-- App UPDATE on key/session/grant is removed: future guarded service entrypoints
-- must acquire fence -> product -> head -> key -> session -> grant BEFORE DML.
CREATE FUNCTION qf.consumer_policy_scope(p_product text) RETURNS qf.consumer_product_head
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE result qf.consumer_product_head;
BEGIN
 IF NOT pg_try_advisory_xact_lock_shared(72461,2) THEN RAISE EXCEPTION 'CONSUMER_MAINTENANCE_BUSY' USING ERRCODE='55P03'; END IF;
 PERFORM 1 FROM qf.product WHERE id=p_product FOR SHARE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONSUMER_PRODUCT_MISSING' USING ERRCODE='23514'; END IF;
 SELECT * INTO result FROM qf.consumer_product_head WHERE product_id=p_product FOR SHARE NOWAIT;
 RETURN result;
END $$;

CREATE FUNCTION qf.consumer_policy_attempt(p_product text,p_key uuid,p_session uuid,p_play uuid,p_sha text,p_generation integer) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h qf.consumer_product_head; k qf.access_key;
BEGIN
 h:=qf.consumer_policy_scope(p_product);
 SELECT * INTO k FROM qf.access_key WHERE id=p_key AND product_id=p_product FOR UPDATE NOWAIT;
 IF NOT FOUND OR k.revoked_at IS NOT NULL OR k.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CONSUMER_KEY_NOT_ACTIVE' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM qf.consumer_session WHERE id=p_session AND key_id=p_key FOR UPDATE NOWAIT;
 IF EXISTS(SELECT 1 FROM qf.quiz_report WHERE key_id=p_key) THEN RAISE EXCEPTION 'CONSUMER_KEY_COMPLETED' USING ERRCODE='23514'; END IF;
 IF h.product_id IS NULL OR p_generation<1 OR ROW(h.generation,h.play_version_id,h.play_snapshot_sha256::text) IS DISTINCT FROM ROW(p_generation,p_play,p_sha)
  THEN RAISE EXCEPTION 'VERSION_SUPERSEDED' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM qf.product WHERE id=p_product AND archived_at IS NOT NULL) THEN RAISE EXCEPTION 'CONSUMER_PRODUCT_INACTIVE' USING ERRCODE='23514'; END IF;
END $$;

CREATE FUNCTION qf.protect_consumer_activation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE h qf.consumer_product_head; binding jsonb; receipt jsonb; actor qf.operator; auth qf.operator_session;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'IMMUTABLE_CONSUMER_ACTIVATION' USING ERRCODE='23514'; END IF;
 IF NOT pg_try_advisory_xact_lock_shared(72461,2) THEN RAISE EXCEPTION 'CONSUMER_MAINTENANCE_BUSY' USING ERRCODE='55P03'; END IF;
 PERFORM 1 FROM qf.product WHERE id=NEW.product_id AND archived_at IS NULL FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONSUMER_PRODUCT_INACTIVE' USING ERRCODE='23514'; END IF;
 SELECT * INTO h FROM qf.consumer_product_head WHERE product_id=NEW.product_id FOR UPDATE NOWAIT;
 IF NEW.expected_generation<>coalesce(h.generation,0) OR NEW.generation<>NEW.expected_generation+1 THEN RAISE EXCEPTION 'CONSUMER_ACTIVATION_CONFLICT' USING ERRCODE='23514'; END IF;
 SELECT * INTO actor FROM qf.operator WHERE id=NEW.activated_by FOR SHARE NOWAIT;
 SELECT * INTO auth FROM qf.operator_session WHERE id=NEW.operator_session_id AND operator_id=actor.id FOR SHARE NOWAIT;
 IF actor.id IS NULL OR actor.status::text<>'active' OR actor.role::text NOT IN ('admin','operator') OR auth.id IS NULL OR auth.kind::text<>'authenticated'
  OR auth.revoked_at IS NOT NULL OR auth.idle_expires_at<=clock_timestamp() OR auth.absolute_expires_at<=clock_timestamp()
  THEN RAISE EXCEPTION 'CONSUMER_ACTIVATION_AUTHORITY' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM qf.internal_play_version WHERE (id,product_id,snapshot_sha256)=(NEW.play_version_id,NEW.product_id,NEW.play_snapshot_sha256);
 IF NOT FOUND THEN RAISE EXCEPTION 'CONSUMER_ACTIVATION_PLAY_MISSING' USING ERRCODE='23514'; END IF;
 binding:=jsonb_build_object('schemaVersion','quizforge.consumer-product-activate.v1','productId',NEW.product_id,'operationKey',NEW.operation_key,
  'expectedGeneration',NEW.expected_generation,'playVersionId',NEW.play_version_id,'playSnapshotSha256',NEW.play_snapshot_sha256::text);
 IF NEW.binding_text IS DISTINCT FROM qf.consumer_canonical(binding) OR NEW.binding_sha256 IS DISTINCT FROM qf.sha256_utf8(NEW.binding_text)
  THEN RAISE EXCEPTION 'CONSUMER_ACTIVATION_BINDING' USING ERRCODE='23514'; END IF;
 NEW.activated_at:=date_trunc('milliseconds',clock_timestamp());
 receipt:=jsonb_build_object('schemaVersion','quizforge.consumer-product-activation-receipt.v1','id',NEW.id,'binding',binding,'bindingSha256',NEW.binding_sha256::text,
  'generation',NEW.generation,'activatedBy',NEW.activated_by,'activatedAt',qf.consumer_moment(NEW.activated_at));
 NEW.receipt_text:=qf.consumer_canonical(receipt); NEW.receipt_sha256:=qf.sha256_utf8(NEW.receipt_text);
 RETURN NEW;
END $$;
CREATE TRIGGER consumer_activation_change BEFORE INSERT OR UPDATE OR DELETE ON qf.consumer_product_activation FOR EACH ROW EXECUTE FUNCTION qf.protect_consumer_activation();

CREATE FUNCTION qf.protect_consumer_head() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'IMMUTABLE_CONSUMER_HEAD' USING ERRCODE='23514'; END IF;
 IF NOT pg_try_advisory_xact_lock_shared(72461,2) THEN RAISE EXCEPTION 'CONSUMER_MAINTENANCE_BUSY' USING ERRCODE='55P03'; END IF;
 PERFORM 1 FROM qf.product WHERE id=NEW.product_id AND archived_at IS NULL FOR UPDATE NOWAIT;
 IF NOT FOUND OR (TG_OP='INSERT' AND NEW.generation<>1) OR (TG_OP='UPDATE' AND (NEW.product_id<>OLD.product_id OR NEW.generation::bigint<>OLD.generation::bigint+1))
  THEN RAISE EXCEPTION 'CONSUMER_HEAD_GENERATION' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER consumer_head_change BEFORE INSERT OR UPDATE OR DELETE ON qf.consumer_product_head FOR EACH ROW EXECUTE FUNCTION qf.protect_consumer_head();

CREATE FUNCTION qf.apply_consumer_activation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NEW.expected_generation=0 THEN
 INSERT INTO qf.consumer_product_head(product_id,generation,play_version_id,play_snapshot_sha256) VALUES(NEW.product_id,NEW.generation,NEW.play_version_id,NEW.play_snapshot_sha256);
 ELSE
 UPDATE qf.consumer_product_head SET generation=NEW.generation,play_version_id=NEW.play_version_id,play_snapshot_sha256=NEW.play_snapshot_sha256 WHERE product_id=NEW.product_id AND generation=NEW.expected_generation;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONSUMER_ACTIVATION_CONFLICT' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO qf.audit_event(id,action,outcome,actor_id,session_id,request_id,target_kind,target_id,target_revision)
 VALUES(NEW.id,'consumer_product_enabled','success',NEW.activated_by,NEW.operator_session_id,NEW.request_id,'product',NEW.product_id,NEW.generation);
 RETURN NEW;
END $$;
CREATE TRIGGER consumer_activation_apply AFTER INSERT ON qf.consumer_product_activation FOR EACH ROW EXECUTE FUNCTION qf.apply_consumer_activation();

-- Extend only this audit action; retain the exact original expression.
DO $audit$ DECLARE previous text; BEGIN
 SELECT pg_get_constraintdef(oid) INTO STRICT previous FROM pg_constraint WHERE conrelid='qf.audit_event'::regclass AND conname='audit_target';
 EXECUTE 'ALTER TABLE qf.audit_event DROP CONSTRAINT audit_target';
 EXECUTE 'ALTER TABLE qf.audit_event ADD CONSTRAINT audit_target CHECK(('||substring(previous FROM 7)||' OR '
  ||'(action::text=''consumer_product_enabled'' AND target_kind=''product'' AND target_id IS NOT NULL AND target_id~''^[a-z][a-z0-9]*(-[a-z0-9]+)*$'' '
  ||'AND target_revision BETWEEN 1 AND 2147483647 AND actor_id IS NOT NULL AND session_id IS NOT NULL AND outcome::text=''success'' AND reason_code IS NULL)) IS TRUE)';
END $audit$;

REVOKE ALL ON qf.consumer_product_head,qf.consumer_product_activation FROM PUBLIC;
REVOKE ALL ON FUNCTION qf.consumer_policy_scope(text),qf.consumer_policy_attempt(text,uuid,uuid,uuid,text,integer),qf.protect_consumer_activation(),qf.protect_consumer_head(),qf.apply_consumer_activation() FROM PUBLIC;

CREATE OR REPLACE FUNCTION qf.protect_consumer_key() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE archived timestamptz;
BEGIN
 PERFORM qf.consumer_policy_scope(NEW.product_id);
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM qf.consumer_product_head WHERE (product_id,play_version_id,play_snapshot_sha256)=(NEW.product_id,NEW.play_version_id,NEW.play_snapshot_sha256)) THEN RAISE EXCEPTION 'CONSUMER_NO_ENABLED_PLAY' USING ERRCODE='23514'; END IF;
 IF NOT pg_try_advisory_xact_lock_shared(72461,2) THEN RAISE EXCEPTION 'CONSUMER_MAINTENANCE_BUSY' USING ERRCODE='55P03'; END IF;
 IF TG_OP='INSERT' THEN
  -- consumer_policy_scope already pins archive state with product SHARE before head.
  SELECT archived_at INTO archived FROM qf.product WHERE id=NEW.product_id;
  IF NOT FOUND OR archived IS NOT NULL OR NEW.revoked_at IS NOT NULL OR NEW.void_operation_key IS NOT NULL OR NEW.void_binding_text IS NOT NULL OR NEW.void_binding_sha256 IS NOT NULL OR NEW.voided_by IS NOT NULL THEN RAISE EXCEPTION 'CONSUMER_INVALID_ISSUE' USING ERRCODE='23514'; END IF;
  NEW.issued_at:=date_trunc('milliseconds',clock_timestamp());NEW.expires_at:=NEW.issued_at+NEW.valid_for_seconds*interval '1 second';
 ELSE
  IF (to_jsonb(NEW)-ARRAY['revoked_at','void_operation_key','void_binding_text','void_binding_sha256','voided_by']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['revoked_at','void_operation_key','void_binding_text','void_binding_sha256','voided_by']) OR OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN RAISE EXCEPTION 'IMMUTABLE_CONSUMER_ISSUE' USING ERRCODE='23514'; END IF;
  -- UPDATE already holds this Key's row lock. Session INSERT takes the same Key lock before checking void.
  IF EXISTS(SELECT 1 FROM qf.consumer_session WHERE key_id=OLD.id) OR EXISTS(SELECT 1 FROM qf.quiz_report WHERE key_id=OLD.id) THEN RAISE EXCEPTION 'CONSUMER_KEY_CLAIMED' USING ERRCODE='23514'; END IF;
  NEW.revoked_at:=date_trunc('milliseconds',clock_timestamp());
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION qf.protect_consumer_session() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k qf.access_key; source jsonb; progress jsonb; is_v2 boolean; questions jsonb; context jsonb;
BEGIN
 PERFORM qf.consumer_policy_attempt(NEW.product_id,NEW.key_id,NEW.id,NEW.play_version_id,NEW.play_snapshot_sha256::text,NEW.activation_generation);
 IF TG_OP='UPDATE' AND ROW(NEW.activation_generation,NEW.issued_play_version_id,NEW.issued_play_snapshot_sha256) IS DISTINCT FROM ROW(OLD.activation_generation,OLD.issued_play_version_id,OLD.issued_play_snapshot_sha256) THEN RAISE EXCEPTION 'IMMUTABLE_CONSUMER_ATTEMPT' USING ERRCODE='23514'; END IF;
 IF NOT pg_try_advisory_xact_lock_shared(72461,2) THEN RAISE EXCEPTION 'CONSUMER_MAINTENANCE_BUSY' USING ERRCODE='55P03'; END IF;
 SELECT * INTO k FROM qf.access_key WHERE id=NEW.key_id FOR UPDATE;
 IF NOT FOUND OR k.revoked_at IS NOT NULL OR k.void_operation_key IS NOT NULL OR k.void_binding_text IS NOT NULL OR k.void_binding_sha256 IS NOT NULL OR k.voided_by IS NOT NULL THEN RAISE EXCEPTION 'CONSUMER_KEY_VOID' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state_revision<>0 OR k.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CONSUMER_INVALID_CLAIM' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.key_id,NEW.product_id,NEW.play_version_id,NEW.play_snapshot_sha256,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.key_id,OLD.product_id,OLD.play_version_id,OLD.play_snapshot_sha256,OLD.created_at) OR NEW.state_revision::bigint<>OLD.state_revision::bigint+1 THEN RAISE EXCEPTION 'CONSUMER_INVALID_REVISION' USING ERRCODE='23514'; END IF;
 END IF;
 SELECT d.canonical_content_text::jsonb INTO source FROM qf.internal_play_version p JOIN qf.product_version v ON(v.id,v.product_id,v.snapshot_sha256)=(p.parent_version_id,p.product_id,p.parent_snapshot_sha256) JOIN qf.draft_revision d ON(d.product_id,d.draft_id,d.revision)=(v.product_id,v.draft_id,v.revision) WHERE p.id=NEW.play_version_id AND p.product_id=NEW.product_id AND p.snapshot_sha256=NEW.play_snapshot_sha256;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONSUMER_SOURCE_MISSING' USING ERRCODE='23514'; END IF;
 is_v2:=qf.consumer_protocol_v2(NEW.product_id,NEW.play_version_id,NEW.play_snapshot_sha256::text);
 IF is_v2 IS NULL THEN RAISE EXCEPTION 'CONSUMER_PROTOCOL_MISMATCH' USING ERRCODE='23514'; END IF;
 IF is_v2 THEN
  IF source->>'schemaVersion'<>'quizpack-content.v3' OR NEW.matching_context_text IS NULL OR NEW.matching_context_sha256 IS NULL THEN RAISE EXCEPTION 'CONSUMER_CONTEXT_REQUIRED' USING ERRCODE='23514'; END IF;
  context:=NEW.matching_context_text::jsonb;
  IF context<>'null'::jsonb AND context->'policyRef' IS DISTINCT FROM source#>'{core,scoringDefinition,matchingPolicy,ref}' THEN RAISE EXCEPTION 'CONSUMER_CONTEXT_POLICY' USING ERRCODE='23514'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',q#>>'{ref,id}','options',(SELECT jsonb_agg(jsonb_build_object('id',o#>>'{ref,id}')) FROM jsonb_array_elements(q->'options') o))),'[]'::jsonb) INTO questions FROM jsonb_array_elements(source#>'{core,questions}') q;
 ELSE
  IF source->>'schemaVersion'<>'quizpack-content.v2' OR NEW.matching_context_text IS NOT NULL OR NEW.matching_context_sha256 IS NOT NULL THEN RAISE EXCEPTION 'CONSUMER_PROTOCOL_MISMATCH' USING ERRCODE='23514'; END IF;
  questions:=source->'questions';
 END IF;
 IF jsonb_typeof(questions)<>'array' OR jsonb_array_length(questions)=0 THEN RAISE EXCEPTION 'CONSUMER_SOURCE_MISSING' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(NEW.answers_text::jsonb->'answers') a WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(questions) q CROSS JOIN LATERAL jsonb_array_elements(q->'options') o WHERE q->>'id'=a->>'questionId' AND o->>'id'=a->>'optionId')) THEN RAISE EXCEPTION 'CONSUMER_INVALID_ANSWER' USING ERRCODE='23514'; END IF;
 progress:=NEW.progress_text::jsonb->'progress'->'questionId';
 IF progress IS DISTINCT FROM 'null'::jsonb AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(questions) q WHERE q->'id'=progress) THEN RAISE EXCEPTION 'CONSUMER_INVALID_PROGRESS' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION qf.protect_consumer_grant() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE k qf.access_key; selected integer; at timestamptz; attempt qf.consumer_session; historical uuid; pure_logout boolean;
BEGIN
 pure_logout:=TG_OP='UPDATE' AND (to_jsonb(NEW)-'revoked_at') IS NOT DISTINCT FROM (to_jsonb(OLD)-'revoked_at');
 SELECT * INTO attempt FROM qf.consumer_session WHERE id=NEW.session_id AND key_id=NEW.key_id;
 IF attempt.id IS NULL THEN RAISE EXCEPTION 'CONSUMER_GRANT_SESSION_MISSING' USING ERRCODE='23514'; END IF;
 PERFORM qf.consumer_policy_scope(attempt.product_id);
 SELECT * INTO k FROM qf.access_key WHERE id=NEW.key_id FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONSUMER_KEY_VOID' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM qf.consumer_session WHERE id=NEW.session_id AND key_id=NEW.key_id FOR UPDATE NOWAIT;
 IF TG_OP='UPDATE' THEN
  PERFORM 1 FROM qf.consumer_grant WHERE key_id=OLD.key_id AND slot=OLD.slot AND session_id=OLD.session_id
   AND grant_id=OLD.grant_id AND credential_digest=OLD.credential_digest FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'IMMUTABLE_GRANT_SCOPE' USING ERRCODE='23514'; END IF;
 END IF;
 at:=date_trunc('milliseconds',clock_timestamp());
 -- Pure revocation is scoped to the exact original grant and cannot change any
 -- session/token/lifetime field. It must also work after supersession or expiry.
 IF pure_logout THEN
  IF OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL THEN RAISE EXCEPTION 'IMMUTABLE_GRANT_LOGOUT' USING ERRCODE='23514'; END IF;
  NEW.revoked_at:=at; RETURN NEW;
 END IF;
 -- Issuance and fresh-token rotation still require current-attempt or original-report authority.
 SELECT session_id INTO historical FROM qf.quiz_report WHERE key_id=NEW.key_id;
 IF historical IS NOT NULL THEN
  IF historical<>NEW.session_id THEN RAISE EXCEPTION 'CONSUMER_GRANT_REPORT_SCOPE' USING ERRCODE='23514'; END IF;
 ELSE
  PERFORM qf.consumer_policy_attempt(attempt.product_id,NEW.key_id,NEW.session_id,attempt.play_version_id,attempt.play_snapshot_sha256::text,attempt.activation_generation);
 END IF;
 IF k.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'CONSUMER_KEY_VOID' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND (ROW(NEW.key_id,NEW.slot) IS DISTINCT FROM ROW(OLD.key_id,OLD.slot) OR (NEW.session_id<>OLD.session_id AND (NEW.grant_id=OLD.grant_id OR NEW.credential_digest=OLD.credential_digest))) THEN RAISE EXCEPTION 'IMMUTABLE_GRANT_SCOPE' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.grant_id,NEW.credential_digest,NEW.issued_at,NEW.expires_at) IS NOT DISTINCT FROM ROW(OLD.grant_id,OLD.credential_digest,OLD.issued_at,OLD.expires_at) THEN
  RAISE EXCEPTION 'IMMUTABLE_GRANT_LOGOUT' USING ERRCODE='23514';
 END IF;
 IF k.expires_at<=at AND NOT EXISTS(SELECT 1 FROM qf.quiz_report WHERE key_id=k.id) THEN RAISE EXCEPTION 'CONSUMER_KEY_EXPIRED' USING ERRCODE='23514'; END IF;
 SELECT slot INTO selected FROM qf.consumer_grant WHERE key_id=NEW.key_id AND (revoked_at IS NOT NULL OR expires_at<=at) ORDER BY slot LIMIT 1;
 IF selected IS NULL THEN SELECT n INTO selected FROM generate_series(1,16) n WHERE NOT EXISTS(SELECT 1 FROM qf.consumer_grant g WHERE g.key_id=NEW.key_id AND g.slot=n) ORDER BY n LIMIT 1; END IF;
 IF selected IS NULL THEN SELECT slot INTO selected FROM qf.consumer_grant WHERE key_id=NEW.key_id ORDER BY issued_at,slot LIMIT 1; END IF;
 IF NEW.slot IS DISTINCT FROM selected OR NEW.revoked_at IS NOT NULL OR (TG_OP='UPDATE' AND (NEW.grant_id=OLD.grant_id OR NEW.credential_digest=OLD.credential_digest)) THEN RAISE EXCEPTION 'CONSUMER_GRANT_ROTATION' USING ERRCODE='23514'; END IF;
 NEW.issued_at:=at;NEW.expires_at:=at+interval '8 hours';RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION qf.protect_consumer_report() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE p qf.internal_play_version; s qf.consumer_session; body jsonb; expected jsonb; is_v2 boolean; source jsonb; score jsonb; display jsonb; normalized jsonb; chosen_character jsonb; expected_body jsonb; k qf.access_key;
BEGIN

 SELECT * INTO s FROM qf.consumer_session WHERE id=NEW.session_id AND key_id=NEW.key_id;
 IF s.id IS NULL THEN RAISE EXCEPTION 'CONSUMER_REPORT_SOURCE_MISSING' USING ERRCODE='23514'; END IF;
 PERFORM qf.consumer_policy_attempt(NEW.product_id,NEW.key_id,NEW.session_id,NEW.play_version_id,NEW.play_snapshot_sha256::text,s.activation_generation);
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'IMMUTABLE_CONSUMER_REPORT' USING ERRCODE='23514'; END IF;
 IF NOT pg_try_advisory_xact_lock_shared(72461,2) THEN RAISE EXCEPTION 'CONSUMER_MAINTENANCE_BUSY' USING ERRCODE='55P03'; END IF;
 PERFORM 1 FROM qf.access_key WHERE id=NEW.key_id FOR UPDATE;
 SELECT * INTO s FROM qf.consumer_session WHERE id=NEW.session_id AND key_id=NEW.key_id FOR UPDATE;
 SELECT * INTO p FROM qf.internal_play_version WHERE id=NEW.play_version_id AND product_id=NEW.product_id AND snapshot_sha256=NEW.play_snapshot_sha256;
 IF s.id IS NULL OR p.id IS NULL THEN RAISE EXCEPTION 'CONSUMER_REPORT_SOURCE_MISSING' USING ERRCODE='23514'; END IF;
 expected:=jsonb_build_object('schemaVersion','quizforge.internal-play-receipt.v1','id',p.id,'slot',p.slot,'binding',p.binding_text::jsonb,'bindingSha256',p.binding_sha256::text,'snapshotSha256',p.snapshot_sha256::text,'createdBy',p.created_by,'createdAt',qf.consumer_moment(p.created_at),'purpose','internal-test','publicationApproved',false);
 body:=NEW.snapshot_text::jsonb;
 IF body->'play' IS DISTINCT FROM jsonb_build_object('play',expected,'snapshot',p.snapshot_text::jsonb) OR body->'answers' IS DISTINCT FROM s.answers_text::jsonb->'answers' OR body->'progress' IS DISTINCT FROM s.progress_text::jsonb->'progress' THEN RAISE EXCEPTION 'CONSUMER_REPORT_SOURCE_MISMATCH' USING ERRCODE='23514'; END IF;
 is_v2:=qf.consumer_protocol_v2(NEW.product_id,NEW.play_version_id,NEW.play_snapshot_sha256::text);
 IF is_v2 IS NULL THEN RAISE EXCEPTION 'CONSUMER_PROTOCOL_MISMATCH' USING ERRCODE='23514'; END IF;
 IF NOT is_v2 THEN
  IF NEW.matching_context_sha256 IS NOT NULL OR s.matching_context_text IS NOT NULL OR s.matching_context_sha256 IS NOT NULL THEN RAISE EXCEPTION 'CONSUMER_PROTOCOL_MISMATCH' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (NEW.matching_context_sha256 IS NOT NULL AND s.matching_context_text IS NOT NULL AND s.matching_context_sha256 IS NOT NULL AND NEW.matching_context_sha256=s.matching_context_sha256 AND s.matching_context_text<>'null' AND qf.consumer_canonical(body->'matchingContext')=s.matching_context_text) IS NOT TRUE THEN RAISE EXCEPTION 'CONSUMER_REPORT_CONTEXT_MISMATCH' USING ERRCODE='23514'; END IF;
 SELECT * INTO k FROM qf.access_key WHERE id=NEW.key_id;
 IF k.revoked_at IS NOT NULL OR k.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CONSUMER_REPORT_DEADLINE' USING ERRCODE='23514'; END IF;
 SELECT d.canonical_content_text::jsonb INTO source FROM qf.product_version v JOIN qf.draft_revision d ON(d.product_id,d.draft_id,d.revision)=(v.product_id,v.draft_id,v.revision) WHERE (v.id,v.product_id,v.snapshot_sha256)=(p.parent_version_id,p.product_id,p.parent_snapshot_sha256);
 IF (source->>'schemaVersion'='quizpack-content.v3' AND qf.sha256_utf8(qf.consumer_canonical(source))=p.snapshot_text::jsonb#>>'{parentSnapshot,target,canonicalContentSha256}') IS NOT TRUE THEN RAISE EXCEPTION 'CONSUMER_REPORT_SOURCE_MISMATCH' USING ERRCODE='23514'; END IF;
 score:=body#>'{score,score}';display:=body#>'{view,display}';
 SELECT jsonb_agg(a ORDER BY n) INTO normalized FROM jsonb_array_elements(source#>'{core,questions}') WITH ORDINALITY question(q,n) JOIN LATERAL jsonb_array_elements(s.answers_text::jsonb->'answers') a ON a->>'questionId'=q#>>'{ref,id}';
 IF (jsonb_array_length(normalized)=jsonb_array_length(source#>'{core,questions}') AND normalized=score->'normalizedAnswers'
  AND score->>'logicHash'=qf.sha256_utf8(E'quizforge:quiz-logic.v2\n'||qf.consumer_canonical(source#>'{core,scoringDefinition}'))
  AND body#>'{matchingContext,policyRef}'=source#>'{core,scoringDefinition,matchingPolicy,ref}'
  AND EXISTS(SELECT 1 FROM jsonb_array_elements(source#>'{core,scoringDefinition,profiles}') profile WHERE profile->'resultRef'=score#>'{decision,selectedResultRef}' AND (body#>>'{matchingContext,preference}'='any' OR body#>>'{matchingContext,preference}'=profile->>'sex') AND profile->'kind' IN (SELECT value FROM jsonb_array_elements(source#>'{core,scoringDefinition,matchingPolicy,allowedKinds}')))) IS NOT TRUE THEN RAISE EXCEPTION 'CONSUMER_REPORT_INPUT_MISMATCH' USING ERRCODE='23514'; END IF;
 expected_body:=qf.composed_body_v1(source,body->'score');
 IF expected_body IS NULL OR display->'body' IS DISTINCT FROM expected_body THEN RAISE EXCEPTION 'CONSUMER_REPORT_BODY_SOURCE_MISMATCH' USING ERRCODE='23514'; END IF;
 SELECT c INTO chosen_character FROM jsonb_array_elements(source#>'{bindings,slots,characters}') c WHERE c->'resultRef'=score#>'{decision,selectedResultRef}';
 IF chosen_character IS NULL OR display->'slots' IS DISTINCT FROM jsonb_build_object('neutral',source#>'{bindings,slots,neutral}','character',chosen_character) OR display->'assets' IS DISTINCT FROM qf.composed_assets_v1(source,chosen_character) THEN RAISE EXCEPTION 'CONSUMER_REPORT_RESOURCE_SCOPE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
