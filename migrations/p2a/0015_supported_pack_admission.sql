-- Supported package admission. Old writers and owned file/media IO must be stopped.
-- This migration only checks quiescence; it never invents ACKs or rewrites history.
LOCK TABLE qf.quizpack_import,qf.quizpack_validation IN SHARE ROW EXCLUSIVE MODE NOWAIT;
DO $$
DECLARE expected record; actual record;
BEGIN
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
   AND usename=replace(current_user,'qf_owner_','qf_app_') AND pid<>pg_backend_pid())
 THEN RAISE EXCEPTION 'ADMISSION_WRITERS_PRESENT' USING ERRCODE='55000'; END IF;
 FOR expected IN SELECT * FROM (VALUES
('qf.sha256_utf8(text)','a7668c5ec5661ce809cf17b0d9c7ceee93b8da13ea8408fe0ebf5c71ad030a91','sql','i',true,'text'),
('qf.import_attempts_valid(jsonb,integer,uuid,bigint)','e8fe07a3c840b7f7c2164c34e3b485e9948e3bfc4c6b2e06dfe31494f094e4c1','plpgsql','i',false,'boolean'),
('qf.validation_attempts_valid(text,integer,uuid,bigint)','2a0bf4bcdda05964e145ce6c3a178a549bb6672534b04dc5a816c33b6ae7c2c7','plpgsql','i',false,'boolean'),
('qf.validation_file_stop_protocol()','6c93e6e80abd2e60faf5e4f6247150e9ede92973be16f0d5ff43b748119f14c9','sql','i',false,'text'),
('qf.validation_file_stop_proof_valid(jsonb,uuid,jsonb)','7a19b33d5aa36d1baccb4b6c6e62001043856a623dd03dd9c716e2d9a2d12f94','plpgsql','i',false,'boolean'),
('qf.validation_file_stop_controls_valid(text,uuid,text,text)','2a5910e875cb5b94e2b6c679fa3214ea29e6c24e653c37aa952a3184c8638e14','plpgsql','i',false,'boolean'),
('qf.validation_shape_valid(qf.quizpack_validation)','14e724ca1ad9a1f01bd6a9e1174dfcf3c3b66747e1ec4f0225efa7a8c1d16bdd','plpgsql','s',false,'boolean'),
('qf.protect_validation()','b0943587540e4737ce009e959b0220523d3a9e34f7c19d14e2dd5bc29b525134','plpgsql','v',false,'trigger'),
('qf.protect_validation_file_stop_ack()','08076af27da2c017ebb5777ee241daafda63e877d018e5f4a9dd0e4ec755592c','plpgsql','v',false,'trigger'),
('qf.protect_draft_revision_source()','aa55adea69942f6f5d84b8573d1c9bdd3cb70e2736103966ac4647362370ee14','plpgsql','v',false,'trigger')) AS x(signature,sha256,language_name,volatility,is_strict,result_type) LOOP
  SELECT encode(sha256(convert_to(p.prosrc,'UTF8')),'hex') AS sha256,l.lanname AS language_name,p.provolatile::text AS volatility,p.proisstrict AS is_strict,
   p.prorettype::regtype::text AS result_type,
   (NOT p.prosecdef AND NOT p.proretset AND NOT p.proleakproof AND p.prokind='f' AND p.pronargdefaults=0 AND p.proconfig=ARRAY['search_path=pg_catalog']) AS attributes
   INTO actual FROM pg_proc p JOIN pg_language l ON l.oid=p.prolang WHERE p.oid=to_regprocedure(expected.signature);
  IF actual.sha256 IS DISTINCT FROM expected.sha256 OR actual.language_name IS DISTINCT FROM expected.language_name
    OR actual.volatility IS DISTINCT FROM expected.volatility OR actual.is_strict IS DISTINCT FROM expected.is_strict
    OR actual.result_type IS DISTINCT FROM expected.result_type OR actual.attributes IS DISTINCT FROM true
  THEN RAISE EXCEPTION 'ADMISSION_PREVIOUS_HELPER_CHANGED' USING ERRCODE='55000'; END IF;
 END LOOP;
 IF EXISTS(SELECT 1 FROM qf.quizpack_import i WHERE i.status='receiving' OR i.storage_condition IS DISTINCT FROM 'clean'
   OR i.reserved_bytes IS DISTINCT FROM 0::bigint OR i.lease_until IS NOT NULL
   OR qf.import_attempts_valid(i.attempts,i.fence,i.current_attempt_id,i.reserved_bytes) IS NOT TRUE
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(i.attempts) a WHERE (a->>'disposition') IS DISTINCT FROM 'released'))
 OR EXISTS(SELECT 1 FROM qf.quizpack_validation v WHERE v.status IN ('validating','archiving') OR v.storage_condition IS DISTINCT FROM 'clean'
   OR v.reserved_bytes IS DISTINCT FROM 0::bigint OR v.lease_until IS NOT NULL
   OR qf.validation_attempts_valid(v.attempts_text,v.fence,v.current_attempt_id,v.reserved_bytes) IS NOT TRUE
   OR qf.validation_file_stop_controls_valid(v.archive_policy_version,v.id,v.attempts_text,v.evidence_metadata_text) IS NOT TRUE
   OR EXISTS(SELECT 1 FROM jsonb_array_elements(v.attempts_text::jsonb) a WHERE (a->>'disposition') IS DISTINCT FROM 'released'
     OR (a->>'mediaStop' IN ('confirmed','not-started')) IS NOT TRUE))
 THEN RAISE EXCEPTION 'ADMISSION_UNSETTLED_IO' USING ERRCODE='55000'; END IF;
