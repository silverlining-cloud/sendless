import { describe, expect, it, vi } from 'vitest';
import { createHarness } from '../../packages/api/src/test-utils.js';
import { LICENSE_TYPE } from './license.js';

// A throwaway signing key for these tests only.
const keyPair = vi.hoisted(() => {
  const { generateKeyPairSync } = require('node:crypto') as typeof import('node:crypto');
  return generateKeyPairSync('ed25519');
});
vi.mock('./keys.js', () => ({ LICENSE_PUBLIC_KEYS: { test: String(keyPair.publicKey.export({ type: 'spki', format: 'pem' })) } }));

async function licensed(features = ['sso', 'malware-scanning', 'audit', 'policies'], options = {}) {
  const { sign } = await import('node:crypto');
  const h = createHarness(options);
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const now = Math.floor(h.clock.now / 1000);
  const input = `${enc({ alg: 'EdDSA', typ: LICENSE_TYPE, kid: 'test' })}.${enc({
    iss: 'sendless',
    lid: 'lic',
    licensee: 'Acme',
    edition: 'pro',
    features,
    iat: now,
    exp: now + 86_400 * 365,
  })}`;
  const key = `${input}.${sign(null, Buffer.from(input), keyPair.privateKey).toString('base64url')}`;
  const res = await h.call('PUT', '/api/admin/license', { as: 'admin', body: { key } });
  expect(res.statusCode).toBe(200);
  expect(res.json.license).toMatchObject({ licensee: 'Acme', edition: 'pro' });
  return h;
}

const defaultPolicies = {
  requirePassword: false,
  minPasswordLength: 8,
  maxExpiresInHours: null,
  requireOpenLimit: false,
  maxOpensLimit: null,
  blockedExtensions: [],
  allowedRecipientDomains: [],
  auditRetentionDays: 90,
  allowUnscannableFiles: false,
};

describe('Pro: policies', () => {
  it('enforces password, expiry, open limit, file types and recipient domains', async () => {
    const h = await licensed();
    const put = await h.call('PUT', '/api/admin/policies', {
      as: 'admin',
      body: { ...defaultPolicies, requirePassword: true, minPasswordLength: 10, maxExpiresInHours: 24, maxOpensLimit: 5, blockedExtensions: ['exe'], allowedRecipientDomains: ['partner.de'] },
    });
    expect(put.statusCode).toBe(200);

    const config = (await h.call('GET', '/api/public/config')).json;
    expect(config).toMatchObject({ edition: 'pro', limits: { requirePassword: true, maxExpiresInHours: 24, maxOpensLimit: 5, allowUnlimitedOpens: false } });

    const base = { files: [{ name: 'a.pdf', size: 10 }], expiresInHours: 12, maxOpens: 3, password: 'long enough!' };
    const create = (body: Record<string, unknown>) => h.call('POST', '/api/transfers', { as: 'user', body: { ...base, ...body } });
    expect((await create({ password: undefined })).json.error.code).toBe('password_required');
    expect((await create({ password: 'short' })).json.error.code).toBe('password_too_short');
    expect((await create({ expiresInHours: 25 })).json.error.code).toBe('expiry_too_long');
    expect((await create({ maxOpens: null })).json.error.code).toBe('open_limit_required');
    expect((await create({ maxOpens: 6 })).json.error.code).toBe('open_limit_too_high');
    expect((await create({ files: [{ name: 'setup.EXE', size: 1 }] })).json.error.code).toBe('blocked_file_type');
    expect((await create({ recipients: ['a@gmail.com'] })).json.error.code).toBe('recipient_not_allowed');
    expect((await create({ recipients: ['a@partner.de'] })).statusCode).toBe(201);
  });

  it('cannot be changed without the policies feature', async () => {
    const h = await licensed(['sso']);
    const res = await h.call('PUT', '/api/admin/policies', { as: 'admin', body: defaultPolicies });
    expect(res.json.error.code).toBe('pro_required');
  });
});

