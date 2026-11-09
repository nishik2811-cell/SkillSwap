import { scryptSync, randomBytes, timingSafeEqual, createHash, createHmac } from 'node:crypto';

export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const newToken = () => randomBytes(32).toString('base64url');

export function hashPassword(pw) {
  const salt = randomBytes(16);
  return `scrypt$${salt.toString('base64')}$${scryptSync(pw, salt, 64).toString('base64')}`;
}

const DUMMY = hashPassword('dummy-password-for-timing');
export function verifyPassword(pw, stored) {
  const [, s, h] = (stored || DUMMY).split('$');
  const a = scryptSync(pw, Buffer.from(s, 'base64'), 64);
  return timingSafeEqual(a, Buffer.from(h, 'base64')) && !!stored;
}

// Short-lived signed token that lets the browser open the live socket from another origin, where the login cookie is not sent.
// Format: base64url({uid,exp}).hmac. Signed with JWT_SECRET; it only proves "this user, for about a minute", never grants more than a socket.
const sockSecret = () => { if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 16) throw new Error('JWT_SECRET must be set (16+ chars)'); return process.env.JWT_SECRET; };
const sockSig = (body) => createHmac('sha256', sockSecret()).update(`socket:${body}`).digest('base64url');
export function signSocketToken(userId, ttlSec = 60) {
  const body = Buffer.from(JSON.stringify({ uid: userId, exp: Math.floor(Date.now() / 1000) + ttlSec })).toString('base64url');
  return `${body}.${sockSig(body)}`;
}
export function verifySocketToken(token) { // -> user id, or null
  try {
    const [body, sig] = String(token).split('.'); if (!body || !sig) return null;
    const a = Buffer.from(sockSig(body)), b = Buffer.from(sig); if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    const { uid, exp } = JSON.parse(Buffer.from(body, 'base64url').toString());
    return Number.isInteger(uid) && exp > Date.now() / 1000 ? uid : null;
  } catch { return null; }
}
