-- B2-2B text authority. Constraints prove DB relationships, not P1 execution or filesystem bytes.
CREATE FUNCTION qf.sha256_utf8(t text) RETURNS text LANGUAGE sql IMMUTABLE STRICT SET search_path=pg_catalog AS $$ SELECT encode(sha256(convert_to(t,'UTF8')),'hex') $$;
CREATE FUNCTION qf.validation_attempts_valid(t text, f integer, current_id uuid, reserved bigint) RETURNS boolean
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
  IF (SELECT count(*) FROM jsonb_object_keys(item))<>9 OR NOT(item ?& ARRAY['attemptId','ordinal','fence','ownerPid','ownerNonce','kind','reservationBytes','disposition','mediaStop']) THEN RETURN false; END IF;
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
CREATE FUNCTION qf.validation_evidence_valid(t text, reports text[], metadata text, controls text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE e jsonb; m jsonb; a jsonb; item jsonb; r jsonb; report text; prior integer := 0; ordinal integer; n integer := 0; bytes bigint := 0;
BEGIN
 IF current_setting('server_encoding')<>'UTF8' OR current_setting('client_encoding')<>'UTF8' OR reports IS NULL OR controls IS NULL OR octet_length(controls)>8192 THEN RETURN false; END IF;
 IF cardinality(reports)>3 OR (cardinality(reports)>0 AND (array_ndims(reports)<>1 OR array_lower(reports,1)<>1)) THEN RETURN false; END IF;
 IF t IS NULL THEN RETURN (metadata IS NULL AND cardinality(reports)=0) IS TRUE; END IF;
 IF metadata IS NULL OR octet_length(t) NOT BETWEEN 2 AND 1048576 OR octet_length(metadata)+octet_length(controls)>65536 THEN RETURN false; END IF;
 e:=t::jsonb; m:=e; a:=controls::jsonb;
 IF (jsonb_typeof(e)='object' AND (SELECT count(*) FROM jsonb_object_keys(e))=2 AND e->>'schemaVersion'='quizpack-evidence-envelope.v1' AND jsonb_typeof(e->'attempts')='array') IS NOT TRUE THEN RETURN false; END IF;
 IF jsonb_array_length(e->'attempts') NOT BETWEEN 1 AND 3 THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(e->'attempts') LOOP
  IF (jsonb_typeof(item)='object' AND (SELECT count(*) FROM jsonb_object_keys(item))=2 AND jsonb_typeof(item->'attempt')='number' AND (item->>'attempt') ~ '^[1-3]$') IS NOT TRUE THEN RETURN false; END IF;
  ordinal:=(item->>'attempt')::integer;
  IF ordinal<=prior OR (a->(ordinal-1)->>'kind'='validate') IS NOT TRUE THEN RETURN false; END IF;
  prior:=ordinal; r:=item#>'{result,evidence,report}';
  IF r->>'status'='sealed' THEN
   n:=n+1; report:=reports[n];
   IF report IS NULL OR octet_length(report) NOT BETWEEN 1 AND 262144 THEN RETURN false; END IF;
   bytes:=bytes+octet_length(report);
   IF (report::jsonb=r->'value' AND r->>'sha256'=qf.sha256_utf8(report) AND r->'canonicalBytes'=to_jsonb(octet_length(report)) AND r#>'{value,importable}'='false'::jsonb AND r#>'{value,publishable}'='false'::jsonb) IS NOT TRUE THEN RETURN false; END IF;
   m:=jsonb_set(m,ARRAY['attempts',((SELECT count(*) FROM jsonb_array_elements(e->'attempts') x WHERE (x->>'attempt')::integer<=ordinal)-1)::text,'result','evidence','report','value'],'null'::jsonb,false);
  ELSIF (r->>'status' IN ('not-run','invalid')) IS NOT TRUE THEN RETURN false;
  END IF;
 END LOOP;
 RETURN (n=cardinality(reports) AND bytes<=786432 AND metadata::jsonb=m) IS TRUE;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TABLE qf.quizpack_validation (
 id uuid PRIMARY KEY,
 product_id varchar(80) NOT NULL REFERENCES qf.product(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 import_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES qf.operator(id) ON DELETE RESTRICT,
 created_at timestamptz NOT NULL,
 validation_key char(64) NOT NULL CHECK(validation_key ~ '^[0-9a-f]{64}$'),
 archive_sha256 char(64) NOT NULL CHECK(archive_sha256 ~ '^[0-9a-f]{64}$'),
 archive_bytes integer NOT NULL CHECK(archive_bytes BETWEEN 1 AND 33554432),
 identity_text text NOT NULL CHECK(octet_length(identity_text) BETWEEN 2 AND 16384),
 identity_sha256 char(64) NOT NULL CHECK(identity_sha256 ~ '^[0-9a-f]{64}$'),
 archive_policy_version varchar(64) NOT NULL,
 archive_policy_sha256 char(64) NOT NULL CHECK(archive_policy_sha256 ~ '^[0-9a-f]{64}$'),
 status text NOT NULL CHECK(status IN ('validating','validated','archiving','ready','rejected','retryable-failed')),
 state_revision integer NOT NULL CHECK(state_revision BETWEEN 1 AND 2147483647),
 updated_at timestamptz NOT NULL CHECK(updated_at >= created_at),
 fence integer NOT NULL CHECK(fence BETWEEN 1 AND 2147483647),
 lease_until timestamptz,
 current_attempt_id uuid NOT NULL,
 attempts_text text NOT NULL CHECK(octet_length(attempts_text) BETWEEN 2 AND 8192),
 storage_condition text NOT NULL CHECK(storage_condition IN ('clean','cleanup-required','unknown')),
 last_error_code varchar(64) CHECK(last_error_code IN (
   'VALIDATION_TIMEOUT','VALIDATION_CANCELLED','VALIDATION_LOCK_LOST',
   'VALIDATION_RECOVERY_REQUIRED','VALIDATION_STORAGE_CONFLICT','VALIDATION_SCAN_LIMIT',
   'VALIDATION_QUOTA_EXCEEDED','VALIDATION_STATE_CONFLICT','VALIDATION_IDENTITY_CHANGED',
   'VALIDATION_REVALIDATION_REQUIRED','VALIDATION_ATTEMPT_LIMIT','VALIDATION_REJECTED',
   'PACK_IDENTITY_CONFLICT','RESOURCE_DECLARATION_CONFLICT','MEDIA_UNAVAILABLE',
   'EVIDENCE_INVALID','WRITE_OUTCOME_UNKNOWN','STUDIO_UNAVAILABLE')),
 reserved_bytes bigint NOT NULL CHECK(reserved_bytes BETWEEN 0 AND 536870912),
 accounted_bytes bigint NOT NULL CHECK(accounted_bytes BETWEEN 0 AND 536870912),
 evidence_text text CHECK(octet_length(evidence_text) BETWEEN 2 AND 1048576),
 evidence_sha256 char(64) CHECK(evidence_sha256 ~ '^[0-9a-f]{64}$'),
 report_texts text[] NOT NULL DEFAULT '{}',
 evidence_metadata_text text CHECK(octet_length(evidence_metadata_text) BETWEEN 2 AND 65536),
 pack_id varchar(80), pack_version varchar(32),
 container_schema_version varchar(64), content_schema_version varchar(64), content_kind varchar(32),
 manifest_sha256 char(64), content_sha256 char(64),
 canonical_manifest_text text CHECK(octet_length(canonical_manifest_text) BETWEEN 2 AND 524288),
 canonical_manifest_sha256 char(64),
 canonical_content_text text CHECK(octet_length(canonical_content_text) BETWEEN 2 AND 2097152),
 canonical_content_sha256 char(64),
 asset_set_text text CHECK(octet_length(asset_set_text) BETWEEN 2 AND 65536),
 asset_set_sha256 char(64), candidate_sha256 char(64),
 resource_count smallint CHECK(resource_count BETWEEN 1 AND 64),
 identity_kind text NOT NULL CHECK(identity_kind IN ('unclaimed','canonical','alias','conflict')),
 canonical_validation_id uuid,
 validated_at timestamptz,
 ready_at timestamptz,
 UNIQUE(product_id,id), UNIQUE(import_id,validation_key),
 FOREIGN KEY(product_id,import_id) REFERENCES qf.quizpack_import(product_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 FOREIGN KEY(product_id,canonical_validation_id) REFERENCES qf.quizpack_validation(product_id,id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK(canonical_validation_id IS NULL OR canonical_validation_id <> id),
 CHECK(qf.validation_attempts_valid(attempts_text,fence,current_attempt_id,reserved_bytes)),
 CHECK(qf.validation_evidence_valid(evidence_text,report_texts,evidence_metadata_text,attempts_text)),
 CHECK(((evidence_text IS NULL AND evidence_sha256 IS NULL)
    OR (evidence_text IS NOT NULL AND evidence_sha256 IS NOT NULL
        AND evidence_sha256=qf.sha256_utf8(evidence_text))) IS TRUE)
);
CREATE UNIQUE INDEX validation_canonical_pack
 ON qf.quizpack_validation(product_id,pack_id,pack_version) WHERE identity_kind='canonical';
CREATE INDEX validation_import_created ON qf.quizpack_validation(product_id,import_id,created_at DESC,id DESC);
CREATE INDEX validation_product_pending ON qf.quizpack_validation(product_id,id)
 WHERE status NOT IN ('ready','rejected') OR storage_condition <> 'clean' OR reserved_bytes > 0;
CREATE INDEX validation_held ON qf.quizpack_validation(id) WHERE reserved_bytes > 0;
CREATE INDEX validation_alias_target ON qf.quizpack_validation(product_id,canonical_validation_id)
 WHERE canonical_validation_id IS NOT NULL;

CREATE TABLE qf.asset_blob (
 sha256 char(64) PRIMARY KEY CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 bytes integer NOT NULL CHECK(bytes BETWEEN 1 AND 8388608),
 media_type varchar(32) NOT NULL CHECK(media_type IN ('image/png','image/jpeg','image/webp')),
 width integer NOT NULL CHECK(width BETWEEN 1 AND 8192),
 height integer NOT NULL CHECK(height BETWEEN 1 AND 8192),
 frames smallint NOT NULL CHECK(frames=1),
 storage_key varchar(96) NOT NULL UNIQUE,
 created_at timestamptz NOT NULL,
 CHECK(width::bigint*height::bigint <= 16000000),
 CHECK(storage_key='blobs/'||sha256::text||'.blob')
);

CREATE FUNCTION qf.product_asset_declaration_valid(pid text, rid text, ver text, sha text, purpose text, declaration text) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE d jsonb; b qf.asset_blob;
BEGIN
 IF declaration IS NULL OR octet_length(declaration) NOT BETWEEN 2 AND 65536 THEN RETURN false; END IF;
 d:=declaration::jsonb; SELECT * INTO b FROM qf.asset_blob WHERE sha256=sha;
 RETURN (jsonb_typeof(d)='object' AND d->>'id'=rid AND d->>'productId'=pid AND d->>'version'=ver AND d->>'sha256'=sha AND d->>'purpose'=purpose
  AND d->'bytes'=to_jsonb(b.bytes) AND d->>'mediaType'=b.media_type AND d->'width'=to_jsonb(b.width) AND d->'height'=to_jsonb(b.height) AND b.frames=1
  AND d#>'{license,commercialUse}'='true'::jsonb AND d#>'{license,redistribution}'='true'::jsonb) IS TRUE;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE TABLE qf.product_asset (
 product_id varchar(80) NOT NULL REFERENCES qf.product(id) ON DELETE RESTRICT ON UPDATE RESTRICT,
 resource_id varchar(80) NOT NULL CHECK(resource_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
 resource_version varchar(32) NOT NULL CHECK(resource_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$'),
 blob_sha256 char(64) NOT NULL REFERENCES qf.asset_blob(sha256) ON DELETE RESTRICT ON UPDATE RESTRICT,
 declaration_text text NOT NULL CHECK(octet_length(declaration_text) BETWEEN 2 AND 65536),
 declaration_sha256 char(64) NOT NULL CHECK(declaration_sha256 ~ '^[0-9a-f]{64}$'),
 purpose varchar(16) NOT NULL CHECK(purpose IN ('cover','portrait','decoration')),
 source_validation_id uuid NOT NULL,
 platform_approval varchar(16) NOT NULL DEFAULT 'unverified' CHECK(platform_approval='unverified'),
 created_at timestamptz NOT NULL,
 PRIMARY KEY(product_id,resource_id,resource_version),
 FOREIGN KEY(product_id,source_validation_id) REFERENCES qf.quizpack_validation(product_id,id)
   ON DELETE RESTRICT ON UPDATE RESTRICT,
 CHECK(declaration_sha256=qf.sha256_utf8(declaration_text)),
 CHECK(qf.product_asset_declaration_valid(product_id,resource_id,resource_version,blob_sha256,purpose,declaration_text))
);
CREATE INDEX product_asset_source ON qf.product_asset(product_id,source_validation_id);
CREATE FUNCTION qf.validation_shape_valid(v qf.quizpack_validation) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE ident jsonb; man jsonb; content jsonb; aset jsonb; item jsonb; declaration jsonb; evidence jsonb; accepted jsonb; seen text[]:='{}'; prior_id text:=NULL; prior_version text:=NULL; key_text text;
BEGIN
 ident:=v.identity_text::jsonb;
 IF (jsonb_typeof(ident)='object' AND (SELECT count(*) FROM jsonb_object_keys(ident))=12
  AND ident ?& ARRAY['schemaVersion','validatorVersion','policyId','validatorBundleSha256','compatibilityPolicyHash','effectiveLimitsHash','persistencePolicyVersion','persistencePolicyHash','reportSchemaVersion','reportSchemaHash','runtime','identitySha256']
  AND ident->>'validatorVersion' ~ '^[!-~]{1,64}$' AND ident->>'policyId' ~ '^[!-~]{1,64}$'
  AND ident->>'persistencePolicyVersion' ~ '^[!-~]{1,64}$' AND ident->>'reportSchemaVersion' ~ '^[!-~]{1,64}$'
  AND ident->>'compatibilityPolicyHash' ~ '^[0-9a-f]{64}$' AND ident->>'effectiveLimitsHash' ~ '^[0-9a-f]{64}$'
  AND ident->>'persistencePolicyHash' ~ '^[0-9a-f]{64}$' AND ident->>'reportSchemaHash' ~ '^[0-9a-f]{64}$'
  AND jsonb_typeof(ident->'runtime')='object' AND (SELECT count(*) FROM jsonb_object_keys(ident->'runtime'))=6
  AND ident->'runtime' ?& ARRAY['schema','platform','componentId','deploymentId','runtimeBundleHash','limitsHash']
  AND ident#>>'{runtime,schema}'='quizpack-media-runtime-binding.v1' AND ident#>>'{runtime,platform}' IN ('darwin-arm64','linux-x64')
  AND ident#>>'{runtime,componentId}' ~ '^[0-9a-f]{64}$' AND ident#>>'{runtime,deploymentId}' ~ '^[0-9a-f]{64}$'
  AND ident#>>'{runtime,limitsHash}' ~ '^[0-9a-f]{64}$' AND ident->>'schemaVersion'='quizpack-validation-identity.v1' AND ident->>'identitySha256'=v.identity_sha256 AND ident->>'validatorBundleSha256' ~ '^[0-9a-f]{64}$'
  AND ident#>>'{runtime,runtimeBundleHash}'=ident->>'validatorBundleSha256' AND v.archive_policy_version ~ '^[!-~]{1,64}$') IS NOT TRUE THEN RETURN false; END IF;
 key_text:='{"archiveBytes":'||v.archive_bytes::text||',"archivePolicySha256":'||to_json(v.archive_policy_sha256::text)::text||',"archivePolicyVersion":'||to_json(v.archive_policy_version)::text||',"archiveSha256":'||to_json(v.archive_sha256::text)::text||',"identitySha256":'||to_json(v.identity_sha256::text)::text||',"importId":'||to_json(v.import_id::text)::text||',"productId":'||to_json(v.product_id)::text||',"schemaVersion":"quizpack-validation-key.v1"}';
 IF (qf.sha256_utf8(key_text)=v.validation_key) IS NOT TRUE THEN RETURN false; END IF;
 IF v.lease_until IS NOT NULL AND v.lease_until>clock_timestamp()+interval '120 seconds' THEN RETURN false; END IF;
 IF v.validated_at IS NULL THEN
  IF ROW(v.pack_id,v.pack_version,v.container_schema_version,v.content_schema_version,v.content_kind,v.manifest_sha256,v.content_sha256,v.canonical_manifest_text,v.canonical_manifest_sha256,v.canonical_content_text,v.canonical_content_sha256,v.asset_set_text,v.asset_set_sha256,v.candidate_sha256,v.resource_count) IS DISTINCT FROM ROW(NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,NULL::char,NULL::char,NULL::text,NULL::char,NULL::text,NULL::char,NULL::text,NULL::char,NULL::char,NULL::smallint) OR v.identity_kind<>'unclaimed' OR v.canonical_validation_id IS NOT NULL OR v.status IN ('validated','archiving','ready') THEN RETURN false; END IF;
 ELSE
  IF (v.pack_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND v.pack_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' AND v.container_schema_version ~ '^[!-~]{1,64}$' AND v.content_schema_version ~ '^[!-~]{1,64}$' AND v.content_kind='synthetic'
   AND v.manifest_sha256 ~ '^[0-9a-f]{64}$' AND v.content_sha256 ~ '^[0-9a-f]{64}$' AND v.candidate_sha256 ~ '^[0-9a-f]{64}$'
   AND v.canonical_manifest_sha256=qf.sha256_utf8(v.canonical_manifest_text) AND v.canonical_content_sha256=qf.sha256_utf8(v.canonical_content_text) AND v.asset_set_sha256=qf.sha256_utf8(v.asset_set_text)
   AND v.validated_at>=v.created_at AND v.resource_count BETWEEN 1 AND 64 AND v.identity_kind IN ('canonical','alias','conflict') AND v.status<>'validating') IS NOT TRUE THEN RETURN false; END IF;
  IF (v.identity_kind='alias') IS DISTINCT FROM (v.canonical_validation_id IS NOT NULL) THEN RETURN false; END IF;
  IF v.identity_kind='conflict' AND v.status<>'rejected' THEN RETURN false; END IF;
  man:=v.canonical_manifest_text::jsonb; content:=v.canonical_content_text::jsonb; aset:=v.asset_set_text::jsonb;
  IF (man->>'productId'=v.product_id AND content#>>'{product,productId}'=v.product_id AND man->>'packId'=v.pack_id AND man->>'packVersion'=v.pack_version
    AND man->>'schemaVersion'=v.container_schema_version AND man->>'contentSchemaVersion'=v.content_schema_version AND content->>'schemaVersion'=v.content_schema_version AND content->>'kind'=v.content_kind
    AND jsonb_typeof(content->'resources')='array' AND jsonb_typeof(aset)='object' AND (SELECT count(*) FROM jsonb_object_keys(aset))=3 AND aset->>'schemaVersion'='quizpack-candidate-asset-set.v1' AND aset->>'productId'=v.product_id AND jsonb_typeof(aset->'resources')='array') IS NOT TRUE THEN RETURN false; END IF;
  IF jsonb_array_length(aset->'resources')<>v.resource_count OR jsonb_array_length(content->'resources')<>v.resource_count THEN RETURN false; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(aset->'resources') LOOP
   IF (jsonb_typeof(item)='object' AND (SELECT count(*) FROM jsonb_object_keys(item))=5 AND item->>'productId'=v.product_id AND item->>'resourceId' ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND item->>'resourceVersion' ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' AND item->>'blobSha256' ~ '^[0-9a-f]{64}$' AND item->>'declarationSha256' ~ '^[0-9a-f]{64}$') IS NOT TRUE THEN RETURN false; END IF;
   key_text:=(item->>'productId')||'/'||(item->>'resourceId')||'/'||(item->>'resourceVersion');
   IF key_text=ANY(seen) OR (prior_id IS NOT NULL AND ((item->>'resourceId') COLLATE "C"<prior_id COLLATE "C" OR ((item->>'resourceId')=prior_id AND (item->>'resourceVersion') COLLATE "C"<=prior_version COLLATE "C"))) THEN RETURN false; END IF; seen:=array_append(seen,key_text); prior_id:=item->>'resourceId'; prior_version:=item->>'resourceVersion';
   SELECT value INTO declaration FROM jsonb_array_elements(content->'resources') WHERE value->>'productId'=v.product_id AND value->>'id'=item->>'resourceId' AND value->>'version'=item->>'resourceVersion';
   IF (declaration->>'sha256'=item->>'blobSha256') IS NOT TRUE OR (SELECT count(*) FROM jsonb_array_elements(content->'resources') WHERE value->>'productId'=v.product_id AND value->>'id'=item->>'resourceId' AND value->>'version'=item->>'resourceVersion')<>1 THEN RETURN false; END IF;
  END LOOP;
  IF v.evidence_text IS NULL THEN RETURN false; END IF;
 END IF;
 IF v.evidence_text IS NOT NULL THEN
  evidence:=v.evidence_text::jsonb;
  FOR item IN SELECT value FROM jsonb_array_elements(evidence->'attempts') LOOP
   IF (item#>>'{result,evidence,input,status}'='snapshotted' AND item#>>'{result,evidence,input,targetProductId}'=v.product_id AND item#>>'{result,evidence,input,archiveSha256}'=v.archive_sha256 AND item#>'{result,evidence,input,archiveBytes}'=to_jsonb(v.archive_bytes)
     AND item#>>'{result,evidence,identity,status}'='bound' AND item#>>'{result,evidence,identity,value,identitySha256}'=v.identity_sha256) IS NOT TRUE THEN RETURN false; END IF;
   IF item#>>'{result,outcome}'='accepted' THEN
    accepted:=item;
    IF (item#>>'{result,evidence,report,status}'='sealed' AND item#>'{result,evidence,report,value,candidateValid}'='true'::jsonb AND item#>>'{result,evidence,policy,status}'='passed'
      AND item#>>'{result,evidence,report,value,manifestSha256}'=v.manifest_sha256 AND item#>>'{result,evidence,report,value,contentSha256}'=v.content_sha256) IS NOT TRUE THEN RETURN false; END IF;
   END IF;
  END LOOP;
  IF v.validated_at IS NOT NULL AND accepted IS NULL THEN RETURN false; END IF;
 END IF;
 IF v.status='ready' THEN
  RETURN (v.ready_at>=v.validated_at AND v.identity_kind IN ('canonical','alias') AND v.storage_condition='clean' AND v.reserved_bytes=0 AND v.lease_until IS NULL AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v.attempts_text::jsonb) a WHERE a->>'disposition'<>'released' OR a->>'mediaStop'='unconfirmed')) IS TRUE;
 END IF;
 IF v.ready_at IS NOT NULL THEN RETURN false; END IF;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
CREATE FUNCTION qf.protect_validation() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
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
   IF (olditem-'disposition'-'mediaStop') IS DISTINCT FROM (newitem-'disposition'-'mediaStop') OR (olditem->>'disposition'='released' AND newitem->>'disposition'<>'released')
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
CREATE TRIGGER protect_validation BEFORE INSERT OR UPDATE ON qf.quizpack_validation FOR EACH ROW EXECUTE FUNCTION qf.protect_validation();
CREATE FUNCTION qf.protect_product_asset() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v qf.quizpack_validation; item jsonb; declaration jsonb;
BEGIN
 SELECT * INTO v FROM qf.quizpack_validation WHERE product_id=NEW.product_id AND id=NEW.source_validation_id;
 IF v.validated_at IS NULL THEN RAISE EXCEPTION 'ASSET_SOURCE' USING ERRCODE='23514'; END IF;
 SELECT value INTO item FROM jsonb_array_elements(v.asset_set_text::jsonb->'resources') WHERE value->>'productId'=NEW.product_id AND value->>'resourceId'=NEW.resource_id AND value->>'resourceVersion'=NEW.resource_version;
 SELECT value INTO declaration FROM jsonb_array_elements(v.canonical_content_text::jsonb->'resources') WHERE value->>'productId'=NEW.product_id AND value->>'id'=NEW.resource_id AND value->>'version'=NEW.resource_version;
 IF (item->>'blobSha256'=NEW.blob_sha256 AND item->>'declarationSha256'=NEW.declaration_sha256 AND declaration=NEW.declaration_text::jsonb) IS NOT TRUE THEN RAISE EXCEPTION 'ASSET_SET' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_product_asset BEFORE INSERT ON qf.product_asset FOR EACH ROW EXECUTE FUNCTION qf.protect_product_asset();
CREATE FUNCTION qf.validation_ready_assets() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE v qf.quizpack_validation; item jsonb; p qf.product_asset; declaration jsonb; count integer:=0;
BEGIN
 SELECT * INTO v FROM qf.quizpack_validation WHERE id=NEW.id;
 IF v.status<>'ready' THEN RETURN NULL; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(v.asset_set_text::jsonb->'resources') LOOP
  SELECT * INTO p FROM qf.product_asset WHERE product_id=v.product_id AND resource_id=item->>'resourceId' AND resource_version=item->>'resourceVersion';
  SELECT value INTO declaration FROM jsonb_array_elements(v.canonical_content_text::jsonb->'resources') WHERE value->>'productId'=v.product_id AND value->>'id'=item->>'resourceId' AND value->>'version'=item->>'resourceVersion';
  IF (p.blob_sha256=item->>'blobSha256' AND p.declaration_sha256=item->>'declarationSha256' AND p.declaration_text::jsonb=declaration AND qf.product_asset_declaration_valid(p.product_id,p.resource_id,p.resource_version,p.blob_sha256,p.purpose,p.declaration_text)) IS NOT TRUE THEN RAISE EXCEPTION 'VALIDATION_ASSET_INCOMPLETE' USING ERRCODE='23514'; END IF;
  count:=count+1;
 END LOOP;
 IF count<>v.resource_count THEN RAISE EXCEPTION 'VALIDATION_ASSET_INCOMPLETE' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER validation_ready_assets AFTER INSERT OR UPDATE ON qf.quizpack_validation DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qf.validation_ready_assets();
CREATE FUNCTION qf.product_asset_ready_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM qf.quizpack_validation WHERE id=NEW.source_validation_id AND product_id=NEW.product_id AND status='ready') THEN RAISE EXCEPTION 'ASSET_SOURCE_NOT_READY' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER product_asset_ready_source AFTER INSERT ON qf.product_asset DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION qf.product_asset_ready_source();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA qf FROM PUBLIC;
REVOKE ALL ON qf.quizpack_validation,qf.asset_blob,qf.product_asset FROM PUBLIC;

ALTER TABLE qf.audit_event ALTER COLUMN target_kind TYPE varchar(16);
ALTER TABLE qf.audit_event DROP CONSTRAINT audit_target;
ALTER TABLE qf.audit_event ADD CONSTRAINT audit_target CHECK (
 (target_kind IS NULL AND target_id IS NULL AND target_revision IS NULL AND action IN ('bootstrap','operator_disabled','preauth_created','login_succeeded','login_failed','logout','session_revoked'))
 OR (target_kind IS NOT NULL AND target_id IS NOT NULL AND target_revision IS NOT NULL AND target_revision >= 1
 AND actor_id IS NOT NULL AND session_id IS NOT NULL AND outcome = 'success' AND reason_code IS NULL
 AND ((target_kind = 'product' AND target_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND action IN ('product_created','product_updated','product_archived','product_restored'))
 OR (target_kind = 'category' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('category_created','category_updated','category_archived','category_restored'))
 OR (target_kind = 'tag' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('tag_created','tag_updated','tag_archived','tag_restored'))
 OR (target_kind = 'validation' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('validation_started','validation_evidenced','validation_rejected','validation_interrupted','validation_completed','validation_recovered','validation_retried'))
 OR (target_kind = 'import' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('import_intent_created','import_receive_started','import_receive_completed','import_receive_failed','import_receive_recovered'))))
);

