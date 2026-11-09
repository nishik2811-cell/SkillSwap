import { scryptSync, randomBytes, timingSafeEqual, createHash } from 'node:crypto';

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
