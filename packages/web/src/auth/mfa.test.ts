import { beforeEach, describe, expect, it, vi } from 'vitest';
import { devMfa, MfaError, totp } from './mfa.js';

// RFC 6238, appendix B: the ASCII key "12345678901234567890" in base32.
const RFC_KEY = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';

describe('totp', () => {
  it('matches the RFC 6238 test vectors (6 digits, SHA-1)', async () => {
    expect(await totp(RFC_KEY, Math.floor(59 / 30))).toBe('287082');
    expect(await totp(RFC_KEY, Math.floor(1111111109 / 30))).toBe('081804');
    expect(await totp(RFC_KEY, Math.floor(2000000000 / 30))).toBe('279037');
  });
});

describe('two-factor stand-in for local development', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    vi.stubGlobal('sessionStorage', {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => store.set(k, v),
      removeItem: (k: string) => store.delete(k),
    });
  });

  it('turns on with the current code and off again', async () => {
    const mfa = devMfa('ann@example.com');
    expect(await mfa.enabled()).toBe(false);
    const secret = await mfa.begin();
    await expect(mfa.confirm('000000')).rejects.toBeInstanceOf(MfaError);
    await mfa.confirm(await totp(secret, Math.floor(Date.now() / 30_000)));
    expect(await mfa.enabled()).toBe(true);
    await mfa.disable();
    expect(await mfa.enabled()).toBe(false);
  });
});
