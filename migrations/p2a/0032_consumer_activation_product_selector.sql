-- Correct only the activation-local selector; preserve every applied migration byte.
DO $pre$ DECLARE actual text; BEGIN
 IF NOT pg_try_advisory_xact_lock(72461,2) THEN RAISE EXCEPTION 'CONSUMER_IO_PRESENT' USING ERRCODE='55000'; END IF;
 IF EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND usename=replace(current_user,'qf_owner_','qf_app_') AND pid<>pg_backend_pid()) THEN RAISE EXCEPTION 'CONSUMER_WRITERS_PRESENT' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM qf_meta.schema_migrations WHERE version='0031_consumer_controlled_writes' AND checksum='c78cad364630daa315b2289c7b0e744ee317543419d3ca7ff5d3a50495ef3d92') THEN RAISE EXCEPTION 'CONSUMER_PREVIOUS_SCHEMA_MISMATCH' USING ERRCODE='55000'; END IF;
 SELECT encode(sha256(convert_to(prosrc,'UTF8')),'hex') INTO actual FROM pg_proc WHERE oid='qf.consumer_activate_product(text,text,uuid)'::regprocedure;
 IF actual IS DISTINCT FROM 'dc45607d74045240228879eb6296b007a84bcb756b96be96087d54d966ac9b2c' THEN RAISE EXCEPTION 'CONSUMER_PREVIOUS_FUNCTION_MISMATCH' USING ERRCODE='55000'; END IF;
END $pre$;
CREATE OR REPLACE FUNCTION qf.consumer_activate_product(p_binding text,p_operator_digest text,p_request uuid) RETURNS qf.consumer_product_activation LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE b jsonb; h qf.consumer_product_head; auth qf.operator_session; old qf.consumer_product_activation; result qf.consumer_product_activation; selected_product text;
BEGIN
 auth:=qf.consumer_service_operator(p_operator_digest,'version:seal-internal');
 b:=p_binding::jsonb;selected_product:=b->>'productId';
 IF NOT pg_try_advisory_xact_lock_shared(72461,2) THEN RAISE EXCEPTION 'CONSUMER_MAINTENANCE_BUSY' USING ERRCODE='55P03'; END IF;
 PERFORM 1 FROM qf.product WHERE id=selected_product FOR UPDATE NOWAIT;
 IF NOT FOUND THEN RAISE EXCEPTION 'CONSUMER_PRODUCT_MISSING' USING ERRCODE='23514'; END IF;
 SELECT * INTO h FROM qf.consumer_product_head WHERE product_id=selected_product FOR UPDATE NOWAIT;
 PERFORM 1 FROM qf.operator WHERE id=auth.operator_id FOR SHARE NOWAIT;
 PERFORM 1 FROM qf.operator_session WHERE id=auth.id FOR SHARE NOWAIT;
 auth:=qf.consumer_service_operator(p_operator_digest,'version:seal-internal');
 SELECT * INTO old FROM qf.consumer_product_activation WHERE product_id=selected_product AND operation_key=(b->>'operationKey')::uuid;
 IF FOUND THEN
  IF old.binding_text IS DISTINCT FROM p_binding THEN RAISE EXCEPTION 'CONSUMER_OPERATION_CONFLICT' USING ERRCODE='23514'; END IF;
  RETURN old;
 END IF;
 IF h.product_id IS NOT NULL AND ROW(h.play_version_id::text,h.play_snapshot_sha256::text)=ROW(b->>'playVersionId',b->>'playSnapshotSha256') THEN RAISE EXCEPTION 'CONSUMER_ACTIVATION_CONFLICT' USING ERRCODE='23514'; END IF;
 INSERT INTO qf.consumer_product_activation(id,product_id,operation_key,expected_generation,generation,play_version_id,play_snapshot_sha256,binding_text,binding_sha256,activated_by,operator_session_id,request_id,activated_at,receipt_text,receipt_sha256)
 VALUES(gen_random_uuid(),selected_product,(b->>'operationKey')::uuid,(b->>'expectedGeneration')::integer,(b->>'expectedGeneration')::integer+1,(b->>'playVersionId')::uuid,b->>'playSnapshotSha256',p_binding,qf.sha256_utf8(p_binding),auth.operator_id,auth.id,p_request,clock_timestamp(),'','') RETURNING * INTO result;
 RETURN result;
END $$;
