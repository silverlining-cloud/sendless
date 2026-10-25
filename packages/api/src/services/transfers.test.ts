import { describe, expect, it } from 'vitest';
import type { CreateTransferResult, UnlockResult, UploadPlan } from '@s3ndless/shared';
import { createHarness, type Harness } from '../test-utils.js';
import { sweep } from './sweeper.js';

const HOUR = 3600 * 1000;
const MiB = 1024 * 1024;

/** Simulates the browser: presign every part, PUT the bytes, complete each file, finalize. */
async function upload(h: Harness, plan: UploadPlan, sizes?: number[]) {
  for (const [i, file] of plan.files.entries()) {
    const numbers = Array.from({ length: file.partCount }, (_, n) => n + 1);
    const res = await h.call('POST', `/api/public/uploads/${plan.transferId}/files/${file.id}/parts`, {
      body: { uploadToken: plan.uploadToken, partNumbers: numbers },
    });
    expect(res.statusCode).toBe(200);
    const total = sizes?.[i] ?? file.size;
    const parts = res.json.parts.map((p: { partNumber: number; url: string }) => {
      const uploadId = new URL(p.url).searchParams.get('uploadId')!;
      const bytes = p.partNumber < file.partCount ? file.partSize : total - file.partSize * (file.partCount - 1);
      return h.blobs.putPart(uploadId, p.partNumber, bytes);
    });
    const done = await h.call('POST', `/api/public/uploads/${plan.transferId}/files/${file.id}/complete`, {
      body: { uploadToken: plan.uploadToken, parts },
    });
    if (done.statusCode !== 204) return done;
  }
  return h.call('POST', `/api/public/uploads/${plan.transferId}/finalize`, { body: { uploadToken: plan.uploadToken } });
}

