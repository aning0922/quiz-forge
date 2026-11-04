-- Batch B slice 1: controlled writes. Requires reviewed 0030; not independently deployable.
DO $pre$ DECLARE actual text; BEGIN
 IF NOT pg_try_advisory_xact_lock(72461,2) THEN RAISE EXCEPTION 'CONSUMER_IO_PRESENT' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename=replace(current_user,'qf_owner_','qf_app_') AND pid<>pg_backend_pid()) THEN RAISE EXCEPTION 'CONSUMER_WRITERS_PRESENT' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM qf_meta.schema_migrations WHERE version='0030_consumer_latest_attempts' AND checksum='c6009e5ebbda4107b63aa475e8434a8b0a6af87cc42627ca03759987adc65db3') THEN RAISE EXCEPTION 'CONSUMER_PREVIOUS_SCHEMA_MISMATCH' USING ERRCODE='55000'; END IF;
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
 IF actual IS DISTINCT FROM '3b19480ff84e3b7300f893e081ca4bead8fb50a4e3cdaf06f1c6985c8a9b5b01' THEN RAISE EXCEPTION 'CONSUMER_PREVIOUS_SCHEMA_MISMATCH' USING ERRCODE='55000'; END IF;
END $pre$;
LOCK TABLE qf.access_key,qf.consumer_session,qf.consumer_grant,qf.quiz_report,qf.consumer_product_activation,qf.consumer_product_head IN SHARE ROW EXCLUSIVE MODE NOWAIT;

CREATE FUNCTION qf.consumer_service_lineage(k qf.access_key,s qf.consumer_session) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF ROW(s.key_id,s.product_id,s.key_bound_play_version_id,s.key_bound_play_snapshot_sha256) IS DISTINCT FROM ROW(k.id,k.product_id,k.play_version_id,k.play_snapshot_sha256)
 OR NOT EXISTS(SELECT 1 FROM qf.internal_play_version WHERE (id,product_id,snapshot_sha256)=(s.play_version_id,s.product_id,s.play_snapshot_sha256))
 OR (s.activation_generation>0 AND NOT EXISTS(SELECT 1 FROM qf.consumer_product_activation WHERE (product_id,generation,play_version_id,play_snapshot_sha256)=(s.product_id,s.activation_generation,s.play_version_id,s.play_snapshot_sha256)))
 THEN RAISE EXCEPTION 'CONSUMER_AUTHORITY_MISMATCH' USING ERRCODE='23514'; END IF;
END $$;

-- Private helper. The expired flag is NOT granted to app and is true only in revoke.
CREATE FUNCTION qf.consumer_service_authority(p_product text,p_key uuid,p_session uuid,p_grant uuid,p_digest text,p_expired boolean) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h qf.consumer_product_head; k qf.access_key; s qf.consumer_session; g qf.consumer_grant;
BEGIN
 h:=qf.consumer_policy_scope(p_product);
 SELECT * INTO k FROM qf.access_key WHERE id=p_key AND product_id=p_product FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONSUMER_ACCESS_DENIED' USING ERRCODE='23514'; END IF;
 SELECT * INTO s FROM qf.consumer_session WHERE id=p_session AND key_id=p_key AND product_id=p_product FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONSUMER_ACCESS_DENIED' USING ERRCODE='23514'; END IF;
 PERFORM qf.consumer_service_lineage(k,s);
 SELECT * INTO g FROM qf.consumer_grant WHERE key_id=p_key AND session_id=p_session AND grant_id=p_grant AND credential_digest=p_digest FOR UPDATE NOWAIT;
 IF NOT FOUND OR (NOT p_expired AND (g.revoked_at IS NOT NULL OR g.expires_at<=clock_timestamp() OR k.revoked_at IS NOT NULL)) THEN RAISE EXCEPTION 'CONSUMER_ACCESS_DENIED' USING ERRCODE='23514'; END IF;
 RETURN jsonb_build_object('head',CASE WHEN h.product_id IS NULL THEN NULL ELSE to_jsonb(h) END,'key',to_jsonb(k),'session',to_jsonb(s),'grant',to_jsonb(g));
