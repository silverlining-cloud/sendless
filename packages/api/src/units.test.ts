import { describe, expect, it } from 'vitest';
import { hashPassword, verifyPassword } from './crypto.js';
import { contentDisposition, planParts, safeContentType, sanitizeFileName } from './files.js';
import { fromFunctionUrlEvent } from './http.js';
import { Router } from './router.js';

const MiB = 1024 * 1024;

describe('planParts', () => {
  it('uses 8 MiB parts for normal files', () => {
    expect(planParts(1)).toEqual({ partSize: 8 * MiB, partCount: 1 });
    expect(planParts(8 * MiB)).toEqual({ partSize: 8 * MiB, partCount: 1 });
    expect(planParts(8 * MiB + 1)).toEqual({ partSize: 8 * MiB, partCount: 2 });
  });
  it('grows parts to stay within 10,000 parts', () => {
    const fiveTiB = 5 * 1024 * 1024 * MiB;
    const plan = planParts(fiveTiB);
    expect(plan.partCount).toBeLessThanOrEqual(10_000);
    expect(plan.partSize % MiB).toBe(0);
  });
});

describe('file names', () => {
  it('neutralises path separators and strips control characters', () => {
    expect(sanitizeFileName('../../etc/passwd')).toBe('.._.._etc_passwd');
    expect(sanitizeFileName('notes <b>bold</b>.txt')).toBe('notes <b>bold<_b>.txt');
    expect(sanitizeFileName('a\u0000b\nc.txt')).toBe('abc.txt');
    expect(sanitizeFileName('   ')).toBe('file');
  });
  it('builds a header that cannot be broken out of', () => {
    expect(contentDisposition('Bericht "Q1"; ö.pdf')).toBe(
      `attachment; filename="Bericht _Q1__ o.pdf"; filename*=UTF-8''Bericht%20%22Q1%22%3B%20%C3%B6.pdf`,
    );
    expect(contentDisposition('日本.txt')).toBe(`attachment; filename="__.txt"; filename*=UTF-8''%E6%97%A5%E6%9C%AC.txt`);
  });
  it('only passes through well-formed content types', () => {
    expect(safeContentType('application/PDF')).toBe('application/pdf');
    expect(safeContentType('text/html\r\nX-Evil: 1')).toBe('application/octet-stream');
  });
});

describe('passwords', () => {
  it('hashes with scrypt and verifies', async () => {
    const hash = await hashPassword('Grüße 123');
    expect(hash.startsWith('scrypt$16384$8$1$')).toBe(true);
    expect(await verifyPassword('Grüße 123', hash)).toBe(true);
    expect(await verifyPassword('Grüsse 123', hash)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
  });
});

describe('router', () => {
  it('matches parameters and decodes them', async () => {
    const router = new Router().get('/api/a/{id}/b/{name}', async (_req, p) => ({ statusCode: 200, body: JSON.stringify(p) }));
    const res = await router.handle(fromFunctionUrlEvent({ rawPath: '/api/a/x1/b/hello%20world', requestContext: { http: { method: 'GET' } } }));
    expect(JSON.parse(res.body!)).toEqual({ id: 'x1', name: 'hello world' });
  });
});

describe('function URL events', () => {
  it('takes the viewer IP from CloudFront headers', () => {
    const req = fromFunctionUrlEvent({
      rawPath: '/api/x',
      headers: { 'CloudFront-Viewer-Address': '2001:db8::1:443', 'x-forwarded-for': '198.51.100.1, 10.0.0.1' },
      requestContext: { http: { method: 'post', sourceIp: '10.0.0.1' } },
      body: Buffer.from('{"a":1}').toString('base64'),
      isBase64Encoded: true,
    });
    expect(req).toMatchObject({ method: 'POST', ip: '2001:db8::1', body: '{"a":1}' });
    const viaForwarded = fromFunctionUrlEvent({
      rawPath: '/api/x',
      headers: { 'x-forwarded-for': '198.51.100.1, 10.0.0.1' },
      requestContext: { http: { method: 'GET' } },
    });
    expect(viaForwarded.ip).toBe('198.51.100.1');
  });
});
