CREATE TABLE admin_actions (                 -- append-only audit trail of everything an admin does
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  admin_id BIGINT UNSIGNED NOT NULL,
  action VARCHAR(60) NOT NULL,
  target_type VARCHAR(30) NOT NULL,
  target_id BIGINT UNSIGNED NULL,
  note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (admin_id) REFERENCES users(id) ON DELETE RESTRICT,
  KEY ix_admin_actions (created_at)
);
CREATE TABLE disputes (                      -- a learner asks for money back outside the automatic refund policy
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  payment_id BIGINT UNSIGNED NOT NULL,
  opened_by BIGINT UNSIGNED NOT NULL,
  reason VARCHAR(1000) NOT NULL,
  status ENUM('open','refunded','rejected') NOT NULL DEFAULT 'open',
  admin_note VARCHAR(500) NULL,
  resolved_by BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at TIMESTAMP NULL,
  open_key BIGINT UNSIGNED GENERATED ALWAYS AS (IF(status = 'open', payment_id, NULL)) VIRTUAL,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT,
  FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE RESTRICT,
  UNIQUE KEY uq_one_open_dispute (open_key),
  KEY ix_disputes_status (status, created_at)
);
ALTER TABLE reports
  ADD COLUMN session_id BIGINT UNSIGNED NULL,
  ADD COLUMN resolution_note VARCHAR(500) NULL,
  ADD COLUMN resolved_by BIGINT UNSIGNED NULL,
  ADD CONSTRAINT fk_reports_session FOREIGN KEY (session_id) REFERENCES learning_sessions(id) ON DELETE SET NULL;
