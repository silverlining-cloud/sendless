import { randomBytes, scrypt, timingSafeEqual, type BinaryLike, type ScryptOptions } from 'node:crypto';

/** URL-safe random identifier. 16 bytes = 128 bits. */
export function randomId(bytes = 16): string {
  return randomBytes(bytes).toString('base64url');
}

export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

const SCRYPT = { N: 16384, r: 8, p: 1, keyLength: 32 };

function scryptAsync(password: BinaryLike, salt: BinaryLike, keyLength: number, options: ScryptOptions) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keyLength, options, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Returns `scrypt$N$r$p$salt$hash` (base64url parts). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p, keyLength } = SCRYPT;
  const hash = await scryptAsync(password.normalize('NFC'), salt, keyLength, { N, r, p, maxmem: 64 * 1024 * 1024 });
  return ['scrypt', N, r, p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = await scryptAsync(password.normalize('NFC'), Buffer.from(saltB64, 'base64url'), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
