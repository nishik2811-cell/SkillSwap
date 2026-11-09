CREATE TABLE conversations (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  type ENUM('direct','group') NOT NULL,
  title VARCHAR(80) NULL,
  created_by BIGINT UNSIGNED NOT NULL,
  direct_key VARCHAR(41) NULL, -- "lowId:highId"; UNIQUE => at most one direct chat per pair
  last_message_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uq_direct_key (direct_key),
  CONSTRAINT ck_conv_shape CHECK ((type = 'direct' AND direct_key IS NOT NULL AND title IS NULL) OR (type = 'group' AND direct_key IS NULL AND title IS NOT NULL))
);

CREATE TABLE conversation_members (
  conversation_id BIGINT UNSIGNED NOT NULL,
  user_id BIGINT UNSIGNED NOT NULL,
  role ENUM('admin','member') NOT NULL DEFAULT 'member',
  joined_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_read_message_id BIGINT UNSIGNED NULL, -- read receipt = highest message this member has seen
  PRIMARY KEY (conversation_id, user_id),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY ix_members_user (user_id)
);

CREATE TABLE messages (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  conversation_id BIGINT UNSIGNED NOT NULL,
  sender_id BIGINT UNSIGNED NOT NULL,
  kind ENUM('text','system') NOT NULL DEFAULT 'text',
  body VARCHAR(4000) NULL,
  deleted_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY ix_messages_conv (conversation_id, id)
);

CREATE TABLE attachments (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  message_id BIGINT UNSIGNED NOT NULL,
  original_name VARCHAR(200) NOT NULL,
  stored_path VARCHAR(120) NOT NULL,
  mime VARCHAR(100) NOT NULL,
  size INT UNSIGNED NOT NULL,
  FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
);