END $$;
CREATE FUNCTION qf.consumer_lock_authority(p_product text,p_key uuid,p_session uuid,p_grant uuid,p_digest text) RETURNS jsonb LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT qf.consumer_service_authority(p_product,p_key,p_session,p_grant,p_digest,false)
$$;

CREATE FUNCTION qf.consumer_save_attempt(p_product text,p_key uuid,p_session uuid,p_grant uuid,p_digest text,p_expected integer,p_binding text,p_answers text,p_progress text,p_context text) RETURNS qf.consumer_session LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE authority jsonb; s qf.consumer_session; g qf.consumer_grant; k qf.access_key; receipt text; at timestamptz; b jsonb;
BEGIN
 authority:=qf.consumer_lock_authority(p_product,p_key,p_session,p_grant,p_digest);
 SELECT * INTO s FROM qf.consumer_session WHERE id=p_session;
 SELECT * INTO k FROM qf.access_key WHERE id=p_key;
 SELECT * INTO g FROM qf.consumer_grant WHERE grant_id=p_grant;
 b:=p_binding::jsonb;
 IF qf.consumer_body_valid(p_answers,'answers',65536) IS NOT TRUE OR qf.consumer_body_valid(p_progress,'progress',4096) IS NOT TRUE
 OR (CASE WHEN s.matching_context_text IS NULL THEN qf.consumer_body_valid(p_binding,'save',4096) ELSE qf.consumer_body_valid_v2(p_binding,'save',4096) END) IS NOT TRUE
 OR b->'session' IS DISTINCT FROM jsonb_build_object('productId',s.product_id,'playVersionId',s.play_version_id,'playSnapshotSha256',s.play_snapshot_sha256::text,'keyId',s.key_id,'sessionId',s.id)
 OR b->>'expectedStateRevision' IS DISTINCT FROM p_expected::text
 OR b->>'consumerStateAnswersSha256' IS DISTINCT FROM qf.sha256_utf8(p_answers)
 OR b->>'progressSha256' IS DISTINCT FROM qf.sha256_utf8(p_progress)
 OR (s.matching_context_text IS NULL AND p_context IS NOT NULL)
 OR (s.matching_context_text IS NOT NULL AND (p_context IS NULL OR qf.consumer_body_valid_v2(p_context,'context',4096) IS NOT TRUE OR b->>'matchingContextSha256' IS DISTINCT FROM qf.sha256_utf8(E'quizforge:quiz-matching-context.v1\n'||p_context)))
 THEN RAISE EXCEPTION 'CONSUMER_INVALID_INPUT' USING ERRCODE='23514'; END IF;
 -- Original exact receipt wins over expiry/head, but only after valid read authority.
 IF s.last_binding_text=p_binding AND s.state_revision::bigint=p_expected::bigint+1 THEN RETURN s; END IF;
 PERFORM qf.consumer_policy_attempt(p_product,p_key,p_session,s.play_version_id,s.play_snapshot_sha256::text,s.activation_generation);
 IF s.state_revision IS DISTINCT FROM p_expected THEN RAISE EXCEPTION 'CONSUMER_STATE_CONFLICT' USING ERRCODE='23514'; END IF;
 at:=date_trunc('milliseconds',clock_timestamp());
 receipt:=qf.consumer_canonical(jsonb_build_object('schemaVersion',CASE WHEN s.matching_context_text IS NULL THEN 'quizforge.consumer-save-receipt.v1' ELSE 'quizforge.consumer-save-receipt.v2' END,
 'binding',p_binding::jsonb,'bindingSha256',qf.sha256_utf8(p_binding),'appliedStateRevision',p_expected::bigint+1,'savedAt',qf.consumer_moment(at)));
 UPDATE qf.consumer_session SET state_revision=p_expected+1,answers_text=p_answers,consumer_state_answers_sha256=qf.sha256_utf8(p_answers),progress_text=p_progress,progress_sha256=qf.sha256_utf8(p_progress),
 matching_context_text=p_context,matching_context_sha256=CASE WHEN p_context IS NULL THEN NULL ELSE qf.sha256_utf8(E'quizforge:quiz-matching-context.v1\n'||p_context) END,
 last_binding_text=p_binding,last_binding_sha256=qf.sha256_utf8(p_binding),last_receipt_text=receipt,last_receipt_sha256=qf.sha256_utf8(receipt)
 WHERE id=p_session AND key_id=p_key AND state_revision=p_expected AND k.expires_at>clock_timestamp() AND g.expires_at>clock_timestamp() RETURNING * INTO s;
 IF NOT FOUND OR k.expires_at<=clock_timestamp() OR g.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CONSUMER_MUTATION_DEADLINE' USING ERRCODE='23514'; END IF;
 RETURN s;
