-- A review is about the reviewee in ONE role. Only Mentor-role reviews feed users.rating_* (Mentor reputation and Best Match).
ALTER TABLE reviews ADD COLUMN reviewee_role ENUM('mentor','learner') NOT NULL DEFAULT 'mentor';
UPDATE reviews r JOIN bookings b ON b.id = r.booking_id JOIN learning_sessions s ON s.id = b.session_id
  SET r.reviewee_role = IF(r.reviewee_id = s.mentor_id, 'mentor', 'learner');
UPDATE users u SET
  rating_avg = (SELECT AVG(rating) FROM reviews r WHERE r.reviewee_id = u.id AND r.reviewee_role = 'mentor'),
  rating_count = (SELECT COUNT(*) FROM reviews r WHERE r.reviewee_id = u.id AND r.reviewee_role = 'mentor');
ALTER TABLE reviews ADD KEY ix_reviews_role (reviewee_id, reviewee_role, id);
