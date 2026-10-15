-- The enum must commit before the following migration uses it.
ALTER TYPE qf.audit_action ADD VALUE 'draft_applied';