END $$;

CREATE FUNCTION qf.consumer_complete_attempt(p_row qf.quiz_report,p_grant uuid,p_digest text) RETURNS qf.quiz_report LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE authority jsonb; s qf.consumer_session; g qf.consumer_grant; k qf.access_key; result qf.quiz_report;
BEGIN
 authority:=qf.consumer_lock_authority(p_row.product_id,p_row.key_id,p_row.session_id,p_grant,p_digest);
 SELECT * INTO s FROM qf.consumer_session WHERE id=p_row.session_id;
 IF ROW(s.product_id,s.play_version_id,s.play_snapshot_sha256) IS DISTINCT FROM ROW(p_row.product_id,p_row.play_version_id,p_row.play_snapshot_sha256)
 OR qf.consumer_report_valid(p_row) IS NOT TRUE THEN RAISE EXCEPTION 'CONSUMER_INVALID_INPUT' USING ERRCODE='23514'; END IF;
 SELECT * INTO result FROM qf.quiz_report WHERE key_id=p_row.key_id;
 IF FOUND THEN
  IF result.session_id=p_row.session_id AND result.binding_text=p_row.binding_text THEN RETURN result; END IF;
  RAISE EXCEPTION 'CONSUMER_KEY_COMPLETED' USING ERRCODE='23514';
 END IF;
 SELECT * INTO s FROM qf.consumer_session WHERE id=p_row.session_id;
 SELECT * INTO g FROM qf.consumer_grant WHERE grant_id=p_grant;
 SELECT * INTO k FROM qf.access_key WHERE id=p_row.key_id;
 PERFORM qf.consumer_policy_attempt(p_row.product_id,p_row.key_id,p_row.session_id,p_row.play_version_id,p_row.play_snapshot_sha256::text,s.activation_generation);
 IF s.state_revision<>p_row.state_revision THEN RAISE EXCEPTION 'CONSUMER_STATE_CONFLICT' USING ERRCODE='23514'; END IF;
 IF g.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CONSUMER_MUTATION_DEADLINE' USING ERRCODE='23514'; END IF;
 INSERT INTO qf.quiz_report SELECT (p_row).* RETURNING * INTO result;
 IF k.expires_at<=clock_timestamp() OR g.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CONSUMER_MUTATION_DEADLINE' USING ERRCODE='23514'; END IF;
 RETURN result;
END $$;

