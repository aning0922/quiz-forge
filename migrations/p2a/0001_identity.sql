CREATE SCHEMA qf;
CREATE TYPE qf.operator_role AS ENUM ('operator', 'read-only');
CREATE TYPE qf.operator_status AS ENUM ('active', 'disabled');
CREATE TYPE qf.session_kind AS ENUM ('preauth', 'authenticated');
CREATE TYPE qf.audit_action AS ENUM ('bootstrap','operator_disabled','preauth_created','login_succeeded','login_failed','logout','session_revoked');
CREATE TYPE qf.audit_outcome AS ENUM ('success','rejected');
CREATE TYPE qf.audit_reason AS ENUM ('AUTHENTICATION_FAILED','PREAUTH_EXPIRED','PREAUTH_REVOKED','RATE_LIMITED','SESSION_EXPIRED','SESSION_REVOKED','OPERATOR_DISABLED','MANUAL');

CREATE TABLE qf.operator (
  id uuid PRIMARY KEY,
  label varchar(64) NOT NULL UNIQUE,
  credential_digest char(64) NOT NULL UNIQUE,
  role qf.operator_role NOT NULL,
  status qf.operator_status NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  disabled_at timestamptz,
  CONSTRAINT operator_label CHECK (label ~ '^[a-z0-9-]{1,64}$'),
  CONSTRAINT operator_digest CHECK (credential_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT operator_status_time CHECK ((status='active' AND disabled_at IS NULL) OR (status='disabled' AND disabled_at IS NOT NULL AND disabled_at>=created_at))
);
CREATE TABLE qf.operator_session (
  id uuid PRIMARY KEY,
  token_digest char(64) NOT NULL UNIQUE,
  kind qf.session_kind NOT NULL,
  operator_id uuid REFERENCES qf.operator(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL,
  last_seen_at timestamptz NOT NULL,
  idle_expires_at timestamptz NOT NULL,
  absolute_expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  failed_attempts smallint NOT NULL DEFAULT 0,
  CONSTRAINT session_digest CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  CONSTRAINT session_attempts CHECK (failed_attempts BETWEEN 0 AND 5),
  CONSTRAINT session_identity CHECK ((kind='preauth' AND operator_id IS NULL) OR (kind='authenticated' AND operator_id IS NOT NULL AND failed_attempts=0)),
  CONSTRAINT session_times CHECK (created_at<=last_seen_at AND last_seen_at<absolute_expires_at AND created_at<idle_expires_at AND idle_expires_at<=absolute_expires_at AND (revoked_at IS NULL OR revoked_at>=created_at)),
  CONSTRAINT session_lifetime CHECK ((kind='preauth' AND absolute_expires_at=created_at+interval '5 minutes' AND idle_expires_at=absolute_expires_at) OR (kind='authenticated' AND absolute_expires_at=created_at+interval '8 hours' AND idle_expires_at<=last_seen_at+interval '30 minutes'))
);
CREATE INDEX session_operator_revoked ON qf.operator_session(operator_id,revoked_at);
CREATE INDEX session_absolute ON qf.operator_session(absolute_expires_at);
CREATE TABLE qf.audit_event (
  id uuid PRIMARY KEY,
  occurred_at timestamptz NOT NULL DEFAULT now(),
  action qf.audit_action NOT NULL,
  outcome qf.audit_outcome NOT NULL,
  reason_code qf.audit_reason,
  actor_id uuid REFERENCES qf.operator(id) ON DELETE RESTRICT,
  session_id uuid,
  request_id uuid NOT NULL
);
CREATE INDEX audit_action_time ON qf.audit_event(action,occurred_at);
REVOKE ALL ON SCHEMA qf FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA qf FROM PUBLIC;
REVOKE ALL ON TYPE qf.operator_role FROM PUBLIC;
REVOKE ALL ON TYPE qf.operator_status FROM PUBLIC;
REVOKE ALL ON TYPE qf.session_kind FROM PUBLIC;
REVOKE ALL ON TYPE qf.audit_action FROM PUBLIC;
REVOKE ALL ON TYPE qf.audit_outcome FROM PUBLIC;
REVOKE ALL ON TYPE qf.audit_reason FROM PUBLIC;
