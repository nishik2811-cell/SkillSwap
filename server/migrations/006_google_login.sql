ALTER TABLE users ADD COLUMN google_sub VARCHAR(64) NULL;
CREATE UNIQUE INDEX uq_users_google_sub ON users (google_sub) WHERE google_sub IS NOT NULL;
