-- Separate enum commit: 0012 may use this value only after 0011 commits.
ALTER TYPE qf.audit_action ADD VALUE 'validation_file_stop_acknowledged';
