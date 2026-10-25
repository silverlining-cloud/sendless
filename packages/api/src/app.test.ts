import { describe, expect, it } from 'vitest';
import { createHarness } from './test-utils.js';

describe('app', () => {
  it('requires sign-in for private routes and admin rights for admin routes', async () => {
    const h = createHarness();
    expect((await h.call('GET', '/api/transfers')).statusCode).toBe(401);
    expect((await h.call('GET', '/api/admin/settings', { as: 'user' })).statusCode).toBe(403);
    expect((await h.call('GET', '/api/admin/settings', { as: 'admin' })).statusCode).toBe(200);
  });

  it('answers unknown routes and wrong methods', async () => {
    const h = createHarness();
    expect((await h.call('GET', '/api/nope')).json.error.code).toBe('route_not_found');
    expect((await h.call('PUT', '/api/public/config')).statusCode).toBe(405);
  });

  it('serves public config without secrets', async () => {
    const h = createHarness();
    const res = await h.call('GET', '/api/public/config');
    expect(res.json).toMatchObject({ edition: 'community', auth: { userPoolId: 'pool', clientId: 'client' } });
    expect(JSON.stringify(res.json)).not.toContain('licenseKey');
  });

  it('gates Pro routes behind a license', async () => {
    const h = createHarness();
    const res = await h.call('GET', '/api/admin/audit', { as: 'admin' });
    expect(res.statusCode).toBe(403);
    expect(res.json.error.code).toBe('pro_required');
    const bad = await h.call('PUT', '/api/admin/license', { as: 'admin', body: { key: 'a.b.c' } });
    expect(bad.json.error.code).toBe('invalid_license');
  });

  it('validates and stores settings', async () => {
    const h = createHarness();
    const current = (await h.call('GET', '/api/admin/settings', { as: 'admin' })).json.settings;
    const css = await h.call('PUT', '/api/admin/settings', {
      as: 'admin',
      body: { ...current, branding: { ...current.branding, primaryColor: 'red;}body{display:none' } },
    });
    expect(css.statusCode).toBe(400);
    const ok = await h.call('PUT', '/api/admin/settings', {
      as: 'admin',
      body: { ...current, branding: { ...current.branding, appName: 'Acme Files' } },
    });
    expect(ok.json.settings.branding.appName).toBe('Acme Files');
    expect((await h.call('GET', '/api/public/config')).json.branding.appName).toBe('Acme Files');
  });

  it('manages users but keeps at least one admin', async () => {
    const h = createHarness();
    const invited = await h.call('POST', '/api/admin/users', { as: 'admin', body: { email: 'New@Example.com' } });
    expect(invited.json).toMatchObject({ email: 'new@example.com', isAdmin: false });
    expect((await h.call('PATCH', '/api/admin/users/admin-example-com', { as: 'admin', body: { admin: false } })).json.error.code).toBe(
      'self_change',
    );
    expect((await h.call('DELETE', '/api/admin/users/user-example-com', { as: 'admin' })).statusCode).toBe(204);
  });
});
