-- Current password accounts only. Historical migrations/checksums remain immutable.
-- This transaction rejects incomplete identities instead of manufacturing or enrolling them.
LOCK TABLE qf.operator,qf.operator_session,qf.operator_account_operation,qf.audit_event IN SHARE ROW EXCLUSIVE MODE NOWAIT;
DO $identity$ BEGIN
 IF EXISTS(SELECT 1 FROM qf.operator WHERE
  login_name IS NULL OR login_name !~ '^[a-z0-9][a-z0-9._-]{2,63}$'
  OR display_name IS NULL OR char_length(display_name) NOT BETWEEN 1 AND 80
  OR display_name ~ '[[:cntrl:]<>]' OR display_name ~ U&'[\007F-\009F]' OR display_name<>btrim(display_name,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')
  OR role IS NULL OR role::text NOT IN('admin','operator','read-only')
  OR account_revision IS NULL OR account_revision NOT BETWEEN 1 AND 2147483647
  OR credential_digest IS NOT NULL) THEN RAISE EXCEPTION 'ACCOUNT_IDENTITY_INVALID'; END IF;
END $identity$;
ALTER TABLE qf.operator ALTER COLUMN login_name SET NOT NULL, ALTER COLUMN display_name SET NOT NULL;
ALTER TABLE qf.operator DROP CONSTRAINT operator_account_pair, DROP CONSTRAINT operator_display_name;
ALTER TABLE qf.operator ADD CONSTRAINT operator_display_name CHECK((char_length(display_name) BETWEEN 1 AND 80 AND display_name !~ '[[:cntrl:]<>]' AND display_name !~ U&'[\007F-\009F]' AND display_name=btrim(display_name,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) IS TRUE);
ALTER TABLE qf.operator_account_operation ADD COLUMN local_result jsonb;
ALTER TABLE qf.operator_account_operation ADD CONSTRAINT account_local_result_shape CHECK(local_result IS NULL OR (
 actor_id IS NULL AND action IN('bootstrap-admin','admin-recovery','disable','restore')
 AND jsonb_typeof(local_result)='object'
 AND local_result ?& ARRAY['changed','previousRevision','resultingRevision','resultingStatus']
 AND local_result-ARRAY['changed','previousRevision','resultingRevision','resultingStatus']='{}'::jsonb
 AND jsonb_typeof(local_result->'changed')='boolean'
 AND (local_result->'previousRevision'='null'::jsonb OR (jsonb_typeof(local_result->'previousRevision')='number' AND (local_result->>'previousRevision')::numeric BETWEEN 1 AND 2147483647 AND (local_result->>'previousRevision')::numeric=trunc((local_result->>'previousRevision')::numeric)))
 AND jsonb_typeof(local_result->'resultingRevision')='number'
 AND (local_result->>'resultingRevision')::numeric BETWEEN 1 AND 2147483647
 AND (local_result->>'resultingRevision')::numeric=trunc((local_result->>'resultingRevision')::numeric)
 AND local_result->>'resultingStatus' IN('pending','active','disabled')
 AND CASE WHEN action='bootstrap-admin' THEN
  local_result->'previousRevision'='null'::jsonb AND local_result->'changed'='true'::jsonb
  AND local_result->'resultingRevision'='1'::jsonb AND local_result->>'resultingStatus'='pending' AND status='completed'
 ELSE jsonb_typeof(local_result->'previousRevision')='number'
  AND (local_result->>'resultingRevision')::numeric=(local_result->>'previousRevision')::numeric+CASE WHEN local_result->'changed'='true'::jsonb THEN 1 ELSE 0 END
  AND (status='completed' OR local_result->'changed'='false'::jsonb)
  AND (status='rejected' OR (local_result->>'previousRevision')::numeric=(binding->>'expectedRevision')::numeric)
 END
) IS TRUE);

-- Only current eligible sessions are returned; no touch and no PHC leaves this function.
CREATE OR REPLACE FUNCTION qf.account_actor(digest text) RETURNS qf.operator_session
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT s FROM qf.operator_session s JOIN qf.operator o ON o.id=s.operator_id
 WHERE s.token_digest=digest AND s.kind='authenticated' AND s.revoked_at IS NULL
  AND o.status='active' AND o.password_hash IS NOT NULL
  AND o.login_name IS NOT NULL AND o.display_name IS NOT NULL
  AND o.account_revision BETWEEN 1 AND 2147483647
  AND s.idle_expires_at>clock_timestamp() AND s.absolute_expires_at>clock_timestamp()
$$;
REVOKE ALL ON FUNCTION qf.account_actor(text) FROM PUBLIC;

CREATE OR REPLACE FUNCTION qf.account_dto(o qf.operator) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',o.id,'loginName',o.login_name,'displayName',o.display_name,'role',o.role,'status',CASE WHEN o.status='disabled' THEN 'disabled' WHEN o.password_hash IS NULL THEN 'pending' ELSE 'active' END,'revision',o.account_revision,'createdAt',qf.consumer_moment(date_trunc('milliseconds',o.created_at)),'disabledAt',CASE WHEN o.disabled_at IS NULL THEN NULL ELSE qf.consumer_moment(date_trunc('milliseconds',o.disabled_at)) END)
$$;

CREATE OR REPLACE FUNCTION qf.account_command(mode text,digest text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s qf.operator_session; actor qf.operator; target qf.operator; old qf.operator_account_operation;
 op uuid; target_id uuid; action_name text; binding_value jsonb; answer jsonb; link jsonb;
 off integer; lim integer; desired qf.operator_role; at timestamptz;
BEGIN
 PERFORM pg_advisory_xact_lock(72461,1);
 s:=qf.account_actor(digest); IF s.id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
 SELECT * INTO actor FROM qf.operator WHERE id=s.operator_id;
 IF mode='me' THEN RETURN qf.account_dto(actor); END IF;
 IF mode='result' THEN
  SELECT * INTO old FROM qf.operator_account_operation WHERE operation_id=(p->>'operationId')::uuid;
  IF old.operation_id IS NULL OR (actor.role<>'admin' AND old.actor_id IS DISTINCT FROM actor.id) THEN RETURN jsonb_build_object('status','unknown','operationId',p->>'operationId'); END IF;
  RETURN jsonb_build_object('status','found','operation',qf.account_operation_dto(old));
 END IF;
 IF mode<>'mutate' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 op:=(p->>'operationId')::uuid;action_name:=p->>'action';target_id:=coalesce((p->>'targetId')::uuid,op);
 IF op IS NULL OR action_name IS NULL OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k<>ALL(ARRAY['operationId','action','targetId','expectedRevision','displayName','loginName','role','tokenId','tokenDigest'])) OR (action_name NOT IN('create','logout-all') AND (p->>'expectedRevision') IS NULL) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 binding_value:=p-ARRAY['tokenDigest','tokenId'];
 SELECT * INTO old FROM qf.operator_account_operation WHERE operation_id=op;
 IF old.operation_id IS NOT NULL THEN
  IF old.actor_id IS DISTINCT FROM actor.id OR old.binding<>binding_value THEN RAISE EXCEPTION 'OPERATION_BINDING_CONFLICT'; END IF;
  IF old.status='rejected' THEN RETURN jsonb_build_object('error',old.error_code,'operation',qf.account_operation_dto(old)); END IF;
  SELECT * INTO target FROM qf.operator WHERE id=old.target_id;
  RETURN jsonb_build_object('account',qf.account_dto(target),'operation',qf.account_operation_dto(old),'first',false);
 END IF;
 -- Freeze the actor/session state before target locks; wall-clock deadlines still require fresh checks.
 SELECT * INTO actor FROM qf.operator WHERE id=s.operator_id FOR UPDATE;
 SELECT * INTO s FROM qf.operator_session WHERE id=s.id FOR UPDATE;
 IF (qf.account_actor(digest)).id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
 IF action_name='logout-all' THEN target_id:=actor.id;
 ELSIF actor.role<>'admin' THEN RAISE EXCEPTION 'CAPABILITY_DENIED'; END IF;
 IF action_name='create' THEN
  desired:=(p->>'role')::qf.operator_role;
  IF (p->>'loginName') !~ '^[a-z0-9][a-z0-9._-]{2,63}$' OR char_length(p->>'displayName') NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF EXISTS(SELECT 1 FROM qf.operator WHERE login_name=p->>'loginName') THEN RAISE EXCEPTION 'LOGIN_NAME_TAKEN'; END IF;
  INSERT INTO qf.operator(id,role,status,login_name,display_name) VALUES(target_id,desired,'active',p->>'loginName',p->>'displayName');
  link:=qf.account_issue(target_id,'setup',p->>'tokenDigest',(p->>'tokenId')::uuid,actor.id,op);
 ELSE
  SELECT * INTO target FROM qf.operator WHERE id=target_id FOR UPDATE;
  IF (qf.account_actor(digest)).id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF target.id IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF action_name<>'logout-all' AND target.account_revision<>(p->>'expectedRevision')::integer THEN RETURN qf.account_record(op,actor.id,target_id,action_name,binding_value,NULL,'ACCOUNT_CONFLICT'); END IF;
  IF target.account_revision=2147483647 THEN RAISE EXCEPTION 'REVISION_LIMIT'; END IF;
  IF action_name IN('disable','role') AND target.role='admin' AND target.status='active' AND target.password_hash IS NOT NULL AND (action_name='disable' OR p->>'role'<>'admin') AND NOT EXISTS(SELECT 1 FROM qf.operator WHERE id<>target.id AND role='admin' AND status='active' AND password_hash IS NOT NULL) THEN
   RETURN qf.account_record(op,actor.id,target_id,action_name,binding_value,NULL,'LAST_ACTIVE_ADMIN');
  END IF;
  CASE action_name
   WHEN 'display-name' THEN UPDATE qf.operator SET display_name=p->>'displayName',account_revision=account_revision+1 WHERE id=target_id;
   WHEN 'role' THEN UPDATE qf.operator SET role=(p->>'role')::qf.operator_role,account_revision=account_revision+1 WHERE id=target_id;PERFORM qf.account_revoke(target_id);
   WHEN 'disable' THEN UPDATE qf.operator SET status='disabled',disabled_at=coalesce(disabled_at,clock_timestamp()),account_revision=account_revision+1 WHERE id=target_id;PERFORM qf.account_revoke(target_id);
   WHEN 'restore' THEN UPDATE qf.operator SET status='active',disabled_at=NULL,account_revision=account_revision+1 WHERE id=target_id;
   WHEN 'revoke-sessions','logout-all' THEN UPDATE qf.operator SET account_revision=account_revision+1 WHERE id=target_id;PERFORM qf.account_revoke(target_id);
   WHEN 'issue-setup','issue-reset' THEN
    IF target.status<>'active' OR (action_name='issue-setup' AND target.password_hash IS NOT NULL) OR(action_name='issue-reset' AND target.password_hash IS NULL) THEN RAISE EXCEPTION 'ACCOUNT_CONFLICT'; END IF;
    UPDATE qf.operator SET account_revision=account_revision+1 WHERE id=target_id;
    link:=qf.account_issue(target_id,CASE action_name WHEN 'issue-setup' THEN 'setup' ELSE 'reset' END,p->>'tokenDigest',(p->>'tokenId')::uuid,actor.id,op);
   ELSE RAISE EXCEPTION 'INVALID_REQUEST';
  END CASE;
 END IF;
 SELECT * INTO target FROM qf.operator WHERE id=target_id;
 answer:=qf.account_record(op,actor.id,target_id,action_name,binding_value);
 -- This check is after every potentially waiting write, including audit/receipt insertion.
 IF target_id=actor.id AND action_name IN('role','disable','revoke-sessions','logout-all') THEN
  SELECT * INTO s FROM qf.operator_session WHERE id=s.id;
  at:=clock_timestamp();
  IF s.revoked_at IS NULL OR s.idle_expires_at<=at OR s.absolute_expires_at<=at OR target.account_revision<>actor.account_revision+1 OR
    (action_name='disable' AND target.status<>'disabled') OR
    (action_name<>'disable' AND target.status<>'active') OR
    (action_name='role' AND target.role<>(p->>'role')::qf.operator_role) THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
 ELSE
  s:=qf.account_actor(digest);IF s.id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT * INTO actor FROM qf.operator WHERE id=s.operator_id;
  IF actor.role<>'admin' THEN RAISE EXCEPTION 'CAPABILITY_DENIED'; END IF;
 END IF;
 RETURN answer||jsonb_build_object('account',qf.account_dto(target),'passwordSetup',link,'first',true);
END $$;

CREATE OR REPLACE FUNCTION qf.account_password(mode text,digest text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s qf.operator_session;o qf.operator;t qf.operator_password_token;a qf.operator_kdf_attempt;r qf.operator_account_operation;
 aid uuid;op uuid;kind_name text;answer jsonb;at timestamptz;good boolean;new_session uuid;new_raw_digest text;rejection text;
BEGIN
 PERFORM pg_advisory_xact_lock(72461,1);at:=clock_timestamp();
 IF mode='setup-result' THEN
  SELECT * INTO t FROM qf.operator_password_token WHERE token_digest=digest;
  IF t.id IS NOT NULL AND at<=t.issued_at+interval '24 hours' THEN
   SELECT * INTO r FROM qf.operator_account_operation WHERE operation_id=(p->>'operationId')::uuid AND token_id=t.id AND target_id=t.operator_id AND action='password-setup';
   IF r.operation_id IS NOT NULL THEN RETURN jsonb_build_object('status','found','operation',qf.account_operation_dto(r)); END IF;
  END IF;
  RETURN jsonb_build_object('status','unknown','operationId',p->>'operationId');
 END IF;
 IF mode IN('inspect','reserve-setup','finish-setup') THEN
  SELECT * INTO t FROM qf.operator_password_token WHERE token_digest=digest FOR UPDATE;
  IF t.id IS NULL THEN RAISE EXCEPTION 'PASSWORD_TOKEN_INVALID'; END IF;
  SELECT * INTO o FROM qf.operator WHERE id=t.operator_id FOR UPDATE;
  at:=clock_timestamp();
  IF mode<>'finish-setup' AND (t.consumed_at IS NOT NULL OR t.revoked_at IS NOT NULL OR t.expires_at<=at OR o.status<>'active') THEN RAISE EXCEPTION 'PASSWORD_TOKEN_INVALID'; END IF;
  IF mode='inspect' THEN RETURN jsonb_build_object('tokenId',t.id,'purpose',t.purpose,'loginName',o.login_name,'displayName',o.display_name,'expiresAt',qf.consumer_moment(date_trunc('milliseconds',t.expires_at)),'passwordPolicy',jsonb_build_object('minCodePoints',15,'maxCodePoints',256)); END IF;
 ELSIF mode IN('reserve-change','finish-change') THEN
  IF mode='reserve-change' THEN s:=qf.account_actor(digest); ELSE SELECT * INTO s FROM qf.operator_session WHERE token_digest=digest AND kind='authenticated'; END IF;
  IF s.id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT * INTO o FROM qf.operator WHERE id=s.operator_id FOR UPDATE;
  SELECT * INTO s FROM qf.operator_session WHERE id=s.id FOR UPDATE;
  at:=clock_timestamp();
  IF mode='reserve-change' AND (qf.account_actor(digest)).id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF mode='reserve-change' AND o.password_hash IS NULL THEN RAISE EXCEPTION 'PASSWORD_CONFIRMATION_FAILED'; END IF;
 ELSIF mode IN('reserve-login','finish-login') THEN
  SELECT * INTO s FROM qf.operator_session WHERE token_digest=digest AND kind='preauth' FOR UPDATE;
  at:=clock_timestamp();
  IF s.id IS NULL OR s.revoked_at IS NOT NULL OR s.idle_expires_at<=at OR s.absolute_expires_at<=at THEN RAISE EXCEPTION 'AUTHENTICATION_FAILED'; END IF;
  IF mode='reserve-login' THEN SELECT * INTO o FROM qf.operator WHERE login_name=p->>'loginName' AND status='active' AND password_hash IS NOT NULL; END IF;
 ELSE RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF mode IN('reserve-login','reserve-setup','reserve-change') THEN
  at:=clock_timestamp();
  -- Reservations are not outcome receipts. All committed account outcomes remain in the append-only operation table.
  -- Only expired reservations beyond the entire original-result window may leave this bounded budget ledger.
  DELETE FROM qf.operator_kdf_attempt WHERE id IN (SELECT id FROM qf.operator_kdf_attempt WHERE expires_at<at-interval '24 hours' ORDER BY expires_at,id LIMIT 128);
  IF EXISTS(SELECT 1 FROM qf.operator_kdf_attempt OFFSET 29999 LIMIT 1) THEN RETURN jsonb_build_object('error','RATE_LIMITED'); END IF;
  IF (SELECT coalesce(sum(cost),0)+CASE WHEN mode='reserve-change' THEN 2 ELSE 1 END>20 FROM qf.operator_kdf_attempt WHERE created_at>at-interval '60 seconds') THEN RETURN jsonb_build_object('error','RATE_LIMITED'); END IF;
  IF mode='reserve-change' AND (SELECT count(*)>=5 FROM qf.operator_kdf_attempt WHERE kind='password-change' AND operator_id=o.id AND created_at>at-interval '60 seconds') THEN RETURN jsonb_build_object('error','RATE_LIMITED'); END IF;
  IF mode='reserve-login' THEN
   IF s.failed_attempts>=5 OR EXISTS(SELECT 1 FROM qf.operator_kdf_attempt WHERE id=s.password_attempt_id AND finished_at IS NULL AND expires_at>at) THEN RAISE EXCEPTION 'AUTHENTICATION_FAILED'; END IF;
   IF (SELECT count(*)>=10 FROM qf.audit_event WHERE action='login_failed' AND occurred_at>at-interval '60 seconds') THEN RETURN jsonb_build_object('error','RATE_LIMITED'); END IF;
  END IF;
  IF mode='reserve-setup' THEN
   IF EXISTS(SELECT 1 FROM qf.operator_kdf_attempt WHERE id=t.attempt_id AND finished_at IS NULL AND expires_at>at) THEN RAISE EXCEPTION 'PASSWORD_TOKEN_INVALID'; END IF;
   SELECT * INTO r FROM qf.operator_account_operation WHERE operation_id=(p->>'operationId')::uuid;
   IF r.operation_id IS NOT NULL THEN RAISE EXCEPTION 'OPERATION_BINDING_CONFLICT'; END IF;
  END IF;
  IF mode='reserve-change' AND EXISTS(SELECT 1 FROM qf.operator_account_operation WHERE operation_id=(p->>'operationId')::uuid) THEN RAISE EXCEPTION 'OPERATION_BINDING_CONFLICT'; END IF;
  aid:=(p->>'attemptId')::uuid;kind_name:=CASE mode WHEN 'reserve-login' THEN 'login' WHEN 'reserve-setup' THEN 'setup' ELSE 'password-change' END;
  INSERT INTO qf.operator_kdf_attempt(id,cost,kind,operator_id,session_id,token_id,operation_id,account_revision,created_at,expires_at) VALUES(aid,CASE WHEN kind_name='password-change' THEN 2 ELSE 1 END,kind_name,o.id,CASE WHEN kind_name='setup' THEN NULL ELSE s.id END,t.id,(p->>'operationId')::uuid,o.account_revision,at,at+interval '30 seconds');
  IF mode='reserve-login' THEN UPDATE qf.operator_session SET password_attempt_id=aid,failed_attempts=failed_attempts+1 WHERE id=s.id; END IF;
  IF mode='reserve-setup' THEN UPDATE qf.operator_password_token SET attempt_id=aid WHERE id=t.id; END IF;
  at:=clock_timestamp();
  IF mode='reserve-setup' AND t.expires_at<=at THEN RAISE EXCEPTION 'PASSWORD_TOKEN_INVALID'; END IF;
  IF mode='reserve-change' AND (qf.account_actor(digest)).id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  IF mode='reserve-login' AND (s.idle_expires_at<=at OR s.absolute_expires_at<=at) THEN RAISE EXCEPTION 'AUTHENTICATION_FAILED'; END IF;
  RETURN jsonb_build_object('attemptId',aid,'passwordHash',CASE WHEN mode='reserve-setup' THEN NULL ELSE o.password_hash END);
 END IF;
 SELECT * INTO a FROM qf.operator_kdf_attempt WHERE id=(p->>'attemptId')::uuid FOR UPDATE;
 kind_name:=CASE mode WHEN 'finish-login' THEN 'login' WHEN 'finish-setup' THEN 'setup' ELSE 'password-change' END;
 IF a.id IS NULL OR a.kind<>kind_name OR (kind_name='setup' AND a.token_id IS DISTINCT FROM t.id) OR(kind_name<>'setup' AND a.session_id IS DISTINCT FROM s.id) OR (kind_name<>'login' AND a.operation_id IS DISTINCT FROM (p->>'operationId')::uuid) THEN RAISE EXCEPTION 'AUTHENTICATION_FAILED'; END IF;
 IF a.finished_at IS NOT NULL THEN RAISE EXCEPTION 'OPERATION_BINDING_CONFLICT'; END IF;
 SELECT * INTO o FROM qf.operator WHERE id=a.operator_id FOR UPDATE;
 -- Revocation will touch all of these rows. Wait now, before deciding whether completion is still authorized.
 PERFORM 1 FROM qf.operator_session WHERE operator_id=o.id ORDER BY id FOR UPDATE;
 PERFORM 1 FROM qf.operator_password_token WHERE operator_id=o.id ORDER BY id FOR UPDATE;
 at:=clock_timestamp();
 UPDATE qf.operator_kdf_attempt SET finished_at=at WHERE id=a.id;
 good:=o.id IS NOT NULL AND o.status='active' AND o.account_revision=a.account_revision AND a.expires_at>at;
 IF mode='finish-login' THEN
  good:=good AND s.password_attempt_id=a.id AND coalesce((p->>'verified')::boolean,false);
  IF NOT good THEN
   IF s.failed_attempts>=5 THEN UPDATE qf.operator_session SET revoked_at=at WHERE id=s.id; END IF;
   INSERT INTO qf.audit_event(id,action,outcome,reason_code,session_id,request_id) VALUES(a.id,'login_failed','rejected','AUTHENTICATION_FAILED',s.id,a.id);
   RETURN jsonb_build_object('error','AUTHENTICATION_FAILED');
  END IF;
  UPDATE qf.operator_session SET revoked_at=at WHERE id=s.id;
  new_session:=(p->>'sessionId')::uuid;new_raw_digest:=p->>'sessionDigest';
  INSERT INTO qf.operator_session(id,token_digest,kind,operator_id,created_at,last_seen_at,idle_expires_at,absolute_expires_at) VALUES(new_session,new_raw_digest,'authenticated',o.id,at,at,at+interval '30 minutes',at+interval '8 hours');
  INSERT INTO qf.audit_event(id,action,outcome,actor_id,session_id,request_id) VALUES(a.id,'login_succeeded','success',o.id,new_session,a.id);
  at:=clock_timestamp();
  IF a.expires_at<=at OR s.idle_expires_at<=at OR s.absolute_expires_at<=at THEN RAISE EXCEPTION 'AUTHENTICATION_FAILED'; END IF;
  RETURN jsonb_build_object('sessionId',new_session);
 END IF;
 op:=a.operation_id;
 IF mode='finish-change' AND (qf.account_actor(digest)).id IS NULL THEN rejection:='UNAUTHENTICATED';
 ELSIF NOT good THEN rejection:=CASE WHEN mode='finish-setup' THEN 'PASSWORD_TOKEN_INVALID' ELSE 'PASSWORD_CONFIRMATION_FAILED' END;
 ELSIF mode='finish-change' AND NOT coalesce((p->>'verified')::boolean,false) THEN rejection:='PASSWORD_CONFIRMATION_FAILED';
 ELSIF mode='finish-setup' AND (t.consumed_at IS NOT NULL OR t.revoked_at IS NOT NULL OR t.expires_at<=at OR t.attempt_id IS DISTINCT FROM a.id) THEN rejection:='PASSWORD_TOKEN_INVALID';
 ELSIF (p->>'passwordHash') IS NULL OR (p->>'passwordHash') !~ '^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$' THEN rejection:='PASSWORD_POLICY_REJECTED';
 ELSIF o.account_revision=2147483647 THEN rejection:='REVISION_LIMIT';
 ELSIF mode='finish-setup' AND t.purpose='bootstrap-admin' AND EXISTS(SELECT 1 FROM qf.operator WHERE role='admin') THEN rejection:='ACCOUNT_CONFLICT'; END IF;
 IF rejection IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM qf.operator_account_operation WHERE operation_id=op) THEN RETURN qf.account_record(op,CASE WHEN mode='finish-change' THEN o.id ELSE NULL END,o.id,CASE WHEN mode='finish-change' THEN 'password-change' ELSE 'password-setup' END,jsonb_build_object('action',CASE WHEN mode='finish-change' THEN 'password-change' ELSE 'password-setup' END,'targetId',o.id),t.id,rejection); END IF;
  RETURN jsonb_build_object('error',rejection);
 END IF;
 BEGIN
 UPDATE qf.operator SET password_hash=p->>'passwordHash',account_revision=account_revision+1,role=CASE WHEN mode='finish-setup' AND t.purpose='bootstrap-admin' THEN 'admin'::qf.operator_role ELSE role END WHERE id=o.id;
 IF mode='finish-setup' THEN UPDATE qf.operator_password_token SET consumed_at=at WHERE id=t.id; END IF;
 PERFORM qf.account_revoke(o.id);
 answer:=qf.account_record(op,CASE WHEN mode='finish-change' THEN o.id ELSE NULL END,o.id,CASE WHEN mode='finish-change' THEN 'password-change' ELSE 'password-setup' END,jsonb_build_object('action',CASE WHEN mode='finish-change' THEN 'password-change' ELSE 'password-setup' END,'targetId',o.id),t.id);
 at:=clock_timestamp();
 IF a.expires_at<=at OR (mode='finish-setup' AND t.expires_at<=at) OR (mode='finish-change' AND (s.idle_expires_at<=at OR s.absolute_expires_at<=at)) THEN
  rejection:=CASE WHEN mode='finish-setup' THEN 'PASSWORD_TOKEN_INVALID' ELSE 'PASSWORD_CONFIRMATION_FAILED' END;
  RAISE EXCEPTION USING ERRCODE='P1001',MESSAGE='PASSWORD_FINISH_EXPIRED';
 END IF;
 RETURN answer->'operation';
 EXCEPTION WHEN SQLSTATE 'P1001' THEN
  -- Roll back only the tentative password/revocation/success receipt, then retain the bound rejection.
  RETURN qf.account_record(op,CASE WHEN mode='finish-change' THEN o.id ELSE NULL END,o.id,CASE WHEN mode='finish-change' THEN 'password-change' ELSE 'password-setup' END,jsonb_build_object('action',CASE WHEN mode='finish-change' THEN 'password-change' ELSE 'password-setup' END,'targetId',o.id),t.id,rejection);
 END;
END $$;

CREATE OR REPLACE FUNCTION qf.account_directory_read(mode text,digest text,p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE s qf.operator_session; original_actor uuid; off integer; lim integer;
 query_text text; role_filter text; status_filter text; action_filter text; answer jsonb;
BEGIN
 IF mode IS NULL OR mode NOT IN ('list','audit') OR p IS NULL OR jsonb_typeof(p) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k<>ALL(CASE WHEN mode='list' THEN ARRAY['offset','limit','q','role','status'] ELSE ARRAY['offset','limit','q','action'] END)) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF (p ? 'offset' AND (jsonb_typeof(p->'offset') IS DISTINCT FROM 'number' OR (p->>'offset') !~ '^[0-9]{1,7}$'))
  OR (p ? 'limit' AND (jsonb_typeof(p->'limit') IS DISTINCT FROM 'number' OR (p->>'limit') !~ '^[0-9]{1,2}$'))
  OR (p ? 'q' AND jsonb_typeof(p->'q') IS DISTINCT FROM 'string')
  OR (p ? 'role' AND jsonb_typeof(p->'role') IS DISTINCT FROM 'string')
  OR (p ? 'status' AND jsonb_typeof(p->'status') IS DISTINCT FROM 'string')
  OR (p ? 'action' AND jsonb_typeof(p->'action') IS DISTINCT FROM 'string') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 off:=coalesce((p->>'offset')::integer,0); lim:=coalesce((p->>'limit')::integer,25);
 query_text:=lower(btrim(coalesce(p->>'q',''))); role_filter:=coalesce(p->>'role','all');
 status_filter:=coalesce(p->>'status','all'); action_filter:=coalesce(p->>'action','all');
 IF off>1000000 OR lim<1 OR lim>50 OR char_length(coalesce(p->>'q',''))>80 OR query_text ~ '[[:cntrl:]]'
  OR role_filter NOT IN ('all','admin','operator','read-only') OR status_filter NOT IN ('all','active','pending','disabled')
  OR action_filter NOT IN ('all','create','display-name','role','disable','restore','issue-setup','issue-reset','password-setup','password-change','logout-all','revoke-sessions','bootstrap-admin','admin-recovery') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;

 PERFORM pg_advisory_xact_lock(72461,1);
 s:=qf.account_actor(digest); IF s.id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
 original_actor:=s.operator_id;
 IF NOT EXISTS(SELECT 1 FROM qf.operator WHERE id=original_actor AND role='admin') THEN RAISE EXCEPTION 'CAPABILITY_DENIED'; END IF;
 IF mode='list' THEN
  WITH accounts AS MATERIALIZED (
   SELECT o.id,o.role::text role,qf.account_dto(o) v,
    lower(o.login_name||' '||o.display_name) search_text FROM qf.operator o
  ), filtered AS MATERIALIZED (
   SELECT id,v FROM accounts WHERE (role_filter='all' OR role=role_filter)
    AND (status_filter='all' OR v->>'status'=status_filter) AND position(query_text in search_text)>0
  ), page AS (SELECT id,v FROM filtered ORDER BY id OFFSET off LIMIT lim)
  SELECT jsonb_build_object(
   'items',coalesce((SELECT jsonb_agg(v ORDER BY id) FROM page),'[]'::jsonb),
   'offset',off,'limit',lim,'hasMore',(SELECT count(*)>off+lim FROM filtered),'total',(SELECT count(*) FROM filtered),
   'summary',(SELECT jsonb_build_object('total',count(*),'active',count(*) FILTER(WHERE v->>'status'='active'),'pending',count(*) FILTER(WHERE v->>'status'='pending'),'disabled',count(*) FILTER(WHERE v->>'status'='disabled')) FROM accounts),
   'snapshotAt',qf.consumer_moment(date_trunc('milliseconds',statement_timestamp()))
  ) INTO answer;
 ELSE
  WITH records AS MATERIALIZED (
   SELECT r.created_at,r.operation_id,r.action,
    qf.account_operation_dto(r)||jsonb_build_object('actorDisplayName',a.display_name,'targetDisplayName',t.display_name) v,
    lower(coalesce(a.display_name,'')||' '||coalesce(a.login_name,'')||' '||t.display_name||' '||t.login_name) search_text
   FROM qf.operator_account_operation r JOIN qf.operator t ON t.id=r.target_id LEFT JOIN qf.operator a ON a.id=r.actor_id
  ), filtered AS MATERIALIZED (
   SELECT created_at,operation_id,v FROM records WHERE (action_filter='all' OR action=action_filter) AND position(query_text in search_text)>0
  ), page AS (SELECT created_at,operation_id,v FROM filtered ORDER BY created_at DESC,operation_id DESC OFFSET off LIMIT lim)
  SELECT jsonb_build_object(
   'items',coalesce((SELECT jsonb_agg(v ORDER BY created_at DESC,operation_id DESC) FROM page),'[]'::jsonb),
   'offset',off,'limit',lim,'hasMore',(SELECT count(*)>off+lim FROM filtered),'total',(SELECT count(*) FROM filtered),
   'snapshotAt',qf.consumer_moment(date_trunc('milliseconds',statement_timestamp()))
  ) INTO answer;
 END IF;
 -- No stale authority after lock waits or a query that outlives its session.
 s:=qf.account_actor(digest);
 IF s.id IS NULL OR s.operator_id IS DISTINCT FROM original_actor THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM qf.operator WHERE id=original_actor AND role='admin') THEN RAISE EXCEPTION 'CAPABILITY_DENIED'; END IF;
 RETURN answer;
END $$;

-- Owner-only finite maintenance. Full original request/digests bind the durable outcome;
-- raw token bytes live exclusively in the private operation file.
CREATE OR REPLACE FUNCTION qf.account_local(p jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o qf.operator;old qf.operator_account_operation;op uuid;target uuid;action_name text;
 before_revision integer;changed boolean:=false;rejection text;answer jsonb;effect jsonb;token uuid;
BEGIN
 IF p IS NULL OR jsonb_typeof(p)<>'object' THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 action_name:=p->>'action';
 IF action_name IS NULL OR action_name NOT IN('bootstrap-admin','admin-recovery','disable','restore')
  OR NOT (p ?& ARRAY['operationId','targetId','action'])
  OR jsonb_typeof(p->'operationId') IS DISTINCT FROM 'string' OR jsonb_typeof(p->'targetId') IS DISTINCT FROM 'string'
  OR (p->>'operationId') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  OR (p->>'targetId') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k<>ALL(CASE action_name
   WHEN 'bootstrap-admin' THEN ARRAY['operationId','targetId','action','loginName','displayName','tokenId','tokenDigest']
   WHEN 'admin-recovery' THEN ARRAY['operationId','targetId','action','expectedRevision','tokenId','tokenDigest']
   ELSE ARRAY['operationId','targetId','action','expectedRevision'] END)) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF action_name<>'bootstrap-admin' AND (jsonb_typeof(p->'expectedRevision') IS DISTINCT FROM 'number'
  OR (p->>'expectedRevision') !~ '^[1-9][0-9]{0,9}$' OR (p->>'expectedRevision')::numeric>2147483647) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF action_name IN('bootstrap-admin','admin-recovery') AND (jsonb_typeof(p->'tokenId') IS DISTINCT FROM 'string'
  OR (p->>'tokenId') !~ '^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$'
  OR jsonb_typeof(p->'tokenDigest') IS DISTINCT FROM 'string' OR (p->>'tokenDigest') !~ '^[a-f0-9]{64}$') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF action_name='bootstrap-admin' AND (jsonb_typeof(p->'loginName') IS DISTINCT FROM 'string'
  OR (p->>'loginName') !~ '^[a-z0-9][a-z0-9._-]{2,63}$' OR jsonb_typeof(p->'displayName') IS DISTINCT FROM 'string'
  OR char_length(p->>'displayName') NOT BETWEEN 1 AND 80 OR (p->>'displayName') ~ '[[:cntrl:]<>]'
  OR (p->>'displayName') ~ U&'[\007F-\009F]' OR (p->>'displayName')<>btrim(p->>'displayName',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')) THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 op:=(p->>'operationId')::uuid;target:=(p->>'targetId')::uuid;
 PERFORM pg_advisory_xact_lock(72461,1);
 SELECT * INTO old FROM qf.operator_account_operation WHERE operation_id=op;
 IF old.operation_id IS NOT NULL THEN
  IF old.actor_id IS NOT NULL OR old.target_id<>target OR old.action<>action_name OR old.binding<>p OR old.local_result IS NULL THEN RAISE EXCEPTION 'OPERATION_BINDING_CONFLICT'; END IF;
  RETURN jsonb_build_object('first',false,'receipt',jsonb_build_object('operation',qf.account_operation_dto(old),'binding',old.binding-ARRAY['tokenId','tokenDigest'],'result',old.local_result));
 END IF;
 SELECT * INTO o FROM qf.operator WHERE id=target FOR UPDATE;
 IF action_name='bootstrap-admin' THEN
  IF o.id IS NOT NULL OR EXISTS(SELECT 1 FROM qf.operator WHERE role='admin') OR
   EXISTS(SELECT 1 FROM qf.operator_password_token WHERE purpose='bootstrap-admin' AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'ACCOUNT_CONFLICT'; END IF;
  INSERT INTO qf.operator(id,login_name,display_name,role,status,account_revision)
   VALUES(target,p->>'loginName',p->>'displayName','operator','active',1) RETURNING * INTO o;
  changed:=true;
 ELSE
  IF o.id IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  before_revision:=o.account_revision;
  IF o.account_revision<>(p->>'expectedRevision')::integer THEN rejection:='ACCOUNT_CONFLICT';
  ELSIF action_name='admin-recovery' AND (o.role<>'admin' OR o.password_hash IS NULL OR o.status<>'active') THEN rejection:='ACCOUNT_CONFLICT';
  ELSIF (action_name='disable' AND o.status='disabled') OR (action_name='restore' AND o.status='active') THEN changed:=false;
  ELSIF o.account_revision=2147483647 THEN rejection:='REVISION_LIMIT';
  ELSIF action_name='disable' AND o.role='admin' AND o.password_hash IS NOT NULL AND
   NOT EXISTS(SELECT 1 FROM qf.operator WHERE id<>target AND role='admin' AND status='active' AND password_hash IS NOT NULL) THEN rejection:='LAST_ACTIVE_ADMIN';
  ELSE
   changed:=true;
   IF action_name='disable' THEN
    UPDATE qf.operator SET status='disabled',disabled_at=clock_timestamp(),account_revision=account_revision+1 WHERE id=target;
    PERFORM qf.account_revoke(target);
   ELSIF action_name='restore' THEN
    UPDATE qf.operator SET status='active',disabled_at=NULL,account_revision=account_revision+1 WHERE id=target;
   ELSE
    UPDATE qf.operator SET account_revision=account_revision+1 WHERE id=target;
   END IF;
  END IF;
 END IF;
 IF rejection IS NULL AND action_name IN('bootstrap-admin','admin-recovery') THEN
  token:=(p->>'tokenId')::uuid;
  PERFORM qf.account_issue(target,action_name,p->>'tokenDigest',token,NULL,op);
 END IF;
 SELECT * INTO o FROM qf.operator WHERE id=target;
 effect:=jsonb_build_object('changed',changed,'previousRevision',before_revision,'resultingRevision',o.account_revision,'resultingStatus',qf.account_dto(o)->>'status');
 answer:=qf.account_record(op,NULL,target,action_name,p,token,rejection);
 UPDATE qf.operator_account_operation SET local_result=effect WHERE operation_id=op RETURNING * INTO old;
 RETURN jsonb_build_object('first',true,'receipt',jsonb_build_object('operation',qf.account_operation_dto(old),'binding',p-ARRAY['tokenId','tokenDigest'],'result',effect));
END $$;
REVOKE ALL ON FUNCTION qf.account_local(jsonb),qf.account_dto(qf.operator),qf.account_command(text,text,jsonb),qf.account_password(text,text,jsonb),qf.account_directory_read(text,text,jsonb) FROM PUBLIC;

-- All executable references above use current fields before the obsolete columns go away.
ALTER TABLE qf.operator DROP COLUMN label RESTRICT, DROP COLUMN credential_digest RESTRICT;
