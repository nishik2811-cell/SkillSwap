-- Where a mentor wants their earnings sent. Its own table on purpose: the many `SELECT * FROM users` paths never carry bank details.
CREATE TABLE payout_methods (
  user_id BIGINT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('upi', 'bank')),
  upi_id VARCHAR(100) NULL,
  account_name VARCHAR(100) NULL,
  account_number VARCHAR(20) NULL,
  ifsc CHAR(11) NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT ck_payout_method CHECK ((kind = 'upi' AND upi_id IS NOT NULL) OR (kind = 'bank' AND account_name IS NOT NULL AND account_number IS NOT NULL AND ifsc IS NOT NULL))
);