async function createTransfer(h: Harness, overrides: Record<string, unknown> = {}) {
  const res = await h.call('POST', '/api/transfers', {
    as: 'user',
    body: {
      title: 'Quarterly report',
      message: 'Here you go',
      files: [
        { name: 'report.pdf', size: 3 * MiB, contentType: 'application/pdf' },
        { name: 'data <img src=x onerror=alert(1)>.csv', size: 20 * MiB, contentType: 'text/csv' },
      ],
      expiresInHours: 48,
      maxOpens: 3,
      recipients: ['Partner@Example.org'],
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json as CreateTransferResult;
}

describe('outbound transfers', () => {
  it('runs the full upload → unlock → download flow', async () => {
    const h = createHarness();
    const created = await createTransfer(h);
    expect(created.transfer.status).toBe('uploading');
    expect(created.upload.files[1]).toMatchObject({ partSize: 8 * MiB, partCount: 3 });

    const finalized = await upload(h, created.upload);
    expect(finalized.statusCode).toBe(200);
    expect(finalized.json.url).toBe(`https://files.example.com/d/${created.transfer.id}`);
    expect(h.mailer.sent.map((m) => m.to)).toEqual(['partner@example.org']);
    expect(h.mailer.sent[0]!.html).not.toContain('<img');

    const meta = await h.call('GET', `/api/public/transfers/${created.transfer.id}`);
    expect(meta.json).toMatchObject({ title: 'Quarterly report', passwordRequired: false, fileCount: 2, opensLeft: 3 });

    const unlocked = await h.call('POST', `/api/public/transfers/${created.transfer.id}/unlock`, { body: {} });
    expect(unlocked.statusCode).toBe(200);
    const { sessionId, files } = unlocked.json as UnlockResult;
    expect(files.map((f) => f.name)).toEqual(['report.pdf', 'data <img src=x onerror=alert(1)>.csv']);

    const dl = await h.call('POST', `/api/public/transfers/${created.transfer.id}/files/${files[1]!.id}/download`, { body: { sessionId } });
    expect(dl.statusCode).toBe(200);
    const disposition = new URL(dl.json.url).searchParams.get('download');
    expect(disposition).toBe(
      `attachment; filename="data <img src=x onerror=alert(1)>.csv"; filename*=UTF-8''data%20%3Cimg%20src%3Dx%20onerror%3Dalert%281%29%3E.csv`,
    );

    const detail = await h.call('GET', `/api/transfers/${created.transfer.id}`, { as: 'user' });
    expect(detail.json.events.map((e: { action: string }) => e.action)).toEqual([
      'file.downloaded',
      'transfer.opened',
      'transfer.ready',
      'transfer.created',
    ]);
    expect(detail.json.events[0]).toMatchObject({ ip: '203.0.113.7', country: 'DE' });
  });

  it('counts the expiry from the end of the upload', async () => {
    const h = createHarness();
    const created = await createTransfer(h, { expiresInHours: 2 });
    h.clock.advance(5 * HOUR);
    await upload(h, created.upload);
    const meta = await h.call('GET', `/api/public/transfers/${created.transfer.id}`);
    expect(meta.json.expiresAt).toBe(new Date(h.clock.now + 2 * HOUR).toISOString());
  });

  it('rejects a file whose uploaded size differs from the announced size', async () => {
    const h = createHarness();
    const created = await createTransfer(h);
    const res = await upload(h, created.upload, [3 * MiB + 1, 20 * MiB]);
    expect(res.statusCode).toBe(400);
    expect(res.json.error.code).toBe('size_mismatch');
    const finalize = await h.call('POST', `/api/public/uploads/${created.transfer.id}/finalize`, {
      body: { uploadToken: created.upload.uploadToken },
    });
    expect(finalize.json.error.code).toBe('upload_incomplete');
  });

  it('rejects upload calls with a wrong token', async () => {
    const h = createHarness();
    const created = await createTransfer(h);
    const res = await h.call('POST', `/api/public/uploads/${created.transfer.id}/finalize`, { body: { uploadToken: 'x'.repeat(32) } });
    expect(res.statusCode).toBe(404);
  });

  it('enforces the open limit atomically and shortens retention after the last open', async () => {
    const h = createHarness();
    const created = await createTransfer(h, { maxOpens: 2 });
    await upload(h, created.upload);
    const id = created.transfer.id;
    expect((await h.call('POST', `/api/public/transfers/${id}/unlock`, { body: {} })).statusCode).toBe(200);
    expect((await h.call('POST', `/api/public/transfers/${id}/unlock`, { body: {} })).statusCode).toBe(200);
    const third = await h.call('POST', `/api/public/transfers/${id}/unlock`, { body: {} });
    expect(third.statusCode).toBe(410);
    expect(third.json.error.code).toBe('limit_reached');
    const record = await h.store.getTransfer(id);
    expect(record!.deleteAfter).toBe(h.clock.now + HOUR);
  });

  it('locks a link after 10 wrong passwords for 15 minutes', async () => {
    const h = createHarness();
    const created = await createTransfer(h, { password: 'correct horse' });
    await upload(h, created.upload);
    const id = created.transfer.id;
    const meta = await h.call('GET', `/api/public/transfers/${id}`);
    expect(meta.json.passwordRequired).toBe(true);

    for (let i = 0; i < 10; i++) {
      const res = await h.call('POST', `/api/public/transfers/${id}/unlock`, { body: { password: 'wrong' } });
      expect(res.json.error.code).toBe('wrong_password');
    }
    const locked = await h.call('POST', `/api/public/transfers/${id}/unlock`, { body: { password: 'correct horse' } });
    expect(locked.statusCode).toBe(429);

    h.clock.advance(15 * 60 * 1000 + 1);
    const ok = await h.call('POST', `/api/public/transfers/${id}/unlock`, { body: { password: 'correct horse' } });
    expect(ok.statusCode).toBe(200);
  });

  it('expires links and lets the sweeper delete the files', async () => {
    const h = createHarness();
    const created = await createTransfer(h, { expiresInHours: 1 });
    await upload(h, created.upload);
    expect(h.blobs.objects.size).toBe(2);

    h.clock.advance(HOUR + 1);
    const meta = await h.call('GET', `/api/public/transfers/${created.transfer.id}`);
    expect(meta.statusCode).toBe(410);

    const result = await sweep(h.deps);
    expect(result).toMatchObject({ transfers: 1, errors: 0 });
    expect(h.blobs.objects.size).toBe(0);
    expect((await h.store.getTransfer(created.transfer.id))!.status).toBe('expired');
    expect((await sweep(h.deps)).transfers).toBe(0);
  });

  it('discards uploads that were never finished', async () => {
    const h = createHarness();
    const created = await createTransfer(h);
    h.clock.advance(24 * HOUR + 1);
    await sweep(h.deps);
    expect(h.blobs.uploads.size).toBe(0);
    expect((await h.store.getTransfer(created.transfer.id))!.status).toBe('expired');
  });

  it('lets the owner revoke a link', async () => {
    const h = createHarness();
    const created = await createTransfer(h);
    await upload(h, created.upload);
    const other = await h.call('DELETE', `/api/transfers/${created.transfer.id}`, { as: 'admin' });
    expect(other.statusCode).toBe(404); // not the owner
    const res = await h.call('DELETE', `/api/transfers/${created.transfer.id}`, { as: 'user' });
    expect(res.statusCode).toBe(204);
    expect(h.blobs.objects.size).toBe(0);
    expect((await h.call('GET', `/api/public/transfers/${created.transfer.id}`)).statusCode).toBe(410);
  });

  it('validates limits', async () => {
    const h = createHarness();
    const tooLong = await h.call('POST', '/api/transfers', {
      as: 'user',
      body: { files: [{ name: 'a.txt', size: 1 }], expiresInHours: 31 * 24, maxOpens: 1 },
    });
    expect(tooLong.json.error.code).toBe('expiry_too_long');
    const tooBig = await h.call('POST', '/api/transfers', {
      as: 'user',
      body: { files: [{ name: 'a.bin', size: 21 * 1024 ** 3 }], expiresInHours: 1, maxOpens: 1 },
    });
    expect(tooBig.json.error.code).toBe('too_large');
    const empty = await h.call('POST', '/api/transfers', {
      as: 'user',
      body: { files: [{ name: 'a.txt', size: 0 }], expiresInHours: 1, maxOpens: 1 },
    });
    expect(empty.statusCode).toBe(400);
  });

  it('refuses recipients when email is not configured', async () => {
    const h = createHarness({ email: false });
    const res = await h.call('POST', '/api/transfers', {
      as: 'user',
      body: { files: [{ name: 'a.txt', size: 1 }], expiresInHours: 1, maxOpens: 1, recipients: ['x@example.org'] },
    });
    expect(res.json.error.code).toBe('email_disabled');
  });
});
