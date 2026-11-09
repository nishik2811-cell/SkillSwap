-- Identity, auth, skills, Mentor/Learner preferences. Money is integer paise.
CREATE TABLE users (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(254) NOT NULL,
  username VARCHAR(20) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  role ENUM('user','admin') NOT NULL DEFAULT 'user',
  status ENUM('active','suspended','deactivated') NOT NULL DEFAULT 'active',
  email_verified_at TIMESTAMP NULL,
  avatar_path VARCHAR(255) NULL,
  bio VARCHAR(500) NULL,
  age TINYINT UNSIGNED NULL,
  location VARCHAR(100) NULL,
  timezone VARCHAR(64) NULL,
  preferred_language VARCHAR(40) NULL,
  onboarding_done BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  -- default collation is case-insensitive, so "Nish" and "nish" collide
  UNIQUE KEY uq_users_email (email),
  UNIQUE KEY uq_users_username (username),
  CONSTRAINT ck_users_username CHECK (username REGEXP '^[a-z0-9_]{3,20}$'),
  CONSTRAINT ck_users_age CHECK (age IS NULL OR age BETWEEN 13 AND 120)
);

CREATE TABLE auth_sessions (
  token_hash CHAR(64) PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY ix_auth_sessions_user (user_id)
);

CREATE TABLE email_tokens (
  token_hash CHAR(64) PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  purpose ENUM('verify_email','reset_password') NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE categories (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(60) NOT NULL UNIQUE
);

CREATE TABLE skills (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  category_id INT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL UNIQUE,
  FOREIGN KEY (category_id) REFERENCES categories(id)
);

CREATE TABLE mentor_skills (
  user_id BIGINT UNSIGNED NOT NULL,
  skill_id INT UNSIGNED NOT NULL,
  level ENUM('beginner','intermediate','advanced','expert') NOT NULL,
  years_experience TINYINT UNSIGNED NULL,
  pricing ENUM('free','paid','both') NOT NULL DEFAULT 'free',
  price_min_paise INT UNSIGNED NULL,
  price_max_paise INT UNSIGNED NULL,
  teaching_style ENUM('one_on_one','group','workshop','interactive') NOT NULL DEFAULT 'one_on_one',
  PRIMARY KEY (user_id, skill_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id),
  CONSTRAINT ck_mentor_price CHECK (
    (pricing = 'free' AND price_min_paise IS NULL AND price_max_paise IS NULL)
    OR (pricing <> 'free' AND price_min_paise IS NOT NULL AND price_max_paise IS NOT NULL
        AND price_min_paise <= price_max_paise))
);

CREATE TABLE learner_skills (
  user_id BIGINT UNSIGNED NOT NULL,
  skill_id INT UNSIGNED NOT NULL,
  current_level ENUM('none','beginner','intermediate','advanced') NOT NULL DEFAULT 'none',
  prefers ENUM('free','paid','either') NOT NULL DEFAULT 'either',
  max_price_paise INT UNSIGNED NULL,
  learning_style ENUM('one_on_one','group','workshop','interactive') NOT NULL DEFAULT 'one_on_one',
  PRIMARY KEY (user_id, skill_id),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (skill_id) REFERENCES skills(id)
);

CREATE TABLE availability_slots (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id BIGINT UNSIGNED NOT NULL,
  weekday TINYINT UNSIGNED NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME NOT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  CONSTRAINT ck_slot CHECK (weekday <= 6 AND start_time < end_time)
);

CREATE TABLE user_languages (
  user_id BIGINT UNSIGNED NOT NULL,
  language VARCHAR(40) NOT NULL,
  PRIMARY KEY (user_id, language),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