END $$;

CREATE OR REPLACE FUNCTION qf.validation_file_stop_controls_valid(policy text, validation_id uuid, controls text, metadata text) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path=pg_catalog AS $$
DECLARE a jsonb; item jsonb;
BEGIN
 a:=controls::jsonb;
 IF jsonb_typeof(a)<>'array' THEN RETURN false; END IF;
 IF policy='quizpack-private-archive.v1' THEN
  RETURN NOT EXISTS(SELECT 1 FROM jsonb_array_elements(a) x WHERE jsonb_typeof(x)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(x))<>9 OR x ? 'fileStopProof');
 END IF;
 IF policy NOT IN ('quizpack-private-archive.v2','quizpack-private-archive.v3') OR (metadata IS NOT NULL AND octet_length(metadata)>57344) THEN RETURN false; END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(a) LOOP
  IF (jsonb_typeof(item)='object' AND (SELECT count(*) FROM jsonb_object_keys(item))=10 AND item ? 'fileStopProof') IS NOT TRUE THEN RETURN false; END IF;
  IF item->'fileStopProof'<>'null'::jsonb AND qf.validation_file_stop_proof_valid(item->'fileStopProof',validation_id,item) IS NOT TRUE THEN RETURN false; END IF;
  IF item->>'disposition'='released' AND item->'fileStopProof'='null'::jsonb THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;

CREATE OR REPLACE FUNCTION qf.protect_validation_file_stop_ack() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE olda jsonb; newa jsonb; olditem jsonb; newitem jsonb; i integer; changes integer:=0;
BEGIN
 IF NEW.archive_policy_version<>'quizpack-private-archive.v3' OR NEW.archive_policy_sha256<>'a330bf3d82ada4bba47a395655347ad94b20ec3c00ffbde3f52a06773d3511d5' THEN RAISE EXCEPTION 'VALIDATION_LEGACY_READ_ONLY' USING ERRCODE='23514'; END IF;
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

