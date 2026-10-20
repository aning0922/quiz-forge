CREATE TABLE qf.category (
 id uuid PRIMARY KEY, slug varchar(80) NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
 name varchar(40) NOT NULL CHECK (name ~ '[^[:space:]]' AND name !~ '[[:cntrl:]<>]' AND name !~ U&'[\0085\00AD\061C\180E\200B-\200F\2028-\202E\2060-\206F\FEFF]'),
 revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL, archived_at timestamptz,
 CHECK (revision >= 1), CHECK (updated_at >= created_at), CHECK (archived_at IS NULL OR archived_at >= created_at)
);
CREATE INDEX category_archived_created ON qf.category(archived_at,created_at DESC,id);
CREATE TABLE qf.tag (
 id uuid PRIMARY KEY, slug varchar(80) NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
 name varchar(40) NOT NULL CHECK (name ~ '[^[:space:]]' AND name !~ '[[:cntrl:]<>]' AND name !~ U&'[\0085\00AD\061C\180E\200B-\200F\2028-\202E\2060-\206F\FEFF]'),
 revision integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL, archived_at timestamptz,
 CHECK (revision >= 1), CHECK (updated_at >= created_at), CHECK (archived_at IS NULL OR archived_at >= created_at)
);
CREATE INDEX tag_archived_created ON qf.tag(archived_at,created_at DESC,id);
CREATE TABLE qf.product (
 id varchar(80) PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'), slug varchar(80) NOT NULL UNIQUE CHECK (slug ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$'),
 title varchar(120) NOT NULL CHECK (title ~ '[^[:space:]]' AND title !~ '[[:cntrl:]<>]' AND title !~ U&'[\0085\00AD\061C\180E\200B-\200F\2028-\202E\2060-\206F\FEFF]'),
 primary_category_id uuid REFERENCES qf.category(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 metadata_revision integer NOT NULL DEFAULT 1 CHECK (metadata_revision >= 1),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL, archived_at timestamptz,
 CHECK (updated_at >= created_at), CHECK (archived_at IS NULL OR archived_at >= created_at)
);
CREATE INDEX product_archived_created ON qf.product(archived_at,created_at DESC,id);
CREATE INDEX product_category ON qf.product(primary_category_id);
CREATE TABLE qf.product_tag (
 product_id varchar(80) NOT NULL REFERENCES qf.product(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 tag_id uuid NOT NULL REFERENCES qf.tag(id) ON UPDATE RESTRICT ON DELETE RESTRICT,
 slot smallint NOT NULL CHECK (slot BETWEEN 1 AND 8),
 PRIMARY KEY (product_id,tag_id), UNIQUE (product_id,slot)
);
CREATE INDEX product_tag_reverse ON qf.product_tag(tag_id,product_id);
ALTER TABLE qf.audit_event ADD COLUMN target_kind varchar(8), ADD COLUMN target_id varchar(80), ADD COLUMN target_revision integer;
ALTER TABLE qf.audit_event ADD CONSTRAINT audit_target CHECK (
 (target_kind IS NULL AND target_id IS NULL AND target_revision IS NULL AND action IN ('bootstrap','operator_disabled','preauth_created','login_succeeded','login_failed','logout','session_revoked'))
 OR (target_kind IS NOT NULL AND target_id IS NOT NULL AND target_revision IS NOT NULL AND target_revision >= 1
 AND actor_id IS NOT NULL AND session_id IS NOT NULL AND outcome = 'success' AND reason_code IS NULL
 AND ((target_kind = 'product' AND target_id ~ '^[a-z][a-z0-9]*(-[a-z0-9]+)*$' AND action IN ('product_created','product_updated','product_archived','product_restored'))
 OR (target_kind = 'category' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('category_created','category_updated','category_archived','category_restored'))
 OR (target_kind = 'tag' AND target_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' AND action IN ('tag_created','tag_updated','tag_archived','tag_restored'))))
);
