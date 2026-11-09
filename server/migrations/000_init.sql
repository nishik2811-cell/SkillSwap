-- Phase 0 baseline; real schema starts in Phase 1.
CREATE TABLE IF NOT EXISTS platform_settings (
  `key` VARCHAR(64) PRIMARY KEY,
  value VARCHAR(255) NOT NULL
);
INSERT IGNORE INTO platform_settings (`key`, value) VALUES ('commission_percent', '10');
