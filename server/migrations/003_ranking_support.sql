-- Support for Best Match ranking. rating_* are maintained by the reviews feature (Phase 5);
-- until then NULL = "no reviews yet", which ranking treats as unknown, not bad.
ALTER TABLE users
  ADD COLUMN last_active_at TIMESTAMP NULL,
  ADD COLUMN rating_avg DECIMAL(3,2) NULL,
  ADD COLUMN rating_count INT UNSIGNED NOT NULL DEFAULT 0,
  ADD KEY ix_users_active (status, onboarding_done, last_active_at);
ALTER TABLE learner_skills
  ADD COLUMN desired_level ENUM('beginner','intermediate','advanced','expert') NULL;
ALTER TABLE availability_slots ADD KEY ix_slots_user_day (user_id, weekday);

CREATE TABLE blocks (
  blocker_id BIGINT UNSIGNED NOT NULL,
  blocked_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (blocker_id, blocked_id),
  FOREIGN KEY (blocker_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (blocked_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_no_self_block CHECK (blocker_id <> blocked_id)
);

-- How often a profile was surfaced to a viewer as a recommendation (used to rotate repeats).
CREATE TABLE discovery_impressions (
  viewer_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  shown_count INT UNSIGNED NOT NULL DEFAULT 1,
  last_shown_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (viewer_id, user_id),
  FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

INSERT IGNORE INTO platform_settings (`key`, value) VALUES ('ranking_weights',
  '{"skill":0.30,"level":0.10,"price":0.20,"availability":0.12,"language":0.08,"style":0.07,"rating":0.08,"completeness":0.05}');
