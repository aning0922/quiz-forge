-- Preserve formal v1/v2 sources that have no bindings object. 0026 is retained unchanged.
CREATE OR REPLACE FUNCTION qf.private_test_source_valid(source jsonb,asset_sha text,manifest_sha text) RETURNS boolean LANGUAGE plpgsql STABLE STRICT SET search_path=pg_catalog AS $$
BEGIN
 IF coalesce((source->'bindings') ? 'privateTestUse',false) IS FALSE THEN RETURN true; END IF;
 RETURN (qf.private_test_database_valid() AND qf.private_test_structure_valid(source)
 AND qf.sha256_utf8(qf.consumer_canonical(source))='112c9da91f0346f780b050e340d820d20c19a144695b94c48a86a53c91040633' AND asset_sha='da03e7f4af5e621a714ec93ce7368a7f594d5f97de9b4a8534b586abf5a405a3' AND manifest_sha='351ebfcd1dd17036fceb896f0a9a50e419b628fe1260d87dd37db59cf0de5fb5') IS TRUE;
EXCEPTION WHEN OTHERS THEN RETURN false;
END $$;
