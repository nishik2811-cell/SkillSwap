// PostgreSQL access with the same shape the app used with mysql2:
//   const [rows] = await pool.query('SELECT ... WHERE id = ?', [id])        -> rows
//   const [r]    = await pool.query('INSERT ...')  /  'UPDATE ...'          -> { insertId, affectedRows }
// plus getConnection() with beginTransaction/commit/rollback/release, and inTx().
// Simple MySQL-isms are translated here so one place owns the dialect difference; anything else is written in PostgreSQL in the route.
import pg from 'pg';

pg.types.setTypeParser(20, (v) => Number(v));     // bigint: ids and COUNT(*) are plain numbers
pg.types.setTypeParser(1700, (v) => Number(v));   // numeric: SUM(), DECIMAL

const config = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL }
  : { host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 5432), user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME };
const pool_ = new pg.Pool({ ...config, max: Number(process.env.DB_POOL_MAX || 10), idleTimeoutMillis: 30_000, connectionTimeoutMillis: 15_000 });
pool_.on('error', (e) => console.error('idle pg client error', e.message));

const UNIT = { SECOND: 'second', MINUTE: 'minute', HOUR: 'hour', DAY: 'day' };

/** MySQL-flavoured SQL + params -> { text, values } for pg. Exported for tests. */
export function translate(sql, params = []) {
  let s = sql.replace(/`/g, '"').replace(/\bUTC_TIMESTAMP\(\)/gi, 'NOW()');
  // DATE_ADD/DATE_SUB(x, INTERVAL n UNIT) -> (x +/- n * INTERVAL '1 unit')
  s = s.replace(/\bDATE_(ADD|SUB)\(\s*([^,()]*(?:\([^()]*\))?[^,()]*?)\s*,\s*INTERVAL\s+([\w.?]+)\s+(SECOND|MINUTE|HOUR|DAY)S?\s*\)/gi,
    (_, op, a, n, unit) => `(${a.trim() === '?' ? '?::timestamptz' : a.trim()} ${op.toUpperCase() === 'ADD' ? '+' : '-'} (${/^\d+$/.test(n) ? n : `${n}::int`} * INTERVAL '1 ${UNIT[unit.toUpperCase()]}'))`);
  s = s.replace(/\b(LEAST|GREATEST)\(\s*\?\s*,\s*\?\s*\)/gi, '$1(?::bigint, ?::bigint)');   // untyped params would be text
  let ignore = false;
  s = s.replace(/^\s*INSERT\s+IGNORE\s+INTO/i, () => { ignore = true; return 'INSERT INTO'; });
  s = s.replace(/\bLIKE\b/gi, 'ILIKE');   // MySQL's default collation compared case-insensitively
  const values = []; let i = 0; const src = s;
  s = src.replace(/\?(?![:\w])|\?(?=::)/g, (m, offset) => {
    const v = params[i++]; const before = src.slice(0, offset);
    if (Array.isArray(v) && /\bIN\s*\(\s*$/i.test(before)) { if (!v.length) return 'NULL'; return v.map((x) => { values.push(x); return `$${values.length}`; }).join(','); }
    if (Array.isArray(v) && /\bVALUES\s*$/i.test(before)) return v.map((row) => `(${row.map((x) => { values.push(x === undefined ? null : x); return `$${values.length}`; }).join(',')})`).join(',');
    values.push(v === undefined ? null : v); return `$${values.length}`;
  });
  if (ignore) s += ' ON CONFLICT DO NOTHING';
  if (/^\s*INSERT/i.test(s) && !/\bRETURNING\b/i.test(s)) s += ' RETURNING *';
  return { text: s, values };
}

function mapError(e) {
  e.pgCode = e.code;
  const detail = [e.message, e.detail, e.constraint].filter(Boolean).join(' | ');
  if (e.pgCode === '23505') { e.code = 'ER_DUP_ENTRY'; e.message = `Duplicate entry: ${e.constraint || ''}`; }
  else if (e.pgCode === '23503') { const del = /still referenced/i.test(e.detail || ''); e.code = del ? 'ER_ROW_IS_REFERENCED_2' : 'ER_NO_REFERENCED_ROW_2'; e.message = `Cannot ${del ? 'delete' : 'add'} or update a row: a foreign key constraint fails (${e.constraint || ''})`; }
  else if (e.pgCode === '23514') e.code = 'ER_CHECK_CONSTRAINT_VIOLATED';
  else if (e.pgCode === '40P01') e.code = 'ER_LOCK_DEADLOCK';
  else if (e.pgCode === '40001') e.code = 'ER_LOCK_DEADLOCK';        // serialization failure: also safe to retry
  e.sqlMessage = detail;
  return e;
}

async function run(client, sql, params) {
  const { text, values } = translate(sql, params);
  let r;
  try { r = await client.query(text, values); } catch (e) { throw mapError(e); }
  if (Array.isArray(r)) r = r.at(-1);                                   // multi-statement script: last result
  if (r.command === 'SELECT') return [r.rows, r.fields];
  if (r.command === 'INSERT') return [{ insertId: r.rows?.[0]?.id ?? 0, affectedRows: r.rowCount }];
  return [{ affectedRows: r.rowCount, changedRows: r.rowCount }];
}

export const pool = {
  query: (sql, params) => run(pool_, sql, params),
  raw: (sql) => pool_.query(sql),                                       // untranslated (migrations)
  async getConnection() {
    const c = await pool_.connect();
    return { query: (sql, params) => run(c, sql, params), beginTransaction: () => c.query('BEGIN'), commit: () => c.query('COMMIT'), rollback: () => c.query('ROLLBACK'), release: () => c.release() };
  },
  end: () => pool_.end(),
};

/** Run fn(conn) in a transaction; retries on deadlock/serialization failure (a normal outcome under concurrency). */
export async function inTx(fn, attempts = 3) {
  for (let i = 1; ; i++) {
    const conn = await pool.getConnection();
    try { await conn.beginTransaction(); const r = await fn(conn); await conn.commit(); return r; }
    catch (e) { await conn.rollback().catch(() => {}); if (e.code === 'ER_LOCK_DEADLOCK' && i < attempts) continue; throw e; }
    finally { conn.release(); }
  }
}
