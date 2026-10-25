/**
 * The same behaviour contract for every Store implementation. MemoryStore always runs; DynamoStore
 * runs when DYNAMODB_ENDPOINT points at DynamoDB Local, e.g.
 *   docker run -p 8000:8000 amazon/dynamodb-local
 *   DYNAMODB_ENDPOINT=http://localhost:8000 npm test
 */
import { CreateTableCommand, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { beforeEach, describe, expect, it } from 'vitest';
import type { RequestRecord, StoredFile, TransferRecord } from '../model.js';
import type { Store } from '../ports.js';
import { mergeSettings } from '../settings.js';
import { DynamoStore } from './dynamo-store.js';
import { MemoryStore } from './memory-store.js';

const endpoint = process.env.DYNAMODB_ENDPOINT;

async function dynamoStore(): Promise<Store> {
  const client = new DynamoDBClient({
    endpoint,
    region: 'eu-central-1',
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  });
  const table = `contract-${Math.random().toString(36).slice(2)}`;
  const index = (name: string, projection: 'ALL' | 'KEYS_ONLY') => ({
    IndexName: name,
    KeySchema: [
      { AttributeName: `${name}PK`, KeyType: 'HASH' as const },
      { AttributeName: `${name}SK`, KeyType: 'RANGE' as const },
    ],
    Projection: { ProjectionType: projection },
  });
  await client.send(
    new CreateTableCommand({
      TableName: table,
      BillingMode: 'PAY_PER_REQUEST',
      AttributeDefinitions: ['PK', 'SK', 'GSI1PK', 'GSI1SK', 'GSI2PK', 'GSI2SK', 'GSI3PK', 'GSI3SK'].map((n) => ({
        AttributeName: n,
        AttributeType: 'S' as const,
      })),
      KeySchema: [
        { AttributeName: 'PK', KeyType: 'HASH' },
        { AttributeName: 'SK', KeyType: 'RANGE' },
      ],
      GlobalSecondaryIndexes: [index('GSI1', 'ALL'), index('GSI2', 'ALL'), index('GSI3', 'KEYS_ONLY')],
    }),
  );
  return new DynamoStore(table, client);
}

const factories: [string, () => Promise<Store>][] = [['MemoryStore', async () => new MemoryStore()]];
if (endpoint) factories.push(['DynamoStore', dynamoStore]);

const T0 = Date.parse('2026-06-01T00:00:00Z');
const HOUR = 3600_000;

function file(id: string): StoredFile {
  return { id, name: `${id} "x".pdf`, size: 100, contentType: 'application/pdf', key: `files/t/${id}`, uploadId: `up-${id}`, partSize: 8, partCount: 1, status: 'pending', scan: null };
}

function transfer(id: string, overrides: Partial<TransferRecord> = {}): TransferRecord {
  return {
    id,
    kind: 'outbound',
    ownerSub: 'owner-1',
    ownerEmail: 'owner@example.com',
    title: null,
    message: 'hello',
    recipients: [],
    createdAt: T0,
    lifetimeHours: 24,
    expiresAt: T0 + 48 * HOUR,
    deleteAfter: T0 + 24 * HOUR,
    maxOpens: null,
    opens: 0,
    passwordHash: null,
    failedUnlocks: 0,
    lockedUntil: 0,
    status: 'uploading',
    uploadToken: 'token',
    files: { a: file('a'), b: file('b') },
    fileOrder: ['a', 'b'],
    totalSize: 200,
    notifyOnOpen: false,
    requestId: null,
    submitter: null,
    ttl: 9_999_999_999,
    ...overrides,
  };
}

function request(id: string, overrides: Partial<RequestRecord> = {}): RequestRecord {
  return {
    id,
    ownerSub: 'owner-1',
    ownerEmail: 'owner@example.com',
    title: 'Docs',
    message: null,
    createdAt: T0,
    expiresAt: T0 + 24 * HOUR,
    passwordHash: null,
    failedUnlocks: 0,
    lockedUntil: 0,
    maxSubmissions: 2,
    submissions: 0,
    maxBytesPerSubmission: null,
    retentionHours: 24,
    notifyOnSubmission: true,
    status: 'active',
    ttl: 9_999_999_999,
    ...overrides,
  };
}

describe.each(factories)('%s contract', (_name, make) => {
  let store: Store;
  beforeEach(async () => {
    store = await make();
  });

  it('round-trips transfers, including nulls and nested files', async () => {
    const t = transfer('t1', { submitter: { name: 'Erika', email: null, message: null } });
    await store.createTransfer(t);
    expect(await store.getTransfer('t1')).toEqual(t);
    expect(await store.getTransfer('missing')).toBeNull();
    await expect(store.createTransfer(t)).rejects.toThrow();
    expect((await store.getTransfers(['t1', 'missing'])).map((x) => x.id)).toEqual(['t1']);
  });

  it('tracks file state without overwriting an earlier scan result', async () => {
    await store.createTransfer(transfer('t1'));
    await store.setFileScan('t1', 'b', 'clean'); // scan result arrives before "uploaded"
    await store.markFileUploaded('t1', 'a', true);
    await store.markFileUploaded('t1', 'b', true);
    await store.markFileFailed('t1', 'a');
    const t = (await store.getTransfer('t1'))!;
    expect(t.files.a).toMatchObject({ status: 'failed', uploadId: null, scan: 'pending' });
    expect(t.files.b).toMatchObject({ status: 'uploaded', uploadId: null, scan: 'clean' });
  });

  it('moves uploading → ready once, and counts opens atomically up to the limit', async () => {
    await store.createTransfer(transfer('t1', { maxOpens: 2 }));
    expect(await store.openTransfer('t1', T0)).toEqual({ ok: false, reason: 'unavailable' });
    const ready = await store.markTransferReady('t1', T0 + 10 * HOUR);
    expect(ready).toMatchObject({ status: 'ready', expiresAt: T0 + 10 * HOUR, deleteAfter: T0 + 10 * HOUR });
    expect(await store.markTransferReady('t1', T0)).toBeNull();

    const results = await Promise.all([1, 2, 3].map(() => store.openTransfer('t1', T0)));
    expect(results.filter((r) => r.ok)).toHaveLength(2);
    expect(results.find((r) => !r.ok)).toEqual({ ok: false, reason: 'limit' });
    expect((await store.getTransfer('t1'))!.opens).toBe(2);
    expect(await store.openTransfer('t1', T0 + 11 * HOUR)).toEqual({ ok: false, reason: 'unavailable' });
  });

  it('allows unlimited opens when maxOpens is null', async () => {
    await store.createTransfer(transfer('t1'));
    await store.markTransferReady('t1', T0 + HOUR);
    for (let i = 0; i < 5; i++) expect((await store.openTransfer('t1', T0)).ok).toBe(true);
  });

  it('lists due items and removes ended ones from the due index', async () => {
    await store.createTransfer(transfer('t1'));
    await store.createTransfer(transfer('t2', { deleteAfter: T0 + 100 * HOUR }));
    await store.createRequest(request('r1'));
    expect(await store.listDue(T0 + 23 * HOUR, 10)).toEqual([]);
    const due = await store.listDue(T0 + 24 * HOUR, 10);
    expect(due).toEqual(expect.arrayContaining([{ kind: 'transfer', id: 't1' }, { kind: 'request', id: 'r1' }]));
    expect(due).toHaveLength(2);

    await store.setTransferDeleteAfter('t2', T0 + HOUR);
    expect((await store.listDue(T0 + 2 * HOUR, 10)).map((d) => d.id)).toEqual(['t2']);

    const ended = await store.endTransfer('t1', 'expired', 123);
    expect(ended?.status).toBe('uploading'); // the record before the change
    expect(await store.endTransfer('t1', 'expired', 123)).toBeNull();
    expect((await store.getTransfer('t1'))!.status).toBe('expired');
    expect((await store.listDue(T0 + 200 * HOUR, 10)).map((d) => d.id).sort()).toEqual(['r1', 't2']);
  });

  it('locks after repeated failed unlocks and can be cleared', async () => {
    await store.createTransfer(transfer('t1'));
    for (let i = 0; i < 3; i++) await store.recordFailedUnlock('transfer', 't1', T0, 3, 60);
    expect((await store.getTransfer('t1'))!).toMatchObject({ failedUnlocks: 0, lockedUntil: T0 + 60_000 });
    await store.recordFailedUnlock('transfer', 't1', T0, 3, 60);
    await store.clearFailedUnlocks('transfer', 't1');
    expect((await store.getTransfer('t1'))!.failedUnlocks).toBe(0);
    await store.createRequest(request('r1'));
    await store.recordFailedUnlock('request', 'r1', T0, 1, 60);
    expect((await store.getRequest('r1'))!.lockedUntil).toBe(T0 + 60_000);
  });

  it('pages through an owner’s transfers newest first, per kind', async () => {
    for (let i = 0; i < 5; i++) await store.createTransfer(transfer(`o${i}`, { createdAt: T0 + i }));
    await store.createTransfer(transfer('in1', { kind: 'inbound' }));
    await store.createTransfer(transfer('x', { ownerSub: 'someone-else' }));
    const first = await store.listTransfers('owner-1', 'outbound', { limit: 3 });
    expect(first.items.map((t) => t.id)).toEqual(['o4', 'o3', 'o2']);
    const second = await store.listTransfers('owner-1', 'outbound', { limit: 3, cursor: first.cursor });
    expect(second.items.map((t) => t.id)).toEqual(['o1', 'o0']);
    expect((await store.listTransfers('owner-1', 'inbound', { limit: 10 })).items.map((t) => t.id)).toEqual(['in1']);
  });

  it('handles file requests and submissions', async () => {
    await store.createRequest(request('r1'));
    await store.createRequest(request('r2', { createdAt: T0 + 1, maxSubmissions: null }));
    expect((await store.listRequests('owner-1', { limit: 10 })).items.map((r) => r.id)).toEqual(['r2', 'r1']);

    expect(await store.claimSubmission('r1', T0)).toBe(true);
    expect(await store.claimSubmission('r1', T0)).toBe(true);
    expect(await store.claimSubmission('r1', T0)).toBe(false);
    expect(await store.claimSubmission('r2', T0 + 25 * HOUR)).toBe(false); // expired

    await store.addSubmission('r1', 'sub-1', T0 + 1, 999);
    await store.addSubmission('r1', 'sub-2', T0 + 2, 999);
    expect(await store.listSubmissionIds('r1', 10)).toEqual(['sub-2', 'sub-1']);

    expect((await store.endRequest('r1', 'revoked', 1))?.status).toBe('active');
    expect(await store.endRequest('r1', 'revoked', 1)).toBeNull();
    expect(await store.claimSubmission('r1', T0)).toBe(false);
  });

  it('stores sessions, events, settings and system config', async () => {
    await store.createSession({ id: 's1', transferId: 't1', expiresAt: T0 + HOUR });
    expect(await store.getSession('s1')).toEqual({ id: 's1', transferId: 't1', expiresAt: T0 + HOUR });
    expect(await store.getSession('nope')).toBeNull();

    const event = (id: string, at: number, subject = 'TRANSFER#t1') => ({
      id,
      subject,
      at,
      action: 'transfer.opened',
      actor: { type: 'recipient' as const },
      ip: '203.0.113.1',
      country: 'DE',
      userAgent: null,
      details: { opens: 1 },
    });
    await store.putEvent(event('e1', T0 + 1), 999);
    await store.putEvent(event('e2', T0 + 2), 999);
    await store.putEvent(event('e3', T0 + 3, 'ADMIN'), 999);
    expect((await store.listEvents('TRANSFER#t1', 10)).map((e) => e.id)).toEqual(['e2', 'e1']);
    const day = await store.listEventsByDay('2026-06-01', { limit: 2 });
    expect(day.items.map((e) => e.id)).toEqual(['e3', 'e2']);
    const rest = await store.listEventsByDay('2026-06-01', { limit: 2, cursor: day.cursor });
    expect(rest.items.map((e) => e.id)).toEqual(['e1']);
    expect(rest.items[0]).toEqual(event('e1', T0 + 1));

    expect(await store.getSettings()).toBeNull();
    const settings = mergeSettings({ licenseKey: 'x' });
    await store.putSettings(settings);
    expect(await store.getSettings()).toEqual(settings);

    const system = { appUrl: 'https://x', userPoolId: 'p', clientId: 'c', cognitoDomain: 'd', selfSignUp: false };
    await store.putSystemConfig(system);
    expect(await store.getSystemConfig()).toEqual(system);
  });
});
