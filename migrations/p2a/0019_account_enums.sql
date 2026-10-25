-- Enum labels must commit before the following migration uses them.
ALTER TYPE qf.operator_role ADD VALUE 'admin';
ALTER TYPE qf.audit_action ADD VALUE 'account_operation';
