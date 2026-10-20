-- Enum additions commit in this migration before 0007 uses the new values.
ALTER TYPE qf.audit_action ADD VALUE 'import_intent_created';
ALTER TYPE qf.audit_action ADD VALUE 'import_receive_started';
ALTER TYPE qf.audit_action ADD VALUE 'import_receive_completed';
ALTER TYPE qf.audit_action ADD VALUE 'import_receive_failed';
ALTER TYPE qf.audit_action ADD VALUE 'import_receive_recovered';
