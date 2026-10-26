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
    const bad = await h.call('PUT', '/api/admin/settings', {
      as: 'admin',
      body: { ...current, branding: { ...current.branding, privacyUrl: 'javascript:alert(1)' } },
    });
    expect(bad.statusCode).toBe(400);
    const ok = await h.call('PUT', '/api/admin/settings', {
      as: 'admin',
      body: { ...current, branding: { ...current.branding, privacyUrl: 'https://acme.example/privacy' } },
    });
    expect(ok.json.settings.branding.privacyUrl).toBe('https://acme.example/privacy');
    expect((await h.call('GET', '/api/public/config')).json.branding.privacyUrl).toBe('https://acme.example/privacy');
  });

  it('keeps name, logo, colors and texts for Pro', async () => {
    const h = createHarness();
    const pro = { appName: 'Acme Files', logoUrl: 'https://acme.example/logo.png', primaryColor: '#FF0000', backgroundColor: '#FFFFFF', textColor: '#000000', welcomeTitle: 'Hi', welcomeText: null, footerText: 'Acme' };
    const put = await h.call('PUT', '/api/admin/branding', { as: 'admin', body: pro });
    expect(put.json.error.code).toBe('pro_required');

    // The core settings route ignores them.
    const current = (await h.call('GET', '/api/admin/settings', { as: 'admin' })).json.settings;
    await h.call('PUT', '/api/admin/settings', { as: 'admin', body: { ...current, branding: { ...current.branding, ...pro } } });
    expect((await h.call('GET', '/api/admin/settings', { as: 'admin' })).json.branding.primaryColor).toBe('#2F6FB5');

    // Values stored earlier (e.g. under an expired license) don't apply without one.
    await h.deps.updateSettings((s) => ({ ...s, branding: { ...s.branding, ...pro } }));
    const config = (await h.call('GET', '/api/public/config')).json;
    expect(config.branding).toMatchObject({ appName: 'Sendless', logoUrl: null, primaryColor: '#2F6FB5', welcomeTitle: null, footerText: null });
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
