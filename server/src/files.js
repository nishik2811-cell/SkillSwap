// Uploaded files live on disk (UPLOAD_DIR). With FILE_STORE=db every upload is also copied into Postgres and served from there
// when the disk copy is gone, so avatars and chat attachments survive redeploys on hosts with an ephemeral disk.
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { pool } from './db.js';

export const DB_STORE = process.env.FILE_STORE === 'db';
const SAFE = /^(avatars|chat)\/[0-9a-f]{12,32}\.[a-z0-9]{2,5}$/;   // only names this server generated: nothing from a URL can reach outside UPLOAD_DIR

/** Copy a just-written file into the durable store. */
export async function keep(rel, absPath, mime) {
  if (!DB_STORE) return;
  const data = await readFile(absPath);
  await pool.query('INSERT INTO stored_files (path, mime, data) VALUES (?,?,?) ON CONFLICT (path) DO UPDATE SET data = EXCLUDED.data, mime = EXCLUDED.mime', [rel, mime, data]);
}
export async function forget(rel) { if (DB_STORE && SAFE.test(rel || '')) await pool.query('DELETE FROM stored_files WHERE path = ?', [rel]).catch(() => {}); }

/** The file's bytes: disk first, then the durable store (re-warming the disk cache). null if neither has it. */
export async function load(rel, absPath) {
  if (!SAFE.test(rel || '')) return null;
  try { return { data: await readFile(absPath), mime: null }; } catch { /* not on disk */ }
  if (!DB_STORE) return null;
  const [[row]] = await pool.query('SELECT mime, data FROM stored_files WHERE path = ?', [rel]);
  if (!row) return null;
  await mkdir(dirname(absPath), { recursive: true }).then(() => writeFile(absPath, row.data)).catch(() => {});
  return { data: row.data, mime: row.mime };
}
