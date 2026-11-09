-- Connections (one row per pair, enforced by the generated lo/hi pair), reports, notifications.
CREATE TABLE connections (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  requester_id BIGINT UNSIGNED NOT NULL,
  addressee_id BIGINT UNSIGNED NOT NULL,
  user_lo BIGINT UNSIGNED GENERATED ALWAYS AS (LEAST(requester_id, addressee_id)) VIRTUAL,
  user_hi BIGINT UNSIGNED GENERATED ALWAYS AS (GREATEST(requester_id, addressee_id)) VIRTUAL,
  status ENUM('pending','accepted','rejected') NOT NULL DEFAULT 'pending',
  message VARCHAR(300) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  responded_at TIMESTAMP NULL,
  FOREIGN KEY (requester_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (addressee_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_connection_pair (user_lo, user_hi),
  KEY ix_conn_addressee (addressee_id, status),
  CONSTRAINT ck_no_self_conn CHECK (requester_id <> addressee_id)
);

CREATE TABLE reports (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  reporter_id BIGINT UNSIGNED NOT NULL,
  target_user_id BIGINT UNSIGNED NOT NULL,
  reason ENUM('spam','harassment','inappropriate','fake_profile','scam','other') NOT NULL,
  details VARCHAR(1000) NULL,
  status ENUM('open','resolved','dismissed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  FOREIGN KEY (reporter_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (target_user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY ix_reports_status (status, created_at),
  CONSTRAINT ck_no_self_report CHECK (reporter_id <> target_user_id)
);

CREATE TABLE notifications (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  type VARCHAR(40) NOT NULL,
  title VARCHAR(160) NOT NULL,
  body VARCHAR(300) NULL,
  link VARCHAR(200) NULL,
  read_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY ix_notif_user (user_id, read_at, created_at)
);
