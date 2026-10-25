-- Account DTOs project database microseconds to canonical ISO milliseconds.
-- Stored moments, capability deadlines and the strict consumer_moment contract are unchanged.
CREATE OR REPLACE FUNCTION qf.account_dto(o qf.operator) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',o.id,'label',o.label,'loginName',o.login_name,'displayName',coalesce(o.display_name,o.label),'role',o.role,'status',CASE WHEN o.status='disabled' THEN 'disabled' WHEN o.password_hash IS NULL OR o.login_name IS NULL THEN 'pending' ELSE 'active' END,'revision',o.account_revision,'createdAt',qf.consumer_moment(date_trunc('milliseconds',o.created_at)),'disabledAt',CASE WHEN o.disabled_at IS NULL THEN NULL ELSE qf.consumer_moment(date_trunc('milliseconds',o.disabled_at)) END)
$$;
CREATE OR REPLACE FUNCTION qf.account_operation_dto(o qf.operator_account_operation) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('operationId',o.operation_id,'action',o.action,'actorId',o.actor_id,'targetId',o.target_id,'status',o.status,'errorCode',o.error_code,'createdAt',qf.consumer_moment(date_trunc('milliseconds',o.created_at)))
$$;
CREATE OR REPLACE FUNCTION qf.account_issue(target uuid,purpose_name text,digest text,token uuid,actor uuid,op uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE at timestamptz:=clock_timestamp();
BEGIN
 IF digest !~ '^[a-f0-9]{64}$' OR purpose_name NOT IN('setup','reset','bootstrap-admin','admin-recovery') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 PERFORM 1 FROM qf.operator_password_token WHERE operator_id=target ORDER BY id FOR UPDATE;
 at:=clock_timestamp();
 UPDATE qf.operator_password_token SET revoked_at=at WHERE operator_id=target AND consumed_at IS NULL AND revoked_at IS NULL;
 INSERT INTO qf.operator_password_token(id,operator_id,purpose,token_digest,issued_by,operation_id,issued_at,expires_at) VALUES(token,target,purpose_name,digest,actor,op,at,at+interval '30 minutes');
 RETURN jsonb_build_object('tokenId',token,'purpose',purpose_name,'expiresAt',qf.consumer_moment(date_trunc('milliseconds',at+interval '30 minutes')));
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
  IF mode='inspect' THEN RETURN jsonb_build_object('tokenId',t.id,'purpose',t.purpose,'loginName',o.login_name,'displayName',coalesce(o.display_name,o.label),'expiresAt',qf.consumer_moment(date_trunc('milliseconds',t.expires_at)),'passwordPolicy',jsonb_build_object('minCodePoints',15,'maxCodePoints',256)); END IF;
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
 UPDATE qf.operator SET password_hash=p->>'passwordHash',credential_digest=NULL,account_revision=account_revision+1,role=CASE WHEN mode='finish-setup' AND t.purpose='bootstrap-admin' THEN 'admin'::qf.operator_role ELSE role END WHERE id=o.id;
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
