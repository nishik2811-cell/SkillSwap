-- Run once: sudo mysql < server/setup-db.sql   (change the password, then put it in .env)
CREATE DATABASE IF NOT EXISTS skillswap CHARACTER SET utf8mb4 COLLATE utf8mb4_0900_ai_ci;
CREATE USER IF NOT EXISTS 'skillswap'@'localhost' IDENTIFIED BY 'change-me';
GRANT ALL PRIVILEGES ON skillswap.* TO 'skillswap'@'localhost';
