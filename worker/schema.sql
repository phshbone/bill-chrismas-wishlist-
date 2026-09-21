PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_key TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  avatar_asset TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('member','admin')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),

  setup_code_salt TEXT,
  setup_code_hash TEXT,
  setup_code_used_at TEXT,

  password_salt TEXT,
  password_hash TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id INTEGER NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  last_seen_at TEXT,
  expires_at TEXT NOT NULL,
  revoked_at TEXT,

  FOREIGN KEY (member_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_sessions_member
  ON sessions(member_id);

CREATE INDEX IF NOT EXISTS idx_sessions_active
  ON sessions(token_hash, revoked_at, expires_at);

CREATE TABLE IF NOT EXISTS wishes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner_id INTEGER NOT NULL,
  title TEXT NOT NULL,
  url TEXT,
  notes TEXT,

  barcode TEXT,
  product_image TEXT,
  image_source TEXT CHECK (
    image_source IS NULL OR image_source IN ('catalog','user-photo','none')
  ),

  version INTEGER NOT NULL DEFAULT 1,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,

  FOREIGN KEY (owner_id) REFERENCES members(id)
);

CREATE INDEX IF NOT EXISTS idx_wishes_owner_active
  ON wishes(owner_id, active, created_at);

CREATE TABLE IF NOT EXISTS claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wish_id INTEGER NOT NULL,
  claimed_by INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved','purchased','released')),

  wish_version_at_claim INTEGER NOT NULL,
  snapshot_title TEXT NOT NULL,
  snapshot_url TEXT,
  snapshot_notes TEXT,

  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  released_at TEXT,

  FOREIGN KEY (wish_id) REFERENCES wishes(id),
  FOREIGN KEY (claimed_by) REFERENCES members(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_claim_per_wish
  ON claims(wish_id)
  WHERE status IN ('reserved','purchased');

CREATE INDEX IF NOT EXISTS idx_claims_shopper
  ON claims(claimed_by, status, updated_at);

CREATE TABLE IF NOT EXISTS list_views (
  viewer_id INTEGER NOT NULL,
  owner_id INTEGER NOT NULL,
  last_viewed_at TEXT NOT NULL,

  PRIMARY KEY (viewer_id, owner_id),

  FOREIGN KEY (viewer_id) REFERENCES members(id),
  FOREIGN KEY (owner_id) REFERENCES members(id)
);

-- Canonical launch members.
-- UB is the app admin; admin authority never grants access to claim identities.
INSERT OR IGNORE INTO members
  (member_key, display_name, sort_order, role, active, created_at, updated_at)
VALUES
  ('ub',      'UB',      1, 'admin',  1, datetime('now'), datetime('now')),
  ('bill',    'Bill',    2, 'member', 1, datetime('now'), datetime('now')),
  ('michele', 'Michele', 3, 'member', 1, datetime('now'), datetime('now')),
  ('mac',     'Mac',     4, 'member', 1, datetime('now'), datetime('now')),
  ('mollie',  'Mollie',  5, 'member', 1, datetime('now'), datetime('now')),
  ('brett',   'Brett',   6, 'member', 1, datetime('now'), datetime('now'));