CREATE OR REPLACE FUNCTION qf.validation_shape_valid(v qf.quizpack_validation) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path=pg_catalog AS $$
DECLARE ident jsonb; man jsonb; content jsonb; aset jsonb; item jsonb; declaration jsonb; evidence jsonb; accepted jsonb; seen text[]:='{}'; prior_id text:=NULL; prior_version text:=NULL; key_text text; current_policy boolean; component_version text; state_name text; component_id text;
BEGIN
 ident:=v.identity_text::jsonb;
 current_policy:=v.archive_policy_version='quizpack-private-archive.v3';
 IF v.archive_policy_version NOT IN ('quizpack-private-archive.v1','quizpack-private-archive.v2','quizpack-private-archive.v3') THEN RETURN false; END IF;
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
  AND ident#>>'{runtime,limitsHash}' ~ '^[0-9a-f]{64}$' AND ident->>'schemaVersion'=CASE WHEN current_policy THEN 'quizpack-validation-identity.v2' ELSE 'quizpack-validation-identity.v1' END AND ident->>'identitySha256'=v.identity_sha256 AND ident->>'validatorBundleSha256' ~ '^[0-9a-f]{64}$'
  AND ident#>>'{runtime,runtimeBundleHash}'=ident->>'validatorBundleSha256' AND v.archive_policy_version ~ '^[!-~]{1,64}$') IS NOT TRUE THEN RETURN false; END IF;
 IF current_policy THEN
  IF EXISTS(SELECT 1 FROM jsonb_each(ident) e WHERE e.key<>'runtime' AND jsonb_typeof(e.value)<>'string')
    OR EXISTS(SELECT 1 FROM jsonb_each(ident->'runtime') e WHERE jsonb_typeof(e.value)<>'string') THEN RETURN false; END IF;
  IF (v.archive_policy_sha256='a330bf3d82ada4bba47a395655347ad94b20ec3c00ffbde3f52a06773d3511d5'
   AND ident->>'validatorVersion'='2.0.0' AND ident->>'policyId'='quizpack-local-supported.v1'
   AND ident->>'reportSchemaVersion'='quizpack-validation.v2' AND ident->>'reportSchemaHash'='e7df48c0d4da4e941fa1486906b08104f5fc96b9c1a001e9489fa2eedf461867'
   AND ident->>'compatibilityPolicyHash'='a1366418639c8eac052955dae4670cf179a7c9774c8039f66cc46f78252c2899' AND ident->>'effectiveLimitsHash'='05b82df551f0210839778ca54b94a7278d44bdfd4b6dd4fc6b55105cf797dbdf'
   AND ident->>'persistencePolicyVersion'='quizpack-persistence-policy.v1' AND ident->>'persistencePolicyHash'='9ffd5e091f6f9183de746c42dbc462928dd0189b3eb8a689f4ceb1286d6104e2') IS NOT TRUE THEN RETURN false; END IF;
  key_text:='{'||'"compatibilityPolicyHash":'||to_json((ident)->>'compatibilityPolicyHash')::text||',"effectiveLimitsHash":'||to_json((ident)->>'effectiveLimitsHash')::text||',"persistencePolicyHash":'||to_json((ident)->>'persistencePolicyHash')::text||',"persistencePolicyVersion":'||to_json((ident)->>'persistencePolicyVersion')::text||',"policyId":'||to_json((ident)->>'policyId')::text||',"reportSchemaHash":'||to_json((ident)->>'reportSchemaHash')::text||',"reportSchemaVersion":'||to_json((ident)->>'reportSchemaVersion')::text||',"runtime":'||'{'||'"componentId":'||to_json((ident->'runtime')->>'componentId')::text||',"deploymentId":'||to_json((ident->'runtime')->>'deploymentId')::text||',"limitsHash":'||to_json((ident->'runtime')->>'limitsHash')::text||',"platform":'||to_json((ident->'runtime')->>'platform')::text||',"runtimeBundleHash":'||to_json((ident->'runtime')->>'runtimeBundleHash')::text||',"schema":'||to_json((ident->'runtime')->>'schema')::text||'}'||',"schemaVersion":'||to_json((ident)->>'schemaVersion')::text||',"validatorBundleSha256":'||to_json((ident)->>'validatorBundleSha256')::text||',"validatorVersion":'||to_json((ident)->>'validatorVersion')::text||'}';
  IF qf.sha256_utf8(key_text) IS DISTINCT FROM v.identity_sha256 THEN RETURN false; END IF;
 END IF;
 key_text:='{"archiveBytes":'||v.archive_bytes::text||',"archivePolicySha256":'||to_json(v.archive_policy_sha256::text)::text||',"archivePolicyVersion":'||to_json(v.archive_policy_version)::text||',"archiveSha256":'||to_json(v.archive_sha256::text)::text||',"identitySha256":'||to_json(v.identity_sha256::text)::text||',"importId":'||to_json(v.import_id::text)::text||',"productId":'||to_json(v.product_id)::text||',"schemaVersion":"quizpack-validation-key.v1"}';
 IF (qf.sha256_utf8(key_text)=v.validation_key) IS NOT TRUE THEN RETURN false; END IF;
 IF v.lease_until IS NOT NULL AND v.lease_until>clock_timestamp()+interval '120 seconds' THEN RETURN false; END IF;
 IF v.validated_at IS NULL THEN
  IF ROW(v.pack_id,v.pack_version,v.container_schema_version,v.content_schema_version,v.content_kind,v.manifest_sha256,v.content_sha256,v.canonical_manifest_text,v.canonical_manifest_sha256,v.canonical_content_text,v.canonical_content_sha256,v.asset_set_text,v.asset_set_sha256,v.candidate_sha256,v.resource_count) IS DISTINCT FROM ROW(NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,NULL::varchar,NULL::char,NULL::char,NULL::text,NULL::char,NULL::text,NULL::char,NULL::text,NULL::char,NULL::char,NULL::smallint) OR v.identity_kind<>'unclaimed' OR v.canonical_validation_id IS NOT NULL OR v.status IN ('validated','archiving','ready') THEN RETURN false; END IF;
 ELSE
  IF (v.pack_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND v.pack_version ~ '^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$' AND v.container_schema_version ~ '^[!-~]{1,64}$' AND v.content_schema_version ~ '^[!-~]{1,64}$' AND ((current_policy AND v.container_schema_version='quizpack.v1' AND v.content_schema_version IN ('quizpack-content.v1','quizpack-content.v2') AND v.content_kind IN ('synthetic','authored')) OR (NOT current_policy AND v.content_kind='synthetic'))
   AND v.manifest_sha256 ~ '^[0-9a-f]{64}$' AND v.content_sha256 ~ '^[0-9a-f]{64}$' AND v.candidate_sha256 ~ '^[0-9a-f]{64}$'
   AND v.canonical_manifest_sha256=qf.sha256_utf8(v.canonical_manifest_text) AND v.canonical_content_sha256=qf.sha256_utf8(v.canonical_content_text) AND v.asset_set_sha256=qf.sha256_utf8(v.asset_set_text)
   AND v.validated_at>=v.created_at AND v.resource_count BETWEEN 1 AND 64 AND v.identity_kind IN ('canonical','alias','conflict') AND v.status<>'validating') IS NOT TRUE THEN RETURN false; END IF;
  IF (v.identity_kind='alias') IS DISTINCT FROM (v.canonical_validation_id IS NOT NULL) THEN RETURN false; END IF;
  IF v.identity_kind='conflict' AND v.status<>'rejected' THEN RETURN false; END IF;
  man:=v.canonical_manifest_text::jsonb; content:=v.canonical_content_text::jsonb; aset:=v.asset_set_text::jsonb;
  IF (man->>'productId'=v.product_id AND content#>>'{product,productId}'=v.product_id AND man->>'packId'=v.pack_id AND man->>'packVersion'=v.pack_version
    AND man->>'schemaVersion'=v.container_schema_version AND man->>'contentSchemaVersion'=v.content_schema_version AND content->>'schemaVersion'=v.content_schema_version AND content->>'kind'=v.content_kind
    AND jsonb_typeof(content->'resources')='array' AND jsonb_typeof(aset)='object' AND (SELECT count(*) FROM jsonb_object_keys(aset))=3 AND aset->>'schemaVersion'='quizpack-candidate-asset-set.v1' AND aset->>'productId'=v.product_id AND jsonb_typeof(aset->'resources')='array') IS NOT TRUE THEN RETURN false; END IF;
  IF current_policy THEN
   component_version:=CASE v.content_schema_version WHEN 'quizpack-content.v1' THEN '1.0.0' ELSE '2.0.0' END;
   IF (content->>'componentVersion'=component_version AND content#>>'{engine,id}' IN ('dimensions','archetype')
     AND content#>>'{engine,version}'='1.0.0' AND man->'engine'=content->'engine'
     AND jsonb_typeof(man->'components')='array' AND jsonb_array_length(man->'components')=6
     AND jsonb_typeof(content->'layouts')='object' AND (SELECT count(*) FROM jsonb_object_keys(content->'layouts'))=6
     AND jsonb_typeof(content->'reportTemplates')='array' AND jsonb_array_length(content->'reportTemplates') BETWEEN 1 AND 32) IS NOT TRUE THEN RETURN false; END IF;
   FOR state_name,component_id IN SELECT * FROM (VALUES ('cover','folio-cover'),('question','folio-question'),('resume','folio-resume'),('result','cabinet-result'),('report','folio-report'),('poster','folio-poster')) AS x(state,id) LOOP
    IF ((content#>ARRAY['layouts',state_name,'component'])=jsonb_build_object('id',component_id,'version',component_version,'propsSchemaVersion','1.0.0')
      AND (SELECT count(*) FROM jsonb_array_elements(man->'components') c WHERE c=jsonb_build_object('id',component_id,'version',component_version,'propsSchemaVersion','1.0.0'))=1) IS NOT TRUE THEN RETURN false; END IF;
   END LOOP;
   IF EXISTS(SELECT 1 FROM jsonb_array_elements(content->'reportTemplates') t WHERE (t->'component'=jsonb_build_object('id','folio-report','version',component_version,'propsSchemaVersion','1.0.0')) IS NOT TRUE) THEN RETURN false; END IF;
  END IF;
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
   IF item#>>'{result,evidence,input,status}'='snapshotted' THEN
    IF (item#>>'{result,evidence,input,targetProductId}'=v.product_id AND item#>>'{result,evidence,input,archiveSha256}'=v.archive_sha256 AND item#>'{result,evidence,input,archiveBytes}'=to_jsonb(v.archive_bytes)) IS NOT TRUE THEN RETURN false; END IF;
   ELSIF (item#>>'{result,evidence,input,status}'='unavailable' AND item#>>'{result,outcome}'='interrupted' AND item#>>'{result,evidence,input,code}' IN ('INVALID_INPUT','INVALID_TARGET_PRODUCT')) IS NOT TRUE THEN RETURN false;
   END IF;
   IF item#>>'{result,evidence,identity,status}'='bound' THEN
    IF (item#>>'{result,evidence,identity,value,identitySha256}'=v.identity_sha256 AND (NOT current_policy OR item#>'{result,evidence,identity,value}'=ident)) IS NOT TRUE THEN RETURN false; END IF;
   ELSIF (item#>>'{result,evidence,identity,status}'='unavailable' AND item#>>'{result,outcome}'='interrupted' AND item#>>'{result,evidence,identity,code}' IN ('INVALID_CONTEXT','RUNTIME_IDENTITY_UNAVAILABLE')) IS NOT TRUE THEN RETURN false;
   END IF;
   -- Unavailable facts are truthful interrupted evidence, including historical attempts.
   -- A later accepted retry freezes a candidate without rewriting those earlier unavailable items.
   IF item#>>'{result,outcome}' IN ('accepted','rejected') AND (item#>>'{result,evidence,input,status}'='snapshotted' AND item#>>'{result,evidence,identity,status}'='bound') IS NOT TRUE THEN RETURN false; END IF;
   IF current_policy AND item#>>'{result,evidence,report,status}'='sealed' THEN
    IF (item#>>'{result,evidence,identity,status}'='bound'
     AND item#>'{result,evidence,identity,value}'=ident
     AND item#>>'{result,evidence,report,value,schemaVersion}'=ident->>'reportSchemaVersion'
     AND item#>>'{result,evidence,report,value,validatorVersion}'=ident->>'validatorVersion'
     AND item#>>'{result,evidence,report,value,policyId}'=ident->>'policyId'
     AND item#>>'{result,evidence,report,value,compatibilityPolicyHash}'=ident->>'compatibilityPolicyHash'
     AND item#>>'{result,evidence,report,value,effectiveLimitsHash}'=ident->>'effectiveLimitsHash') IS NOT TRUE THEN RETURN false; END IF;
   END IF;
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

CREATE OR REPLACE FUNCTION qf.protect_draft_revision_source() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE source qf.quizpack_validation; imp qf.quizpack_import; c jsonb; active boolean;
BEGIN
 SELECT archived_at IS NULL INTO active FROM qf.product WHERE id=NEW.product_id FOR UPDATE;
 SELECT * INTO imp FROM qf.quizpack_import WHERE product_id=NEW.product_id AND id=NEW.source_import_id;
 SELECT * INTO source FROM qf.quizpack_validation WHERE product_id=NEW.product_id AND import_id=NEW.source_import_id AND id=NEW.source_validation_id;
 IF (active AND imp.status='received' AND imp.target_kind='new-draft'
   AND source.status='ready' AND source.storage_condition='clean' AND source.reserved_bytes=0
   AND source.identity_kind IN ('canonical','alias')
   AND qf.validation_shape_valid(source)
   AND source.archive_policy_version='quizpack-private-archive.v3'
   AND source.archive_policy_sha256='a330bf3d82ada4bba47a395655347ad94b20ec3c00ffbde3f52a06773d3511d5'
   AND qf.validation_file_stop_protocol()='candidate-receipt-db-ack.v1'
   AND qf.validation_file_stop_controls_valid(source.archive_policy_version,source.id,source.attempts_text,source.evidence_metadata_text)
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(source.attempts_text::jsonb) a WHERE (a->>'disposition'='released' AND a->>'mediaStop' IN ('confirmed','not-started') AND a->'fileStopProof'<>'null'::jsonb) IS NOT TRUE)
   AND NEW.source_validation_state_revision=source.state_revision
   AND NEW.canonical_content_text=source.canonical_content_text
   AND NEW.canonical_content_sha256=source.canonical_content_sha256
   AND NEW.asset_set_text=source.asset_set_text AND NEW.asset_set_sha256=source.asset_set_sha256
   AND NEW.canonical_manifest_sha256=source.canonical_manifest_sha256
   AND NEW.candidate_sha256=source.candidate_sha256
   AND NEW.container_schema_version=source.container_schema_version
   AND NEW.content_schema_version=source.content_schema_version AND NEW.content_kind=source.content_kind
   AND NEW.pack_id=source.pack_id AND NEW.pack_version=source.pack_version
   AND NEW.resource_count=source.resource_count) IS NOT TRUE THEN
  RAISE EXCEPTION 'DRAFT_SOURCE_INVALID' USING ERRCODE='23514';
 END IF;
 c:=source.canonical_content_text::jsonb;
 IF (c#>>'{product,productId}'=NEW.product_id
   AND NEW.content_version=c->>'contentVersion' AND NEW.visual_version=c->>'visualVersion'
   AND NEW.report_version=c->>'reportVersion' AND NEW.resource_version=c->>'resourceVersion'
   AND NEW.component_version=c->>'componentVersion'
   AND NEW.engine_id=c#>>'{engine,id}' AND NEW.engine_version=c#>>'{engine,version}') IS NOT TRUE THEN
  RAISE EXCEPTION 'DRAFT_SOURCE_INVALID' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

ALTER TABLE qf.draft_revision DROP CONSTRAINT draft_revision_content_schema_version_check;
ALTER TABLE qf.draft_revision ADD CONSTRAINT draft_revision_content_schema_version_check CHECK(content_schema_version IN ('quizpack-content.v1','quizpack-content.v2'));
ALTER TABLE qf.draft_revision DROP CONSTRAINT draft_revision_content_kind_check;
ALTER TABLE qf.draft_revision ADD CONSTRAINT draft_revision_content_kind_check CHECK(content_kind IN ('synthetic','authored'));


-- Replacing a helper does not revalidate an existing CHECK automatically.
DO $$ DECLARE v qf.quizpack_validation; BEGIN
 FOR v IN SELECT * FROM qf.quizpack_validation LOOP
  IF qf.validation_shape_valid(v) IS NOT TRUE
    OR qf.validation_file_stop_controls_valid(v.archive_policy_version,v.id,v.attempts_text,v.evidence_metadata_text) IS NOT TRUE
  THEN RAISE EXCEPTION 'ADMISSION_EXISTING_DATA' USING ERRCODE='23514'; END IF;
 END LOOP;
END $$;