CREATE FUNCTION qf.consumer_rotate_grant(p_product text,p_key uuid,p_key_digest text,p_session uuid,p_fresh uuid,p_fresh_digest text) RETURNS qf.consumer_grant LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h qf.consumer_product_head; k qf.access_key; target qf.consumer_session; old qf.consumer_grant; result qf.consumer_grant; chosen integer; report_session uuid;
BEGIN
 h:=qf.consumer_policy_scope(p_product);
 SELECT * INTO k FROM qf.access_key WHERE id=p_key AND product_id=p_product AND credential_digest=p_key_digest FOR UPDATE NOWAIT;
 IF NOT FOUND OR k.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'CONSUMER_ACCESS_DENIED' USING ERRCODE='23514'; END IF;
 -- Select slot and BOTH session identities while Key is locked, before any session lock.
 SELECT slot INTO chosen FROM qf.consumer_grant WHERE key_id=p_key AND (revoked_at IS NOT NULL OR expires_at<=clock_timestamp()) ORDER BY slot LIMIT 1;
 IF chosen IS NULL THEN SELECT n INTO chosen FROM generate_series(1,16) n WHERE NOT EXISTS(SELECT 1 FROM qf.consumer_grant WHERE key_id=p_key AND slot=n) ORDER BY n LIMIT 1; END IF;
 IF chosen IS NULL THEN SELECT slot INTO chosen FROM qf.consumer_grant WHERE key_id=p_key ORDER BY issued_at,slot LIMIT 1; END IF;
 SELECT * INTO old FROM qf.consumer_grant WHERE key_id=p_key AND slot=chosen;
 PERFORM 1 FROM qf.consumer_session WHERE key_id=p_key AND id=ANY(ARRAY[p_session,old.session_id]) ORDER BY id FOR UPDATE NOWAIT;
 SELECT * INTO target FROM qf.consumer_session WHERE id=p_session AND key_id=p_key;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONSUMER_ACCESS_DENIED' USING ERRCODE='23514'; END IF;
 PERFORM qf.consumer_service_lineage(k,target);
 SELECT session_id INTO report_session FROM qf.quiz_report WHERE key_id=p_key;
 IF report_session IS NOT NULL THEN
  IF report_session<>p_session THEN RAISE EXCEPTION 'CONSUMER_KEY_COMPLETED' USING ERRCODE='23514'; END IF;
 ELSE
  PERFORM qf.consumer_policy_attempt(p_product,p_key,p_session,target.play_version_id,target.play_snapshot_sha256::text,target.activation_generation);
 END IF;
 IF old.key_id IS NOT NULL THEN
  PERFORM 1 FROM qf.consumer_grant WHERE key_id=p_key AND slot=chosen AND grant_id=old.grant_id AND credential_digest=old.credential_digest FOR UPDATE NOWAIT;
  IF NOT FOUND OR p_fresh=old.grant_id OR p_fresh_digest=old.credential_digest THEN RAISE EXCEPTION 'CONSUMER_GRANT_ROTATION' USING ERRCODE='23514'; END IF;
  UPDATE qf.consumer_grant SET session_id=p_session,grant_id=p_fresh,credential_digest=p_fresh_digest,issued_at=clock_timestamp(),expires_at=clock_timestamp(),revoked_at=NULL WHERE key_id=p_key AND slot=chosen RETURNING * INTO result;
 ELSE
  INSERT INTO qf.consumer_grant(key_id,slot,session_id,grant_id,credential_digest,issued_at,expires_at) VALUES(p_key,chosen,p_session,p_fresh,p_fresh_digest,clock_timestamp(),clock_timestamp()) RETURNING * INTO result;
 END IF;
 RETURN result;
