import mysql from 'mysql2/promise';

export const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  connectionLimit: 10,
  timezone: 'Z', // JS Dates <-> MySQL are always UTC
  multipleStatements: true, // used only by the migration runner on trusted .sql files
});

// Per connection: UTC clock (DATETIME/TIMESTAMP never shift with server settings) and READ COMMITTED.
// READ COMMITTED avoids gap locks, so unrelated users writing neighbouring rows (delete-then-insert of preferences, chat, ...) cannot deadlock.
// Code that needs exclusivity uses explicit row locks (SELECT ... FOR UPDATE), which behave the same at this level.
pool.pool.on('connection', (c) => c.query("SET time_zone = '+00:00', SESSION transaction_isolation = 'READ-COMMITTED'"));

/** Run fn(conn) in a transaction; retries on deadlock (a normal outcome under concurrency). */
export async function inTx(fn, attempts = 3) {
  for (let i = 1; ; i++) {
    const conn = await pool.getConnection();
    try { await conn.beginTransaction(); const r = await fn(conn); await conn.commit(); return r; }
    catch (e) { await conn.rollback().catch(() => {}); if (e.code === 'ER_LOCK_DEADLOCK' && i < attempts) continue; throw e; }
    finally { conn.release(); }
  }
}
