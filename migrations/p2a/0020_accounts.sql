-- Only the exact 0019 staged structure may be extended. ACL reset remains owned by migrate.ts.
DO $preflight$ DECLARE actual text; BEGIN
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
) SELECT value,encode(sha256(convert_to(value::text,'UTF8')),'hex') sha256 FROM reduced) known;
 IF actual IS DISTINCT FROM 'b9e5ec12a8b7d79f3dd0b928c9520c61608b87eff1ef8f1c9e791cc8ed445293' THEN RAISE EXCEPTION 'ACCOUNT_PREVIOUS_STRUCTURE'; END IF;
END $preflight$;
-- Fixed schema extension; no identity conversion or credential revocation happens in migration.
LOCK TABLE qf.operator,qf.operator_session,qf.audit_event IN SHARE ROW EXCLUSIVE MODE NOWAIT;
ALTER TABLE qf.operator ALTER COLUMN credential_digest DROP NOT NULL;
ALTER TABLE qf.operator ADD COLUMN login_name varchar(64), ADD COLUMN display_name varchar(320),
 ADD COLUMN password_hash varchar(256), ADD COLUMN account_revision integer NOT NULL DEFAULT 1;
ALTER TABLE qf.operator ADD CONSTRAINT operator_login UNIQUE(login_name),
 ADD CONSTRAINT operator_account_revision CHECK(account_revision BETWEEN 1 AND 2147483647),
 ADD CONSTRAINT operator_login_name CHECK(login_name IS NULL OR login_name ~ '^[a-z0-9][a-z0-9._-]{2,63}$'),
 ADD CONSTRAINT operator_display_name CHECK(display_name IS NULL OR (char_length(display_name) BETWEEN 1 AND 80 AND display_name !~ '[[:cntrl:]<>]' AND display_name=btrim(display_name))),
 ADD CONSTRAINT operator_account_pair CHECK((login_name IS NULL AND password_hash IS NULL) OR (login_name IS NOT NULL AND display_name IS NOT NULL)),
 ADD CONSTRAINT operator_password_hash CHECK(password_hash IS NULL OR password_hash ~ '^\$argon2id\$v=19\$m=65536,t=3,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$');