END $$;
-- Atomic raw-Key exchange avoids locking the target before planning rotation.
CREATE FUNCTION qf.consumer_exchange_attempt(p_product text,p_key_digest text,p_fresh uuid,p_fresh_digest text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE h qf.consumer_product_head; k qf.access_key; target qf.consumer_session; prior qf.consumer_grant; issued qf.consumer_grant; chosen integer; target_id uuid; historical uuid; is_v2 boolean; answers text; progress text;
BEGIN
 h:=qf.consumer_policy_scope(p_product);
 SELECT * INTO k FROM qf.access_key WHERE product_id=p_product AND credential_digest=p_key_digest FOR UPDATE NOWAIT;
 IF NOT FOUND OR k.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'CONSUMER_ACCESS_DENIED' USING ERRCODE='23514'; END IF;
 SELECT session_id INTO historical FROM qf.quiz_report WHERE key_id=k.id;
 IF historical IS NOT NULL THEN
  target_id:=historical;
 ELSE
  IF k.expires_at<=clock_timestamp() THEN RAISE EXCEPTION 'CONSUMER_KEY_NOT_ACTIVE' USING ERRCODE='23514'; END IF;
  IF h.product_id IS NULL THEN RAISE EXCEPTION 'CONSUMER_NO_ENABLED_PLAY' USING ERRCODE='23514'; END IF;
  SELECT id INTO target_id FROM qf.consumer_session WHERE key_id=k.id AND activation_generation=h.generation AND product_id=p_product AND play_version_id=h.play_version_id AND play_snapshot_sha256=h.play_snapshot_sha256;
  target_id:=coalesce(target_id,gen_random_uuid());
 END IF;
 -- Key serializes this plan with every grant mutation. No target row lock yet.
 SELECT slot INTO chosen FROM qf.consumer_grant WHERE key_id=k.id AND (revoked_at IS NOT NULL OR expires_at<=clock_timestamp()) ORDER BY slot LIMIT 1;
 IF chosen IS NULL THEN SELECT n INTO chosen FROM generate_series(1,16) n WHERE NOT EXISTS(SELECT 1 FROM qf.consumer_grant WHERE key_id=k.id AND slot=n) ORDER BY n LIMIT 1; END IF;
 IF chosen IS NULL THEN SELECT slot INTO chosen FROM qf.consumer_grant WHERE key_id=k.id ORDER BY issued_at,slot LIMIT 1; END IF;
 SELECT * INTO prior FROM qf.consumer_grant WHERE key_id=k.id AND slot=chosen;
 PERFORM 1 FROM qf.consumer_session WHERE key_id=k.id AND id=ANY(ARRAY[target_id,prior.session_id]) ORDER BY id FOR UPDATE NOWAIT;
 SELECT * INTO target FROM qf.consumer_session WHERE key_id=k.id AND id=target_id;
 IF NOT FOUND THEN
  IF historical IS NOT NULL THEN RAISE EXCEPTION 'CONSUMER_AUTHORITY_MISMATCH' USING ERRCODE='23514'; END IF;
  -- New row is private until commit; all existing session locks precede creation.
  is_v2:=qf.consumer_protocol_v2(p_product,h.play_version_id,h.play_snapshot_sha256::text);
  IF is_v2 IS NULL THEN RAISE EXCEPTION 'CONSUMER_PROTOCOL_MISMATCH' USING ERRCODE='23514'; END IF;
  answers:=qf.consumer_canonical(jsonb_build_object('schemaVersion','quizforge.consumer-state-answers.v1','answers','[]'::jsonb));
  progress:=qf.consumer_canonical(jsonb_build_object('schemaVersion','quizforge.consumer-state-progress.v1','progress',jsonb_build_object('questionId',NULL)));
  INSERT INTO qf.consumer_session(id,key_id,product_id,play_version_id,play_snapshot_sha256,created_at,state_revision,answers_text,consumer_state_answers_sha256,progress_text,progress_sha256,matching_context_text,matching_context_sha256,activation_generation,issued_play_version_id,issued_play_snapshot_sha256)
  VALUES(target_id,k.id,p_product,h.play_version_id,h.play_snapshot_sha256,date_trunc('milliseconds',clock_timestamp()),0,answers,qf.sha256_utf8(answers),progress,qf.sha256_utf8(progress),CASE WHEN is_v2 THEN 'null' ELSE NULL END,CASE WHEN is_v2 THEN qf.sha256_utf8(E'quizforge:quiz-matching-context.v1\nnull') ELSE NULL END,h.generation,k.play_version_id,k.play_snapshot_sha256) RETURNING * INTO target;
 END IF;
 PERFORM qf.consumer_service_lineage(k,target);
 -- Never re-plan after session locks: a clock boundary may expire another slot.
 IF historical IS NULL THEN PERFORM qf.consumer_policy_attempt(p_product,k.id,target_id,target.play_version_id,target.play_snapshot_sha256::text,target.activation_generation); END IF;
 IF prior.key_id IS NOT NULL THEN
  PERFORM 1 FROM qf.consumer_grant WHERE key_id=k.id AND slot=chosen AND grant_id=prior.grant_id AND credential_digest=prior.credential_digest FOR UPDATE NOWAIT;
  IF NOT FOUND THEN RAISE EXCEPTION 'CONSUMER_GRANT_ROTATION' USING ERRCODE='23514'; END IF;
  UPDATE qf.consumer_grant SET session_id=target_id,grant_id=p_fresh,credential_digest=p_fresh_digest,issued_at=clock_timestamp(),expires_at=clock_timestamp(),revoked_at=NULL WHERE key_id=k.id AND slot=chosen RETURNING * INTO issued;
 ELSE
  INSERT INTO qf.consumer_grant(key_id,slot,session_id,grant_id,credential_digest,issued_at,expires_at) VALUES(k.id,chosen,target_id,p_fresh,p_fresh_digest,clock_timestamp(),clock_timestamp()) RETURNING * INTO issued;
 END IF;
 RETURN jsonb_build_object('session',to_jsonb(target),'grant',to_jsonb(issued),'destination',CASE WHEN historical IS NULL THEN 'play' ELSE 'report' END);
END $$;
CREATE FUNCTION qf.consumer_revoke_grant(p_product text,p_key uuid,p_session uuid,p_grant uuid,p_digest text) RETURNS qf.consumer_grant LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE authority jsonb; result qf.consumer_grant;
BEGIN
 authority:=qf.consumer_service_authority(p_product,p_key,p_session,p_grant,p_digest,true);
 SELECT * INTO result FROM qf.consumer_grant WHERE key_id=p_key AND session_id=p_session AND grant_id=p_grant AND credential_digest=p_digest;
 IF result.revoked_at IS NULL THEN UPDATE qf.consumer_grant SET revoked_at=clock_timestamp() WHERE key_id=p_key AND session_id=p_session AND grant_id=p_grant AND credential_digest=p_digest RETURNING * INTO result; END IF;
 RETURN result;
END $$;

-- Auth advisory precedes all domain locks. No caller-supplied actor identity.
-- Private capability selector: public mutators pass fixed literals, never request mode.
CREATE FUNCTION qf.consumer_service_operator(p_digest text,p_capability text) RETURNS qf.operator_session LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE auth qf.operator_session; actor_role text;
BEGIN
 PERFORM pg_advisory_xact_lock(72461,1);
 -- Same eligibility as account APIs: set password, complete identity, revision,
 -- active operator and currently valid authenticated session are all required.
 auth:=qf.account_actor(p_digest);
 IF auth.id IS NULL THEN RAISE EXCEPTION 'CONSUMER_OPERATOR_REQUIRED' USING ERRCODE='23514'; END IF;
 SELECT role::text INTO actor_role FROM qf.operator WHERE id=auth.operator_id;
 -- Mirrors role-policy.ts for these two fixed capabilities only. Unknown denies.
 IF (CASE p_capability
  WHEN 'version:seal-internal' THEN actor_role='admin'
  WHEN 'access-key:void' THEN actor_role IN ('admin','operator')
  ELSE false END) IS NOT TRUE
 THEN RAISE EXCEPTION 'CONSUMER_CAPABILITY_DENIED' USING ERRCODE='23514'; END IF;
 RETURN auth;
END $$;
CREATE FUNCTION qf.consumer_activate_product(p_binding text,p_operator_digest text,p_request uuid) RETURNS qf.consumer_product_activation LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb; h qf.consumer_product_head; auth qf.operator_session; old qf.consumer_product_activation; result qf.consumer_product_activation; product text;
BEGIN
 auth:=qf.consumer_service_operator(p_operator_digest,'version:seal-internal');
 b:=p_binding::jsonb;product:=b->>'productId';
 IF NOT pg_try_advisory_xact_lock_shared(72461,2) THEN RAISE EXCEPTION 'CONSUMER_MAINTENANCE_BUSY' USING ERRCODE='55P03'; END IF;
 PERFORM 1 FROM qf.product WHERE id=product FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONSUMER_PRODUCT_MISSING' USING ERRCODE='23514'; END IF;
 SELECT * INTO h FROM qf.consumer_product_head WHERE product_id=product FOR UPDATE NOWAIT;
 PERFORM 1 FROM qf.operator WHERE id=auth.operator_id FOR SHARE NOWAIT;
 PERFORM 1 FROM qf.operator_session WHERE id=auth.id FOR SHARE NOWAIT;
 auth:=qf.consumer_service_operator(p_operator_digest,'version:seal-internal');
 SELECT * INTO old FROM qf.consumer_product_activation WHERE product_id=product AND operation_key=(b->>'operationKey')::uuid;
 IF FOUND THEN
  IF old.binding_text IS DISTINCT FROM p_binding THEN RAISE EXCEPTION 'CONSUMER_OPERATION_CONFLICT' USING ERRCODE='23514'; END IF;
  RETURN old;
 END IF;
 IF h.product_id IS NOT NULL AND ROW(h.play_version_id::text,h.play_snapshot_sha256::text)=ROW(b->>'playVersionId',b->>'playSnapshotSha256') THEN RAISE EXCEPTION 'CONSUMER_ACTIVATION_CONFLICT' USING ERRCODE='23514'; END IF;
 INSERT INTO qf.consumer_product_activation(id,product_id,operation_key,expected_generation,generation,play_version_id,play_snapshot_sha256,binding_text,binding_sha256,activated_by,operator_session_id,request_id,activated_at,receipt_text,receipt_sha256)
 VALUES(gen_random_uuid(),product,(b->>'operationKey')::uuid,(b->>'expectedGeneration')::integer,(b->>'expectedGeneration')::integer+1,(b->>'playVersionId')::uuid,b->>'playSnapshotSha256',p_binding,qf.sha256_utf8(p_binding),auth.operator_id,auth.id,p_request,clock_timestamp(),'','') RETURNING * INTO result;
 RETURN result;
END $$;
CREATE FUNCTION qf.consumer_void_unused_key(p_product text,p_key uuid,p_binding text,p_operator_digest text) RETURNS qf.access_key LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE auth qf.operator_session; k qf.access_key; b jsonb;
BEGIN
 auth:=qf.consumer_service_operator(p_operator_digest,'access-key:void');
 PERFORM qf.consumer_policy_scope(p_product);
 SELECT * INTO k FROM qf.access_key WHERE id=p_key AND product_id=p_product FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONSUMER_ACCESS_DENIED' USING ERRCODE='23514'; END IF;
 PERFORM 1 FROM qf.operator WHERE id=auth.operator_id FOR SHARE NOWAIT;
 PERFORM 1 FROM qf.operator_session WHERE id=auth.id FOR SHARE NOWAIT;
 auth:=qf.consumer_service_operator(p_operator_digest,'access-key:void');
 IF k.void_binding_text=p_binding THEN RETURN k; END IF;
 b:=p_binding::jsonb;
 UPDATE qf.access_key SET revoked_at=clock_timestamp(),void_operation_key=(b->>'operationKey')::uuid,void_binding_text=p_binding,void_binding_sha256=qf.sha256_utf8(p_binding),voided_by=auth.operator_id WHERE id=p_key RETURNING * INTO k;
 RETURN k;
END $$;

REVOKE ALL ON FUNCTION qf.consumer_service_lineage(qf.access_key,qf.consumer_session),qf.consumer_service_authority(text,uuid,uuid,uuid,text,boolean),qf.consumer_lock_authority(text,uuid,uuid,uuid,text),qf.consumer_save_attempt(text,uuid,uuid,uuid,text,integer,text,text,text,text),qf.consumer_complete_attempt(qf.quiz_report,uuid,text),qf.consumer_rotate_grant(text,uuid,text,uuid,uuid,text),qf.consumer_revoke_grant(text,uuid,uuid,uuid,text),qf.consumer_service_operator(text,text),qf.consumer_activate_product(text,text,uuid),qf.consumer_void_unused_key(text,uuid,text,text) FROM PUBLIC;

REVOKE ALL ON FUNCTION qf.consumer_exchange_attempt(text,text,uuid,text) FROM PUBLIC;