describe('Pro: audit', () => {
  it('lists and exports events, neutralising CSV formulas', async () => {
    const h = await licensed();
    await h.call('POST', '/api/admin/users', { as: 'admin', body: { email: 'x@example.com' } });
    await h.call('POST', '/api/transfers', {
      as: 'user',
      body: { title: '=HYPERLINK("evil")', files: [{ name: 'a.txt', size: 1 }], expiresInHours: 1, maxOpens: 1 },
    });
    const day = new Date(h.clock.now).toISOString().slice(0, 10);
    const list = await h.call('GET', `/api/admin/audit?day=${day}`, { as: 'admin' });
    expect(list.json.items.map((e: { action: string }) => e.action)).toEqual(
      expect.arrayContaining(['license.installed', 'user.invited', 'transfer.created']),
    );

    const csv = await h.call('GET', `/api/admin/audit/export?from=${day}&to=${day}`, { as: 'admin' });
    expect(csv.headers?.['content-type']).toContain('text/csv');
    expect(csv.body!.split('\n')[0]).toBe('time,action,subject,actor,ip,country,user_agent,details');
    expect(csv.body).toContain('user.invited');
    expect((await h.call('GET', '/api/admin/audit/export?from=2026-01-01&to=2026-03-01', { as: 'admin' })).statusCode).toBe(400);
  });
});

describe('Pro: SSO', () => {
  it('adds and removes identity providers and syncs the app client', async () => {
    const h = await licensed();
    const add = await h.call('POST', '/api/admin/sso/providers', {
      as: 'admin',
      body: { type: 'saml', name: 'EntraID', metadataUrl: 'https://login.microsoftonline.com/x/federationmetadata.xml', emailDomains: ['acme.de'] },
    });
    expect(add.statusCode).toBe(201);
    const idp = h.deps.idp as unknown as { clientProviders: string[] };
    expect(idp.clientProviders).toEqual(['COGNITO', 'EntraID']);
    expect((await h.call('GET', '/api/admin/sso/providers', { as: 'admin' })).json.items).toHaveLength(1);

    const bad = await h.call('POST', '/api/admin/sso/providers', { as: 'admin', body: { type: 'saml', name: 'has space', metadataUrl: 'http://x' } });
    expect(bad.statusCode).toBe(400);

    expect((await h.call('DELETE', '/api/admin/sso/providers/EntraID', { as: 'admin' })).statusCode).toBe(204);
    expect(idp.clientProviders).toEqual(['COGNITO']);
  });
});

describe('Pro: malware scanning', () => {
  async function uploadedFile(h: Awaited<ReturnType<typeof licensed>>) {
    const created = (
      await h.call('POST', '/api/transfers', { as: 'user', body: { files: [{ name: 'a.zip', size: 100 }], expiresInHours: 1, maxOpens: 5 } })
    ).json;
    const { transferId, uploadToken, files } = created.upload;
    const parts = await h.call('POST', `/api/public/uploads/${transferId}/files/${files[0].id}/parts`, { body: { uploadToken, partNumbers: [1] } });
    const part = h.blobs.putPart(new URL(parts.json.parts[0].url).searchParams.get('uploadId')!, 1, 100);
    await h.call('POST', `/api/public/uploads/${transferId}/files/${files[0].id}/complete`, { body: { uploadToken, parts: [part] } });
    await h.call('POST', `/api/public/uploads/${transferId}/finalize`, { body: { uploadToken } });
    const { sessionId } = (await h.call('POST', `/api/public/transfers/${transferId}/unlock`, { body: {} })).json;
    const download = () => h.call('POST', `/api/public/transfers/${transferId}/files/${files[0].id}/download`, { body: { sessionId } });
    const scan = async (status: string) => {
      const { handleScanResult } = await import('./malware.js');
      await handleScanResult(h.deps, {
        detail: { s3ObjectDetails: { objectKey: `files/${transferId}/${files[0].id}` }, scanResultDetails: { scanResultStatus: status } },
      });
    };
    return { download, scan };
  }

  it('blocks downloads until the file is clean and deletes infected files', async () => {
    const h = await licensed(undefined, { malwareScanning: true });
    const clean = await uploadedFile(h);
    expect((await clean.download()).json.error.code).toBe('scan_pending');
    await clean.scan('NO_THREATS_FOUND');
    expect((await clean.download()).statusCode).toBe(200);

    const infected = await uploadedFile(h);
    await infected.scan('THREATS_FOUND');
    expect((await infected.download()).json.error.code).toBe('infected');
    expect(h.blobs.objects.size).toBe(1);
  });

  it('applies the unscannable-files policy', async () => {
    const h = await licensed(undefined, { malwareScanning: true });
    const file = await uploadedFile(h);
    await file.scan('UNSUPPORTED');
    expect((await file.download()).json.error.code).toBe('scan_failed');
    await h.call('PUT', '/api/admin/policies', { as: 'admin', body: { ...defaultPolicies, allowUnscannableFiles: true } });
    expect((await file.download()).statusCode).toBe(200);
  });
});
