import { describe, expect, it } from 'vitest';
import type { RequestSummary, SubmissionResult } from '@sendless/shared';
import { createHarness, type Harness } from '../test-utils.js';

async function createRequest(h: Harness, overrides: Record<string, unknown> = {}) {
  const res = await h.call('POST', '/api/requests', {
    as: 'user',
    body: {
      title: 'Tax documents 2026',
      message: 'Please upload your receipts',
      expiresInHours: 72,
      maxSubmissions: 2,
      maxBytesPerSubmission: 10_000_000,
      retentionHours: 24 * 7,
      ...overrides,
    },
  });
  expect(res.statusCode).toBe(201);
  return res.json as RequestSummary;
}

async function submit(h: Harness, requestId: string, body: Record<string, unknown> = {}) {
  return h.call('POST', `/api/public/requests/${requestId}/submissions`, {
    body: { name: 'Erika Mustermann', email: 'erika@example.org', files: [{ name: 'receipt.pdf', size: 1000 }], ...body },
  });
}

async function finishUpload(h: Harness, result: SubmissionResult) {
  const { upload } = result;
  for (const file of upload.files) {
    const parts = await h.call('POST', `/api/public/uploads/${upload.transferId}/files/${file.id}/parts`, {
      body: { uploadToken: upload.uploadToken, partNumbers: [1] },
    });
    const uploadId = new URL(parts.json.parts[0].url).searchParams.get('uploadId')!;
    const part = h.blobs.putPart(uploadId, 1, file.size);
    await h.call('POST', `/api/public/uploads/${upload.transferId}/files/${file.id}/complete`, {
      body: { uploadToken: upload.uploadToken, parts: [part] },
    });
  }
  return h.call('POST', `/api/public/uploads/${upload.transferId}/finalize`, { body: { uploadToken: upload.uploadToken } });
}

describe('file requests', () => {
  it('accepts uploads from outsiders and shows them to the owner', async () => {
    const h = createHarness();
    const request = await createRequest(h);
    expect(request.url).toBe(`https://files.example.com/r/${request.id}`);

    const pub = await h.call('GET', `/api/public/requests/${request.id}`);
    expect(pub.json).toMatchObject({ title: 'Tax documents 2026', passwordRequired: false, maxBytesPerSubmission: 10_000_000 });

    const submitted = await submit(h, request.id);
    expect(submitted.statusCode).toBe(201);
    const finalized = await finishUpload(h, submitted.json);
    expect(finalized.json.url).toBeNull();
    expect(h.mailer.sent.at(-1)).toMatchObject({ to: 'user@example.com', replyTo: 'erika@example.org' });

    const detail = await h.call('GET', `/api/requests/${request.id}`, { as: 'user' });
    expect(detail.json.submissions).toBe(1);
    expect(detail.json.transfers).toHaveLength(1);
    const inbound = detail.json.transfers[0];
    expect(inbound).toMatchObject({ kind: 'inbound', submitter: { name: 'Erika Mustermann' }, url: null });

    // Inbound files are only for the owner, never via the public download page.
    expect((await h.call('GET', `/api/public/transfers/${inbound.id}`)).statusCode).toBe(404);
    const file = (await h.call('GET', `/api/transfers/${inbound.id}`, { as: 'user' })).json.files[0];
    const dl = await h.call('POST', `/api/transfers/${inbound.id}/files/${file.id}/download`, { as: 'user' });
    expect(dl.statusCode).toBe(200);

    const listed = await h.call('GET', '/api/transfers?kind=inbound', { as: 'user' });
    expect(listed.json.items).toHaveLength(1);
  });

  it('enforces the submission limit and per-submission size', async () => {
    const h = createHarness();
    const request = await createRequest(h, { maxSubmissions: 1 });
    const tooBig = await submit(h, request.id, { files: [{ name: 'big.zip', size: 10_000_001 }] });
    expect(tooBig.json.error.code).toBe('too_large');
    expect((await submit(h, request.id)).statusCode).toBe(201);
    const full = await submit(h, request.id);
    expect(full.statusCode).toBe(410);
  });

  it('protects requests with a password', async () => {
    const h = createHarness();
    const request = await createRequest(h, { password: 's3cret!' });
    expect((await submit(h, request.id)).json.error.code).toBe('wrong_password');
    expect((await submit(h, request.id, { password: 's3cret!' })).statusCode).toBe(201);
  });

  it('closes revoked and expired requests', async () => {
    const h = createHarness();
    const request = await createRequest(h);
    await h.call('DELETE', `/api/requests/${request.id}`, { as: 'user' });
    expect((await h.call('GET', `/api/public/requests/${request.id}`)).statusCode).toBe(410);

    const second = await createRequest(h, { expiresInHours: 1 });
    h.clock.advance(3600 * 1000 + 1);
    expect((await h.call('GET', `/api/public/requests/${second.id}`)).statusCode).toBe(410);
  });
});

describe('deleting a user', () => {
  it('closes their links and file requests and deletes their files', async () => {
    const h = createHarness();
    const sent = await h.call('POST', '/api/transfers', {
      as: 'user',
      body: { files: [{ name: 'a.pdf', size: 10 }], expiresInHours: 24, maxOpens: null },
    });
    await finishUpload(h, sent.json);
    const request = await createRequest(h, { maxSubmissions: null });
    await finishUpload(h, (await submit(h, request.id)).json);
    const inProgress = (await submit(h, request.id)).json as SubmissionResult;
    const theirs = await h.call('POST', '/api/transfers', { as: 'admin', body: { files: [{ name: 'b.pdf', size: 10 }], expiresInHours: 24, maxOpens: null } });
    await finishUpload(h, theirs.json);
    expect(h.blobs.objects.size).toBe(3);

    expect((await h.call('DELETE', '/api/admin/users/user-example-com', { as: 'admin' })).statusCode).toBe(204);

    expect((await h.call('GET', `/api/public/transfers/${sent.json.transfer.id}`)).statusCode).toBe(410);
    expect((await h.call('GET', `/api/public/requests/${request.id}`)).statusCode).toBe(410);
    const finalize = await h.call('POST', `/api/public/uploads/${inProgress.upload.transferId}/finalize`, {
      body: { uploadToken: inProgress.upload.uploadToken },
    });
    expect(finalize.json.error.code).toBe('upload_closed');
    // Only the other user's file is left, and no unfinished multipart upload.
    expect([...h.blobs.objects.keys()]).toEqual([expect.stringContaining(theirs.json.transfer.id)]);
    expect(h.blobs.uploads.size).toBe(0);
    expect((await h.call('GET', `/api/public/transfers/${theirs.json.transfer.id}`)).statusCode).toBe(200);

    const [deleted] = await h.store.listEvents('ADMIN', 1);
    expect(deleted).toMatchObject({ action: 'user.deleted', details: { transfersClosed: 3, requestsClosed: 1 } });
  });
});