ALTER TABLE qf.operator_session ADD COLUMN password_attempt_id uuid;
CREATE TABLE qf.operator_password_token(
 id uuid PRIMARY KEY, operator_id uuid NOT NULL REFERENCES qf.operator(id) ON DELETE RESTRICT,
 purpose text NOT NULL CHECK(purpose IN ('setup','reset','bootstrap-admin','admin-recovery')),
 token_digest char(64) NOT NULL UNIQUE CHECK(token_digest ~ '^[a-f0-9]{64}$'),
 issued_by uuid REFERENCES qf.operator(id) ON DELETE RESTRICT, operation_id uuid NOT NULL UNIQUE,
 issued_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 consumed_at timestamptz, revoked_at timestamptz, attempt_id uuid,
 CHECK(expires_at=issued_at+interval '30 minutes'),
 CHECK(consumed_at IS NULL OR consumed_at>=issued_at),CHECK(revoked_at IS NULL OR revoked_at>=issued_at)
);
CREATE UNIQUE INDEX operator_password_token_current ON qf.operator_password_token(operator_id) WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE TABLE qf.operator_account_operation(
 operation_id uuid PRIMARY KEY, actor_id uuid REFERENCES qf.operator(id) ON DELETE RESTRICT,
 target_id uuid NOT NULL REFERENCES qf.operator(id) ON DELETE RESTRICT, action text NOT NULL,
 binding jsonb NOT NULL CHECK(jsonb_typeof(binding)='object' AND octet_length(binding::text)<=4096),
 status text NOT NULL CHECK(status IN ('completed','rejected')),error_code varchar(64),
 token_id uuid REFERENCES qf.operator_password_token(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((status='completed' AND error_code IS NULL) OR(status='rejected' AND error_code IS NOT NULL)),
 CHECK(action IN ('create','display-name','role','disable','restore','issue-setup','issue-reset','password-setup','password-change','logout-all','revoke-sessions','bootstrap-admin','enroll','admin-recovery'))
);
CREATE INDEX operator_account_operation_actor ON qf.operator_account_operation(actor_id,created_at DESC,operation_id);
CREATE TABLE qf.operator_kdf_attempt(
 id uuid PRIMARY KEY, cost integer NOT NULL CHECK(cost IN (1,2)), kind text NOT NULL CHECK(kind IN ('login','setup','password-change')),
 operator_id uuid REFERENCES qf.operator(id) ON DELETE RESTRICT,
 session_id uuid REFERENCES qf.operator_session(id) ON DELETE RESTRICT,
 token_id uuid REFERENCES qf.operator_password_token(id) ON DELETE RESTRICT,
 operation_id uuid, account_revision integer, created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 finished_at timestamptz, CHECK(expires_at=created_at+interval '30 seconds'),
 CHECK(finished_at IS NULL OR finished_at>=created_at),
 CHECK((kind='login' AND session_id IS NOT NULL AND token_id IS NULL) OR(kind='setup' AND token_id IS NOT NULL AND operator_id IS NOT NULL AND session_id IS NULL) OR(kind='password-change' AND session_id IS NOT NULL AND token_id IS NULL AND operator_id IS NOT NULL))
);
CREATE INDEX operator_kdf_attempt_budget ON qf.operator_kdf_attempt(created_at);
CREATE INDEX operator_kdf_attempt_account ON qf.operator_kdf_attempt(operator_id,kind,created_at);
-- Preserve all old audit target meanings and extend only the explicit account action.
DO $$ DECLARE old text; BEGIN
 SELECT pg_get_constraintdef(oid) INTO old FROM pg_constraint WHERE conrelid='qf.audit_event'::regclass AND conname='audit_target';
 IF old IS NULL THEN RAISE EXCEPTION 'ACCOUNT_AUDIT_PREVIOUS_MISSING'; END IF;
 ALTER TABLE qf.audit_event DROP CONSTRAINT audit_target;
 EXECUTE 'ALTER TABLE qf.audit_event ADD CONSTRAINT audit_target CHECK ((('||substr(old,8,length(old)-8)||') OR (action=''account_operation'' AND target_kind=''operator'' AND target_id ~ ''^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'' AND target_revision BETWEEN 1 AND 2147483647)) IS TRUE)';
END $$;
CREATE FUNCTION qf.account_dto(o qf.operator) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('id',o.id,'label',o.label,'loginName',o.login_name,'displayName',coalesce(o.display_name,o.label),'role',o.role,'status',CASE WHEN o.status='disabled' THEN 'disabled' WHEN o.password_hash IS NULL OR o.login_name IS NULL THEN 'pending' ELSE 'active' END,'revision',o.account_revision,'legacyCredentialActive',o.credential_digest IS NOT NULL,'createdAt',qf.consumer_moment(o.created_at),'disabledAt',CASE WHEN o.disabled_at IS NULL THEN NULL ELSE qf.consumer_moment(o.disabled_at) END)
$$;
CREATE FUNCTION qf.account_operation_dto(o qf.operator_account_operation) RETURNS jsonb LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT jsonb_build_object('operationId',o.operation_id,'action',o.action,'actorId',o.actor_id,'targetId',o.target_id,'status',o.status,'errorCode',o.error_code,'createdAt',qf.consumer_moment(o.created_at))
$$;
CREATE FUNCTION qf.account_actor(digest text) RETURNS qf.operator_session LANGUAGE sql VOLATILE SET search_path=pg_catalog AS $$
 SELECT s FROM qf.operator_session s JOIN qf.operator o ON o.id=s.operator_id WHERE s.token_digest=digest AND s.kind='authenticated' AND s.revoked_at IS NULL AND o.status='active' AND s.idle_expires_at>clock_timestamp() AND s.absolute_expires_at>clock_timestamp()
$$;
CREATE FUNCTION qf.account_record(op uuid, actor uuid,target uuid,action_name text,binding_value jsonb,token uuid DEFAULT NULL,error text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE r qf.operator_account_operation; rev integer;
BEGIN
 INSERT INTO qf.operator_account_operation(operation_id,actor_id,target_id,action,binding,status,error_code,token_id) VALUES(op,actor,target,action_name,binding_value,CASE WHEN error IS NULL THEN 'completed' ELSE 'rejected' END,error,token) RETURNING * INTO r;
 SELECT account_revision INTO rev FROM qf.operator WHERE id=target;
 INSERT INTO qf.audit_event(id,action,outcome,actor_id,request_id,target_kind,target_id,target_revision) VALUES(op,'account_operation',CASE WHEN error IS NULL THEN 'success'::qf.audit_outcome ELSE 'rejected'::qf.audit_outcome END,actor,op,'operator',target::text,rev);
 RETURN CASE WHEN error IS NULL THEN jsonb_build_object('operation',qf.account_operation_dto(r)) ELSE jsonb_build_object('error',error,'operation',qf.account_operation_dto(r)) END;
END $$;
CREATE FUNCTION qf.account_revoke(target uuid) RETURNS void LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 UPDATE qf.operator_session SET revoked_at=clock_timestamp() WHERE operator_id=target AND revoked_at IS NULL;
 UPDATE qf.operator_password_token SET revoked_at=clock_timestamp() WHERE operator_id=target AND consumed_at IS NULL AND revoked_at IS NULL;
END $$;
CREATE FUNCTION qf.account_issue(target uuid,purpose_name text,digest text,token uuid,actor uuid,op uuid) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE at timestamptz:=clock_timestamp();
BEGIN
 IF digest !~ '^[a-f0-9]{64}$' OR purpose_name NOT IN('setup','reset','bootstrap-admin','admin-recovery') THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 UPDATE qf.operator_password_token SET revoked_at=at WHERE operator_id=target AND consumed_at IS NULL AND revoked_at IS NULL;
 INSERT INTO qf.operator_password_token(id,operator_id,purpose,token_digest,issued_by,operation_id,issued_at,expires_at) VALUES(token,target,purpose_name,digest,actor,op,at,at+interval '30 minutes');
 RETURN jsonb_build_object('tokenId',token,'purpose',purpose_name,'expiresAt',qf.consumer_moment(at+interval '30 minutes'));
END $$;
-- One finite authenticated command surface; authority always comes from the live DB session.
CREATE FUNCTION qf.account_command(mode text,digest text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
 IF mode IN('list','audit') THEN
  IF actor.role<>'admin' THEN RAISE EXCEPTION 'CAPABILITY_DENIED'; END IF;
  off:=(p->>'offset')::integer;lim:=(p->>'limit')::integer;
  IF off<0 OR off>1000000 OR lim<1 OR lim>50 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF mode='list' THEN
   SELECT jsonb_build_object('items',coalesce(jsonb_agg(v ORDER BY id),'[]'::jsonb),'offset',off,'limit',lim,'hasMore',EXISTS(SELECT 1 FROM qf.operator x WHERE (coalesce(p->>'status','all')='all' OR qf.account_dto(x)->>'status'=p->>'status') AND (position(lower(coalesce(p->>'q','')) in lower(coalesce(x.login_name,'')||' '||coalesce(x.display_name,x.label)))>0) OFFSET off+lim LIMIT 1)) INTO answer
    FROM (SELECT o.id,qf.account_dto(o) v FROM qf.operator o WHERE (coalesce(p->>'status','all')='all' OR qf.account_dto(o)->>'status'=p->>'status') AND position(lower(coalesce(p->>'q','')) in lower(coalesce(o.login_name,'')||' '||coalesce(o.display_name,o.label)))>0 ORDER BY o.id OFFSET off LIMIT lim) rows;
  ELSE
   SELECT jsonb_build_object('items',coalesce(jsonb_agg(v ORDER BY created_at DESC,operation_id DESC),'[]'::jsonb),'offset',off,'limit',lim,'hasMore',(SELECT count(*)>off+lim FROM qf.operator_account_operation)) INTO answer FROM (SELECT r.created_at,r.operation_id,qf.account_operation_dto(r)||jsonb_build_object('actorDisplayName',(SELECT coalesce(display_name,label) FROM qf.operator WHERE id=r.actor_id),'targetDisplayName',coalesce(o.display_name,o.label)) v FROM qf.operator_account_operation r JOIN qf.operator o ON o.id=r.target_id ORDER BY r.created_at DESC,r.operation_id DESC OFFSET off LIMIT lim) rows;
  END IF;
  RETURN answer;
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
 IF action_name='logout-all' THEN target_id:=actor.id;
 ELSIF actor.role<>'admin' THEN RAISE EXCEPTION 'CAPABILITY_DENIED'; END IF;
 IF action_name='create' THEN
  desired:=(p->>'role')::qf.operator_role;
  IF (p->>'loginName') !~ '^[a-z0-9][a-z0-9._-]{2,63}$' OR char_length(p->>'displayName') NOT BETWEEN 1 AND 80 THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF EXISTS(SELECT 1 FROM qf.operator WHERE login_name=p->>'loginName') THEN RAISE EXCEPTION 'LOGIN_NAME_TAKEN'; END IF;
  INSERT INTO qf.operator(id,label,credential_digest,role,status,login_name,display_name) VALUES(target_id,'account-'||target_id::text,NULL,desired,'active',p->>'loginName',p->>'displayName');
  link:=qf.account_issue(target_id,'setup',p->>'tokenDigest',(p->>'tokenId')::uuid,actor.id,op);
 ELSE
  SELECT * INTO target FROM qf.operator WHERE id=target_id FOR UPDATE;
  IF target.id IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF action_name<>'logout-all' AND target.account_revision<>(p->>'expectedRevision')::integer THEN RETURN qf.account_record(op,actor.id,target_id,action_name,binding_value,NULL,'ACCOUNT_CONFLICT'); END IF;
  IF target.account_revision=2147483647 THEN RAISE EXCEPTION 'REVISION_LIMIT'; END IF;
  IF action_name IN('disable','role') AND target.role='admin' AND target.status='active' AND target.password_hash IS NOT NULL AND target.login_name IS NOT NULL AND (action_name='disable' OR p->>'role'<>'admin') AND NOT EXISTS(SELECT 1 FROM qf.operator WHERE id<>target.id AND role='admin' AND status='active' AND login_name IS NOT NULL AND password_hash IS NOT NULL) THEN
   RETURN qf.account_record(op,actor.id,target_id,action_name,binding_value,NULL,'LAST_ACTIVE_ADMIN');
  END IF;
  CASE action_name
   WHEN 'display-name' THEN UPDATE qf.operator SET display_name=p->>'displayName',account_revision=account_revision+1 WHERE id=target_id;
   WHEN 'role' THEN UPDATE qf.operator SET role=(p->>'role')::qf.operator_role,account_revision=account_revision+1 WHERE id=target_id;PERFORM qf.account_revoke(target_id);
   WHEN 'disable' THEN UPDATE qf.operator SET status='disabled',disabled_at=coalesce(disabled_at,clock_timestamp()),account_revision=account_revision+1 WHERE id=target_id;PERFORM qf.account_revoke(target_id);
   WHEN 'restore' THEN UPDATE qf.operator SET status='active',disabled_at=NULL,account_revision=account_revision+1 WHERE id=target_id;
   WHEN 'revoke-sessions','logout-all' THEN UPDATE qf.operator SET account_revision=account_revision+1 WHERE id=target_id;PERFORM qf.account_revoke(target_id);
   WHEN 'issue-setup','issue-reset' THEN
    IF target.status<>'active' OR target.login_name IS NULL OR (action_name='issue-setup' AND target.password_hash IS NOT NULL) OR(action_name='issue-reset' AND target.password_hash IS NULL) THEN RAISE EXCEPTION 'ACCOUNT_CONFLICT'; END IF;
    UPDATE qf.operator SET account_revision=account_revision+1 WHERE id=target_id;
    link:=qf.account_issue(target_id,CASE action_name WHEN 'issue-setup' THEN 'setup' ELSE 'reset' END,p->>'tokenDigest',(p->>'tokenId')::uuid,actor.id,op);
   ELSE RAISE EXCEPTION 'INVALID_REQUEST';
  END CASE;
 END IF;
 SELECT * INTO target FROM qf.operator WHERE id=target_id;
 answer:=qf.account_record(op,actor.id,target_id,action_name,binding_value);
 RETURN answer||jsonb_build_object('account',qf.account_dto(target),'passwordSetup',link,'first',true);
END $$;
-- No raw password/token enters a SQL function. PHC leaves the DB only for a bounded reservation.
CREATE FUNCTION qf.account_password(mode text,digest text,p jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
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
  IF mode<>'finish-setup' AND (t.consumed_at IS NOT NULL OR t.revoked_at IS NOT NULL OR t.expires_at<=at OR o.status<>'active') THEN RAISE EXCEPTION 'PASSWORD_TOKEN_INVALID'; END IF;
  IF mode='inspect' THEN RETURN jsonb_build_object('tokenId',t.id,'purpose',t.purpose,'loginName',o.login_name,'displayName',coalesce(o.display_name,o.label),'expiresAt',qf.consumer_moment(t.expires_at),'passwordPolicy',jsonb_build_object('minCodePoints',15,'maxCodePoints',256)); END IF;
 ELSIF mode IN('reserve-change','finish-change') THEN
  IF mode='reserve-change' THEN s:=qf.account_actor(digest); ELSE SELECT * INTO s FROM qf.operator_session WHERE token_digest=digest AND kind='authenticated'; END IF;
  IF s.id IS NULL THEN RAISE EXCEPTION 'UNAUTHENTICATED'; END IF;
  SELECT * INTO o FROM qf.operator WHERE id=s.operator_id FOR UPDATE;
  IF mode='reserve-change' AND o.password_hash IS NULL THEN RAISE EXCEPTION 'PASSWORD_CONFIRMATION_FAILED'; END IF;
 ELSIF mode IN('reserve-login','finish-login') THEN
  SELECT * INTO s FROM qf.operator_session WHERE token_digest=digest AND kind='preauth' FOR UPDATE;
  IF s.id IS NULL OR s.revoked_at IS NOT NULL OR s.idle_expires_at<=at OR s.absolute_expires_at<=at THEN RAISE EXCEPTION 'AUTHENTICATION_FAILED'; END IF;
  IF mode='reserve-login' THEN SELECT * INTO o FROM qf.operator WHERE login_name=p->>'loginName' AND status='active' AND password_hash IS NOT NULL; END IF;
 ELSE RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF mode IN('reserve-login','reserve-setup','reserve-change') THEN
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
  RETURN jsonb_build_object('attemptId',aid,'passwordHash',CASE WHEN mode='reserve-setup' THEN NULL ELSE o.password_hash END);
 END IF;
 SELECT * INTO a FROM qf.operator_kdf_attempt WHERE id=(p->>'attemptId')::uuid FOR UPDATE;
 kind_name:=CASE mode WHEN 'finish-login' THEN 'login' WHEN 'finish-setup' THEN 'setup' ELSE 'password-change' END;
 IF a.id IS NULL OR a.kind<>kind_name OR (kind_name='setup' AND a.token_id IS DISTINCT FROM t.id) OR(kind_name<>'setup' AND a.session_id IS DISTINCT FROM s.id) OR (kind_name<>'login' AND a.operation_id IS DISTINCT FROM (p->>'operationId')::uuid) THEN RAISE EXCEPTION 'AUTHENTICATION_FAILED'; END IF;
 IF a.finished_at IS NOT NULL THEN RAISE EXCEPTION 'OPERATION_BINDING_CONFLICT'; END IF;
 UPDATE qf.operator_kdf_attempt SET finished_at=at WHERE id=a.id;
 SELECT * INTO o FROM qf.operator WHERE id=a.operator_id FOR UPDATE;
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
 UPDATE qf.operator SET password_hash=p->>'passwordHash',credential_digest=NULL,account_revision=account_revision+1,role=CASE WHEN mode='finish-setup' AND t.purpose='bootstrap-admin' THEN 'admin'::qf.operator_role ELSE role END WHERE id=o.id;
 IF mode='finish-setup' THEN UPDATE qf.operator_password_token SET consumed_at=at WHERE id=t.id; END IF;
 PERFORM qf.account_revoke(o.id);
 answer:=qf.account_record(op,CASE WHEN mode='finish-change' THEN o.id ELSE NULL END,o.id,CASE WHEN mode='finish-change' THEN 'password-change' ELSE 'password-setup' END,jsonb_build_object('action',CASE WHEN mode='finish-change' THEN 'password-change' ELSE 'password-setup' END,'targetId',o.id),t.id);
 RETURN answer->'operation';
END $$;
-- Owner-only explicit bootstrap/enroll/recovery. Never granted to the web role.
CREATE FUNCTION qf.account_local(p jsonb) RETURNS jsonb LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE o qf.operator;old qf.operator_account_operation;op uuid:=(p->>'operationId')::uuid;target uuid:=(p->>'targetId')::uuid;action_name text:=p->>'action';binding_value jsonb:=p-ARRAY['tokenId','tokenDigest'];link jsonb;answer jsonb;
BEGIN
 PERFORM pg_advisory_xact_lock(72461,1);
 SELECT * INTO old FROM qf.operator_account_operation WHERE operation_id=op;
 IF old.operation_id IS NOT NULL THEN
  IF old.actor_id IS NOT NULL OR old.binding<>binding_value THEN RAISE EXCEPTION 'OPERATION_BINDING_CONFLICT'; END IF;
  SELECT * INTO o FROM qf.operator WHERE id=target;
  RETURN jsonb_build_object('account',qf.account_dto(o),'operation',qf.account_operation_dto(old),'first',false);
 END IF;
 SELECT * INTO o FROM qf.operator WHERE id=target FOR UPDATE;
 IF action_name='bootstrap-admin' THEN
  IF EXISTS(SELECT 1 FROM qf.operator WHERE role='admin') OR EXISTS(SELECT 1 FROM qf.operator_password_token WHERE purpose='bootstrap-admin' AND operator_id<>target AND consumed_at IS NULL AND revoked_at IS NULL AND expires_at>clock_timestamp()) THEN RAISE EXCEPTION 'ACCOUNT_CONFLICT'; END IF;
  IF o.id IS NULL THEN INSERT INTO qf.operator(id,label,role,status) VALUES(target,'account-'||target::text,'operator','active') RETURNING * INTO o; END IF;
 ELSIF action_name='enroll' THEN
  IF o.id IS NULL OR o.credential_digest IS NULL OR o.password_hash IS NOT NULL THEN RAISE EXCEPTION 'ACCOUNT_CONFLICT'; END IF;
 ELSIF action_name='disable' THEN
  IF o.id IS NULL THEN RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
  IF o.status='disabled' THEN RETURN jsonb_build_object('account',qf.account_dto(o),'first',false,'changed',false); END IF;
  IF o.role='admin' AND o.status='active' AND o.password_hash IS NOT NULL AND o.login_name IS NOT NULL AND NOT EXISTS(SELECT 1 FROM qf.operator WHERE id<>o.id AND role='admin' AND status='active' AND login_name IS NOT NULL AND password_hash IS NOT NULL) THEN RAISE EXCEPTION 'LAST_ACTIVE_ADMIN'; END IF;
  UPDATE qf.operator SET status='disabled',disabled_at=coalesce(disabled_at,clock_timestamp()),account_revision=account_revision+1 WHERE id=target;
  PERFORM qf.account_revoke(target);
  answer:=qf.account_record(op,NULL,target,'disable',binding_value);
  SELECT * INTO o FROM qf.operator WHERE id=target;
  RETURN answer||jsonb_build_object('account',qf.account_dto(o),'first',true,'changed',true);
 ELSIF action_name='admin-recovery' THEN
  IF o.id IS NULL OR o.role<>'admin' OR o.password_hash IS NULL OR o.login_name IS NULL THEN RAISE EXCEPTION 'ACCOUNT_CONFLICT'; END IF;
 ELSE RAISE EXCEPTION 'INVALID_REQUEST'; END IF;
 IF o.status<>'active' THEN RAISE EXCEPTION 'ACCOUNT_CONFLICT'; END IF;
 IF action_name<>'admin-recovery' THEN
  IF o.login_name IS NOT NULL AND o.login_name<>p->>'loginName' THEN RAISE EXCEPTION 'ACCOUNT_CONFLICT'; END IF;
  UPDATE qf.operator SET login_name=p->>'loginName',display_name=p->>'displayName',account_revision=account_revision+1 WHERE id=target;
 ELSE UPDATE qf.operator SET account_revision=account_revision+1 WHERE id=target; END IF;
 link:=qf.account_issue(target,CASE action_name WHEN 'enroll' THEN 'setup' ELSE action_name END,p->>'tokenDigest',(p->>'tokenId')::uuid,NULL,op);
 answer:=qf.account_record(op,NULL,target,action_name,binding_value);
 SELECT * INTO o FROM qf.operator WHERE id=target;
 RETURN answer||jsonb_build_object('account',qf.account_dto(o),'passwordSetup',link,'first',true);
END $$;
REVOKE ALL ON qf.operator_password_token,qf.operator_account_operation,qf.operator_kdf_attempt FROM PUBLIC;
REVOKE ALL ON FUNCTION qf.account_dto(qf.operator),qf.account_operation_dto(qf.operator_account_operation),qf.account_actor(text),qf.account_record(uuid,uuid,uuid,text,jsonb,uuid,text),qf.account_revoke(uuid),qf.account_issue(uuid,text,text,uuid,uuid,uuid),qf.account_command(text,text,jsonb),qf.account_password(text,text,jsonb),qf.account_local(jsonb) FROM PUBLIC;
