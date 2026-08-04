// Password hashing with node's built-in scrypt - no native or JS bcrypt dep.
// Format: scrypt$N$r$p$saltB64$hashB64
import { randomBytes, scryptSync, timingSafeEqual } from 'crypto';

const N = 16384;
const r = 8;
const p = 1;
const KEYLEN = 32;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, KEYLEN, { N, r, p });
  return `scrypt$${N}$${r}$${p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  try {
    const [scheme, n, rr, pp, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt') return false;
    const salt = Buffer.from(saltB64, 'base64');
    const expected = Buffer.from(hashB64, 'base64');
    const actual = scryptSync(password, salt, expected.length, {
      N: parseInt(n),
      r: parseInt(rr),
      p: parseInt(pp),
    });
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export function passwordProblem(pw: string): string | null {
  if (pw.length < 8) return 'Use at least 8 characters.';
  if (pw.length > 200) return 'That is too long.';
  return null;
}
