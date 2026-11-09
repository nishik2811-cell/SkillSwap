// Applies server/migrations/*.sql in filename order, once each, tracked in schema_migrations.
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { pool } from './db.js';

const dir = fileURLToPath(new URL('../migrations/', import.meta.url));

await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
  name VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP)`);
const [rows] = await pool.query('SELECT name FROM schema_migrations');
const done = new Set(rows.map((r) => r.name));

for (const f of (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(f)) continue;
  await pool.query(await readFile(dir + f, 'utf8'));
  await pool.query('INSERT INTO schema_migrations (name) VALUES (?)', [f]);
  console.log('applied', f);
}
await pool.end();
