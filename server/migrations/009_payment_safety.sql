-- 1) At most ONE open (created/failed) payment attempt per booking, so two simultaneous "Pay" clicks can't create two gateway orders.
ALTER TABLE payments
  ADD COLUMN open_key BIGINT UNSIGNED GENERATED ALWAYS AS (IF(status IN ('created','failed'), booking_id, NULL)) VIRTUAL,
  ADD UNIQUE KEY uq_one_open_payment (open_key);

-- 2) Financial records must never vanish as a side effect of deleting a user, booking or payment.
ALTER TABLE payments DROP FOREIGN KEY payments_ibfk_1, DROP FOREIGN KEY payments_ibfk_2, DROP FOREIGN KEY payments_ibfk_3;
ALTER TABLE payments
  ADD CONSTRAINT fk_payments_booking FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_payments_learner FOREIGN KEY (learner_id) REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_payments_mentor FOREIGN KEY (mentor_id) REFERENCES users(id) ON DELETE RESTRICT;
ALTER TABLE refunds DROP FOREIGN KEY refunds_ibfk_1;
ALTER TABLE refunds ADD CONSTRAINT fk_refunds_payment FOREIGN KEY (payment_id) REFERENCES payments(id) ON DELETE RESTRICT;
ALTER TABLE payouts DROP FOREIGN KEY payouts_ibfk_1;
ALTER TABLE payouts ADD CONSTRAINT fk_payouts_mentor FOREIGN KEY (mentor_id) REFERENCES users(id) ON DELETE RESTRICT;
