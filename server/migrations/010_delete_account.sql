-- Deleting an account is confirmed with a 6-digit code sent by email.
ALTER TABLE email_tokens DROP CONSTRAINT email_tokens_purpose_check;
ALTER TABLE email_tokens ADD CONSTRAINT email_tokens_purpose_check CHECK (purpose IN ('verify_email', 'reset_password', 'delete_account'));
