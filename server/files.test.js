import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';

process.env.FILE_STORE = 'db';                       // this file only: the durable store is read once, at import
const { keep, load, forget } = await import('./src/files.js');
const { pool } = await import('./src/db.js');
const { createHash } = await import('node:crypto');

test('an upload survives losing the disk (FILE_STORE=db) and cannot be asked for outside UPLOAD_DIR', async (t) => {
  const dir = await mkdtemp(tmpdir() + '/ss-files-'); t.after(async () => { await rm(dir, { recursive: true, force: true }); await pool.end(); });
  const rel = `avatars/${createHash('sha1').update(String(Math.random())).digest('hex').slice(0, 24)}.png`, abs = `${dir}/${rel}`;
  await rm(`${dir}/avatars`, { recursive: true, force: true });
  const { mkdir } = await import('node:fs/promises'); await mkdir(`${dir}/avatars`);
  await writeFile(abs, Buffer.from([1, 2, 3, 4]));
  await keep(rel, abs, 'image/png');

  await rm(abs);                                      // a redeploy wipes the disk
  const f = await load(rel, abs);
  assert.deepEqual([...f.data], [1, 2, 3, 4]); assert.equal(f.mime, 'image/png');
  await access(abs);                                  // and the disk cache is warm again

  await forget(rel); await rm(abs);
  assert.equal(await load(rel, abs), null);           // gone everywhere once deleted

  for (const bad of ['../.env', 'avatars/../../.env', '/etc/passwd', 'avatars/zz.png', 'chat/abc']) assert.equal(await load(bad, `${dir}/${bad}`), null, bad);
});
