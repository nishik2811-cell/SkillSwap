import test from 'node:test';
import assert from 'node:assert/strict';
import { app } from './src/app.js';
import { pool } from './src/db.js';

test('GET /api/v1/health reports db up', async (t) => {
  const srv = app.listen(0);
  t.after(() => { srv.close(); pool.end(); });
  const res = await fetch(`http://127.0.0.1:${srv.address().port}/api/v1/health`);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, db: 'up' });
});
