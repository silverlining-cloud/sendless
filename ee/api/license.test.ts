import { generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LICENSE_TYPE, verifyLicense } from './license.js';

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
const keys = { test: String(publicKey.export({ type: 'spki', format: 'pem' })) };
const NOW = Date.parse('2026-06-01T00:00:00Z');

function issue(payload: Record<string, unknown>, header: Record<string, unknown> = {}) {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const input = `${enc({ alg: 'EdDSA', typ: LICENSE_TYPE, kid: 'test', ...header })}.${enc({
    iss: 'sendless',
    lid: 'lic-1',
    licensee: 'Acme GmbH',
    edition: 'pro',
    features: ['sso', 'audit'],
    iat: NOW / 1000,
    exp: NOW / 1000 + 365 * 86_400,
    ...payload,
  })}`;
  return `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
}

describe('verifyLicense', () => {
  it('accepts a valid key', () => {
    const result = verifyLicense(issue({}), NOW, keys);
    expect(result).toMatchObject({ ok: true, info: { licensee: 'Acme GmbH', features: ['sso', 'audit'] } });
  });

  it('rejects tampered payloads', () => {
    const [h, , s] = issue({}).split('.');
    const forged = Buffer.from(JSON.stringify({ iss: 'sendless', lid: 'x', licensee: 'Evil', edition: 'pro', features: ['sso'], iat: 0, exp: 9e9 })).toString('base64url');
    expect(verifyLicense(`${h}.${forged}.${s}`, NOW, keys)).toMatchObject({ ok: false, error: expect.stringContaining('signature') });
  });

  it('rejects unknown key ids, garbage and unknown features', () => {
    expect(verifyLicense(issue({}, { kid: 'other' }), NOW, keys).ok).toBe(false);
    expect(verifyLicense('not-a-license', NOW, keys).ok).toBe(false);
    expect(verifyLicense(issue({ features: ['everything'] }), NOW, keys).ok).toBe(false);
  });

  it('has a 14-day grace period after expiry', () => {
    const key = issue({ exp: NOW / 1000 });
    const inGrace = verifyLicense(key, NOW + 3 * 86_400_000, keys);
    expect(inGrace).toMatchObject({ ok: true, warning: expect.stringContaining('expired') });
    expect(verifyLicense(key, NOW + 15 * 86_400_000, keys)).toMatchObject({ ok: false });
  });

  it('accepts nothing when no public keys are configured', () => {
    expect(verifyLicense(issue({}), NOW).ok).toBe(false);
  });
});
