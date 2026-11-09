-- Payments. Money is integer paise; the amount is ALWAYS computed from the database, never accepted from a client.
CREATE TABLE payments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  booking_id BIGINT UNSIGNED NOT NULL,
  learner_id BIGINT UNSIGNED NOT NULL,
  mentor_id BIGINT UNSIGNED NOT NULL,
  amount_paise INT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  commission_percent DECIMAL(5,2) NOT NULL,          -- snapshot of the platform rate at order time
  platform_fee_paise INT UNSIGNED NOT NULL,
  mentor_net_paise INT UNSIGNED NOT NULL,
  status ENUM('created','paid','failed','refunded') NOT NULL DEFAULT 'created',
  gateway_order_id VARCHAR(64) NOT NULL,
  gateway_payment_id VARCHAR(64) NULL,
  method VARCHAR(30) NULL,
  failure_reason VARCHAR(300) NULL,
  paid_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  paid_key BIGINT UNSIGNED GENERATED ALWAYS AS (IF(status = 'paid', booking_id, NULL)) VIRTUAL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (learner_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (mentor_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_gateway_order (gateway_order_id),
  UNIQUE KEY uq_gateway_payment (gateway_payment_id),
  UNIQUE KEY uq_one_paid_per_booking (paid_key),     -- DB-level guarantee: a booking can't be paid twice
  KEY ix_payments_learner (learner_id, created_at),
  KEY ix_payments_mentor (mentor_id, status),
  CONSTRAINT ck_payment_split CHECK (platform_fee_paise + mentor_net_paise = amount_paise AND amount_paise > 0)
);

CREATE TABLE refunds (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  payment_id BIGINT UNSIGNED NOT NULL,
  amount_paise INT UNSIGNED NOT NULL,
  status ENUM('pending','processed','failed') NOT NULL DEFAULT 'pending',
  gateway_refund_id VARCHAR(64) NULL,
  reason VARCHAR(200) NOT NULL,
  initiated_by ENUM('learner','mentor','admin','system') NOT NULL,
  failure_reason VARCHAR(300) NULL,
  attempts TINYINT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE CASCADE,
  UNIQUE KEY uq_gateway_refund (gateway_refund_id),
  KEY ix_refunds_status (status, created_at),
  CONSTRAINT ck_refund_amount CHECK (amount_paise > 0)
);

CREATE TABLE webhook_events (               -- idempotency: each gateway event is processed once
  event_id VARCHAR(100) PRIMARY KEY,
  type VARCHAR(60) NOT NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE payouts (                      -- mentor withdrawal requests; an admin pays them out (Phase 8 UI)
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  mentor_id BIGINT UNSIGNED NOT NULL,
  amount_paise INT UNSIGNED NOT NULL,
  destination VARCHAR(120) NOT NULL,
  status ENUM('requested','paid','rejected') NOT NULL DEFAULT 'requested',
  admin_note VARCHAR(300) NULL,
  requested_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  FOREIGN KEY (mentor_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY ix_payouts_status (status, requested_at),
  CONSTRAINT ck_payout_amount CHECK (amount_paise > 0)
);

INSERT IGNORE INTO platform_settings (`key`, value) VALUES
  ('refund_window_hours', '24'),     -- learner cancels at least this long before the start => full refund
  ('unpaid_hold_hours', '24'),       -- an accepted-but-unpaid seat is released after this long
  ('min_payout_paise', '10000');
