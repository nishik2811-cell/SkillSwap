CREATE TABLE meeting_rooms (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(14) NOT NULL,                       -- shareable meeting ID, e.g. "kqf-mzpw-dxa"
  session_id BIGINT UNSIGNED NULL,                  -- set for a Learning Session's room; NULL for an ad-hoc meeting
  host_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(120) NOT NULL,
  waiting_room BOOLEAN NOT NULL DEFAULT TRUE,
  status ENUM('open','ended') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at TIMESTAMP NULL,
  FOREIGN KEY (host_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (session_id) REFERENCES learning_sessions(id) ON DELETE SET NULL,
  UNIQUE KEY uq_room_code (code),
  UNIQUE KEY uq_room_session (session_id)
);
CREATE TABLE meeting_participants (
  room_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('host','cohost','participant') NOT NULL DEFAULT 'participant',
  status ENUM('waiting','admitted','denied','left','removed') NOT NULL,
  first_joined_at TIMESTAMP NULL,
  last_left_at TIMESTAMP NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (room_id, user_id),
  FOREIGN KEY (room_id) REFERENCES meeting_rooms(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY ix_mp_user (user_id, requested_at)
);
