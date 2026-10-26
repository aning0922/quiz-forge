-- Read-only account directory projections. Existing commands, tables and secrets remain unchanged.
CREATE FUNCTION qf.account_directory_read(mode text,digest text,p jsonb)
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
    lower(coalesce(o.login_name,'')||' '||coalesce(o.display_name,o.label)) search_text FROM qf.operator o
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
    qf.account_operation_dto(r)||jsonb_build_object('actorDisplayName',coalesce(a.display_name,a.label),'targetDisplayName',coalesce(t.display_name,t.label)) v,
    lower(coalesce(a.display_name,a.label,'')||' '||coalesce(a.login_name,'')||' '||coalesce(t.display_name,t.label)||' '||coalesce(t.login_name,'')) search_text
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
REVOKE ALL ON FUNCTION qf.account_directory_read(text,text,jsonb) FROM PUBLIC;
