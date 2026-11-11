-- Public sessions show in Browse for everyone; private ones only to the mentor, invited connections and people who booked.
ALTER TABLE learning_sessions ADD COLUMN visibility TEXT NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private'));
CREATE TABLE session_invites (
  session_id BIGINT NOT NULL REFERENCES learning_sessions(id) ON DELETE CASCADE,
  user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (session_id, user_id)
);
CREATE INDEX ix_session_invites_user ON session_invites (user_id);
