-- Durable copy of uploaded files (avatars, chat attachments) for hosts with an ephemeral disk (Render free plan).
-- Used only when FILE_STORE=db. The disk stays as a cache; this table is the source of truth.
CREATE TABLE stored_files (
  path TEXT PRIMARY KEY,
  mime VARCHAR(100) NOT NULL,
  data BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
