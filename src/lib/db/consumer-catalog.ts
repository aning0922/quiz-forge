import "server-only";
/** OID-independent PG18 catalog facts. Internal trigger names contain OIDs and are represented by their exact structural facts. */
export const CONSUMER_CATALOG_QUERY = `
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
SELECT value,encode(sha256(convert_to(value::text,'UTF8')),'hex') sha256 FROM facts`;

/** Fresh bootstrap grants app privileges only after all migration DDL; upgrade preflight compares structure. */
export const CONSUMER_STRUCTURE_QUERY = `
WITH snapshot AS (${CONSUMER_CATALOG_QUERY}), reduced AS (
 SELECT value || jsonb_build_object(
   'tables',(SELECT jsonb_agg(x-'acl' ORDER BY n) FROM jsonb_array_elements(value->'tables') WITH ORDINALITY t(x,n)),
   'columns',(SELECT jsonb_agg(x-'acl' ORDER BY n) FROM jsonb_array_elements(value->'columns') WITH ORDINALITY t(x,n)),
   'functions',(SELECT jsonb_agg(x-'acl' ORDER BY n) FROM jsonb_array_elements(value->'functions') WITH ORDINALITY t(x,n))
 ) AS value FROM snapshot
) SELECT value,encode(sha256(convert_to(value::text,'UTF8')),'hex') sha256 FROM reduced`;
