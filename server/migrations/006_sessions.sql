-- Learning Sessions, bookings, reviews. Money in paise. Times are UTC.
CREATE TABLE learning_sessions (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  mentor_id BIGINT UNSIGNED NOT NULL,
  skill_id INT UNSIGNED NOT NULL,
  title VARCHAR(120) NOT NULL,
  description VARCHAR(2000) NULL,
  starts_at DATETIME NOT NULL,
  duration_min SMALLINT UNSIGNED NOT NULL,
  capacity SMALLINT UNSIGNED NOT NULL DEFAULT 1, -- 1 = individual mentoring, >1 = group session
  pricing ENUM('free','paid') NOT NULL DEFAULT 'free',
  price_paise INT UNSIGNED NULL,
  auto_accept BOOLEAN NOT NULL DEFAULT FALSE,
  status ENUM('scheduled','cancelled','completed') NOT NULL DEFAULT 'scheduled',
  cancel_reason VARCHAR(300) NULL,
  reminder_sent BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (mentor_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id),
  KEY ix_sessions_upcoming (status, starts_at),
  KEY ix_sessions_mentor (mentor_id, starts_at),
  CONSTRAINT ck_session_capacity CHECK (capacity BETWEEN 1 AND 100),
  CONSTRAINT ck_session_duration CHECK (duration_min BETWEEN 15 AND 480),
  CONSTRAINT ck_session_price CHECK ((pricing = 'free' AND price_paise IS NULL) OR (pricing = 'paid' AND price_paise > 0))
);

CREATE TABLE bookings (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id BIGINT UNSIGNED NOT NULL,
  learner_id BIGINT UNSIGNED NOT NULL,
  -- requested -> (mentor accepts) -> confirmed (free) | awaiting_payment (paid; Phase 6 payment confirms it)
  status ENUM('requested','awaiting_payment','confirmed','rejected','cancelled','completed') NOT NULL DEFAULT 'requested',
  note VARCHAR(300) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES learning_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (learner_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_booking (session_id, learner_id),
  KEY ix_bookings_learner (learner_id, status)
);

CREATE TABLE reviews (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id BIGINT UNSIGNED NOT NULL,
  reviewer_id BIGINT UNSIGNED NOT NULL,
  reviewee_id BIGINT UNSIGNED NOT NULL,
  rating TINYINT UNSIGNED NOT NULL,
  comment VARCHAR(1000) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewee_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_review (booking_id, reviewer_id),
  KEY ix_reviews_reviewee (reviewee_id, created_at),
  CONSTRAINT ck_rating CHECK (rating BETWEEN 1 AND 5),
  CONSTRAINT ck_no_self_review CHECK (reviewer_id <> reviewee_id)
);
