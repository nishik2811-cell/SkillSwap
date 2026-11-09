// Usage: npm run make-admin -w server -- <username>      (the account must already exist and be verified)
import { pool } from '../src/db.js';
const username = (process.argv[2] || '').toLowerCase();
if (!username) { console.error('usage: make-admin <username>'); process.exit(1); }
const [r] = await pool.query("UPDATE users SET role = 'admin' WHERE username = ?", [username]);
console.log(r.affectedRows ? `${username} is now an admin` : `no user named ${username}`);
await pool.end(); process.exit(r.affectedRows ? 0 : 1);
