-- The mentor keeps their whole price; the learner pays a platform fee and GST on that fee on top.
ALTER TABLE payments ADD COLUMN gst_paise INT NOT NULL DEFAULT 0;
ALTER TABLE payments DROP CONSTRAINT ck_payment_split;
ALTER TABLE payments ADD CONSTRAINT ck_payment_split CHECK (platform_fee_paise + gst_paise + mentor_net_paise = amount_paise AND amount_paise > 0);
-- Full refund if a learner cancels at least 45 minutes before the start; no minimum payout.
INSERT INTO platform_settings ("key", value) VALUES ('gst_percent', '18'), ('refund_window_minutes', '45') ON CONFLICT ("key") DO NOTHING;
UPDATE platform_settings SET value = '0' WHERE "key" = 'min_payout_paise';
