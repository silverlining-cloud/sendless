import { ConditionalCheckFailedException, DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
  BatchGetCommand,
  DynamoDBDocumentClient,
  GetCommand,
  PutCommand,
  QueryCommand,
  UpdateCommand,
  type QueryCommandInput,
} from '@aws-sdk/lib-dynamodb';
import type { ScanStatus, TransferKind } from '@sendless/shared';
import { badRequest } from '../http.js';
import type { EventRecord, RequestRecord, SessionRecord, StoredFile, SystemConfig, TransferRecord } from '../model.js';
import type { DueItem, LockableKind, OpenResult, Page, Store } from '../ports.js';
import type { Settings } from '../settings.js';

/*
 * Single-table layout
 *   TRANSFER#id / META            transfer        GSI1: OWNER#sub / OUT|IN#createdAt#id   GSI3: DUE / deleteAfter#T#id
 *   TRANSFER#id / EVT#at#eid       event           GSI2: AUDIT#yyyy-mm-dd / at#eid
 *   REQUEST#id  / META             file request    GSI1: OWNER#sub / REQ#createdAt#id      GSI3: DUE / expiresAt#R#id
 *   REQUEST#id  / SUB#at#tid       submission pointer
 *   REQUEST#id  / EVT#at#eid       event
 *   ADMIN       / EVT#at#eid       admin event
 *   SESSION#id  / META             recipient session (TTL)
 *   SETTINGS    / GLOBAL           admin settings
 *   SYSTEM      / CONFIG           deploy-time configuration
 * GSI3 entries exist only while a transfer/request is active, so the sweeper's query stays small.
 */

const pad = (n: number) => String(Math.max(0, Math.floor(n))).padStart(15, '0');
const transferKey = (id: string) => ({ PK: `TRANSFER#${id}`, SK: 'META' });
const requestKey = (id: string) => ({ PK: `REQUEST#${id}`, SK: 'META' });

type Item = Record<string, unknown>;

function isConditionFailure(error: unknown): boolean {
  return error instanceof ConditionalCheckFailedException || (error as { name?: string })?.name === 'ConditionalCheckFailedException';
}

function encodeCursor(key: Record<string, unknown> | undefined): string | null {
  return key ? Buffer.from(JSON.stringify(key)).toString('base64url') : null;
}

function decodeCursor(cursor: string | null | undefined): Record<string, unknown> | undefined {
  if (!cursor) return undefined;
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw badRequest('Invalid cursor');
  }
}

/** Nulls are dropped for attributes that conditions test with attribute_exists/if_not_exists. */
function fileToItem(file: StoredFile): Item {
  const { uploadId, scan, ...rest } = file;
  return { ...rest, ...(uploadId ? { uploadId } : {}), ...(scan ? { scan } : {}) };
}

function fileFromItem(item: Item): StoredFile {
  return {
    id: item.id as string,
    name: item.name as string,
    size: item.size as number,
    contentType: item.contentType as string,
    key: item.key as string,
    uploadId: (item.uploadId as string | undefined) ?? null,
    partSize: item.partSize as number,
    partCount: item.partCount as number,
    status: item.status as StoredFile['status'],
    scan: (item.scan as ScanStatus | undefined) ?? null,
  };
}

function transferToItem(t: TransferRecord): Item {
  const { maxOpens, files, ...rest } = t;
  return {
    ...transferKey(t.id),
    type: 'transfer',
    ...rest,
    ...(maxOpens !== null ? { maxOpens } : {}),
    files: Object.fromEntries(Object.entries(files).map(([id, f]) => [id, fileToItem(f)])),
    GSI1PK: `OWNER#${t.ownerSub}`,
    GSI1SK: `${t.kind === 'outbound' ? 'OUT' : 'IN'}#${pad(t.createdAt)}#${t.id}`,
    ...(t.status === 'uploading' || t.status === 'ready' ? { GSI3PK: 'DUE', GSI3SK: `${pad(t.deleteAfter)}#T#${t.id}` } : {}),
  };
}

function transferFromItem(item: Item): TransferRecord {
  const files = (item.files ?? {}) as Record<string, Item>;
  return {
    id: item.id as string,
    kind: item.kind as TransferKind,
    ownerSub: item.ownerSub as string,
    ownerEmail: item.ownerEmail as string,
    title: (item.title as string | null) ?? null,
    message: (item.message as string | null) ?? null,
    recipients: (item.recipients as string[] | undefined) ?? [],
    createdAt: item.createdAt as number,
    lifetimeHours: item.lifetimeHours as number,
    expiresAt: item.expiresAt as number,
    deleteAfter: item.deleteAfter as number,
    maxOpens: (item.maxOpens as number | undefined) ?? null,
    opens: (item.opens as number | undefined) ?? 0,
    passwordHash: (item.passwordHash as string | null) ?? null,
    failedUnlocks: (item.failedUnlocks as number | undefined) ?? 0,
    lockedUntil: (item.lockedUntil as number | undefined) ?? 0,
    status: item.status as TransferRecord['status'],
    uploadToken: item.uploadToken as string,
    files: Object.fromEntries(Object.entries(files).map(([id, f]) => [id, fileFromItem(f)])),
    fileOrder: (item.fileOrder as string[] | undefined) ?? [],
    totalSize: (item.totalSize as number | undefined) ?? 0,
    notifyOnOpen: Boolean(item.notifyOnOpen),
    requestId: (item.requestId as string | null) ?? null,
    submitter: (item.submitter as TransferRecord['submitter']) ?? null,
    ttl: item.ttl as number,
  };
}

function requestToItem(r: RequestRecord): Item {
  const { maxSubmissions, ...rest } = r;
  return {
    ...requestKey(r.id),
    type: 'request',
    ...rest,
    ...(maxSubmissions !== null ? { maxSubmissions } : {}),
    GSI1PK: `OWNER#${r.ownerSub}`,
    GSI1SK: `REQ#${pad(r.createdAt)}#${r.id}`,
    ...(r.status === 'active' ? { GSI3PK: 'DUE', GSI3SK: `${pad(r.expiresAt)}#R#${r.id}` } : {}),
  };
}

function requestFromItem(item: Item): RequestRecord {
  return {
    id: item.id as string,
    ownerSub: item.ownerSub as string,
    ownerEmail: item.ownerEmail as string,
    title: item.title as string,
    message: (item.message as string | null) ?? null,
    createdAt: item.createdAt as number,
    expiresAt: item.expiresAt as number,
    passwordHash: (item.passwordHash as string | null) ?? null,
    failedUnlocks: (item.failedUnlocks as number | undefined) ?? 0,
    lockedUntil: (item.lockedUntil as number | undefined) ?? 0,
    maxSubmissions: (item.maxSubmissions as number | undefined) ?? null,
    submissions: (item.submissions as number | undefined) ?? 0,
    maxBytesPerSubmission: (item.maxBytesPerSubmission as number | null) ?? null,
    retentionHours: item.retentionHours as number,
    notifyOnSubmission: Boolean(item.notifyOnSubmission),
    status: item.status as RequestRecord['status'],
    ttl: item.ttl as number,
  };
}

function eventFromItem(item: Item): EventRecord {
  return {
    id: item.id as string,
    subject: item.subject as string,
    at: item.at as number,
    action: item.action as string,
    actor: item.actor as EventRecord['actor'],
    ip: (item.ip as string | null) ?? null,
    country: (item.country as string | null) ?? null,
    userAgent: (item.userAgent as string | null) ?? null,
    details: (item.details as EventRecord['details']) ?? null,
  };
}

export class DynamoStore implements Store {
  private readonly db: DynamoDBDocumentClient;

  constructor(
    private readonly table: string,
    client: DynamoDBClient = new DynamoDBClient({}),
  ) {
    this.db = DynamoDBDocumentClient.from(client, { marshallOptions: { removeUndefinedValues: true } });
  }

  private async get(key: Item): Promise<Item | null> {
    const result = await this.db.send(new GetCommand({ TableName: this.table, Key: key, ConsistentRead: true }));
    return (result.Item as Item | undefined) ?? null;
  }

  private async query(input: Omit<QueryCommandInput, 'TableName'>): Promise<{ items: Item[]; last?: Record<string, unknown> }> {
    const result = await this.db.send(new QueryCommand({ TableName: this.table, ...input }));
    return { items: (result.Items as Item[] | undefined) ?? [], ...(result.LastEvaluatedKey ? { last: result.LastEvaluatedKey } : {}) };
  }

  /** Runs a conditional update; returns the requested values, or null if the condition failed. */
  private async update(input: Omit<ConstructorParameters<typeof UpdateCommand>[0], 'TableName'>): Promise<Item | null> {
    try {
      const result = await this.db.send(new UpdateCommand({ TableName: this.table, ...input }));
      return (result.Attributes as Item | undefined) ?? {};
    } catch (error) {
      if (isConditionFailure(error)) return null;
      throw error;
    }
  }

  // ---------- transfers ----------

  async createTransfer(transfer: TransferRecord) {
    await this.db.send(
      new PutCommand({ TableName: this.table, Item: transferToItem(transfer), ConditionExpression: 'attribute_not_exists(PK)' }),
    );
  }

  async getTransfer(id: string) {
    const item = await this.get(transferKey(id));
    return item ? transferFromItem(item) : null;
  }

  async getTransfers(ids: string[]) {
    const out: TransferRecord[] = [];
    for (let i = 0; i < ids.length; i += 100) {
      let keys: Item[] = ids.slice(i, i + 100).map(transferKey);
      for (let attempt = 0; keys.length > 0 && attempt < 5; attempt++) {
        const result = await this.db.send(new BatchGetCommand({ RequestItems: { [this.table]: { Keys: keys } } }));
        out.push(...((result.Responses?.[this.table] as Item[] | undefined) ?? []).map(transferFromItem));
        keys = (result.UnprocessedKeys?.[this.table]?.Keys as Item[] | undefined) ?? [];
        if (keys.length) await new Promise((r) => setTimeout(r, 50 * 2 ** attempt));
      }
    }
    return out;
  }

  async listTransfers(ownerSub: string, kind: TransferKind, opts: { limit: number; cursor?: string | null }): Promise<Page<TransferRecord>> {
    const start = decodeCursor(opts.cursor);
    const { items, last } = await this.query({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `OWNER#${ownerSub}`, ':prefix': kind === 'outbound' ? 'OUT#' : 'IN#' },
      ScanIndexForward: false,
      Limit: opts.limit,
      ...(start ? { ExclusiveStartKey: start } : {}),
    });
    return { items: items.map(transferFromItem), cursor: encodeCursor(last) };
  }

  /** DynamoDB rejects unused names, so each update declares exactly the ones it references. */
  private fileNames(fileId: string, ...attributes: ('status' | 'uploadId' | 'scan')[]) {
    return { '#files': 'files', '#fid': fileId, ...Object.fromEntries(attributes.map((a) => [`#${a}`, a])) };
  }

  async markFileUploaded(transferId: string, fileId: string, scanPending: boolean) {
    await this.update({
      Key: transferKey(transferId),
      UpdateExpression: `SET #files.#fid.#status = :uploaded${scanPending ? ', #files.#fid.#scan = if_not_exists(#files.#fid.#scan, :pending)' : ''} REMOVE #files.#fid.#uploadId`,
      ConditionExpression: 'attribute_exists(#files.#fid)',
      ExpressionAttributeNames: this.fileNames(fileId, 'status', 'uploadId', ...(scanPending ? (['scan'] as const) : [])),
      ExpressionAttributeValues: { ':uploaded': 'uploaded', ...(scanPending ? { ':pending': 'pending' } : {}) },
    });
  }

  async markFileFailed(transferId: string, fileId: string) {
    await this.update({
      Key: transferKey(transferId),
      UpdateExpression: 'SET #files.#fid.#status = :failed REMOVE #files.#fid.#uploadId',
      ConditionExpression: 'attribute_exists(#files.#fid)',
      ExpressionAttributeNames: this.fileNames(fileId, 'status', 'uploadId'),
      ExpressionAttributeValues: { ':failed': 'failed' },
    });
  }

  async setFileScan(transferId: string, fileId: string, scan: ScanStatus) {
    await this.update({
      Key: transferKey(transferId),
      UpdateExpression: 'SET #files.#fid.#scan = :scan',
      ConditionExpression: 'attribute_exists(#files.#fid)',
      ExpressionAttributeNames: this.fileNames(fileId, 'scan'),
      ExpressionAttributeValues: { ':scan': scan },
    });
  }

  async markTransferReady(id: string, expiresAt: number) {
    const item = await this.update({
      Key: transferKey(id),
      UpdateExpression: 'SET #status = :ready, expiresAt = :exp, deleteAfter = :exp, GSI3PK = :due, GSI3SK = :gsi3',
      ConditionExpression: '#status = :uploading',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: {
        ':ready': 'ready',
        ':uploading': 'uploading',
        ':exp': expiresAt,
        ':due': 'DUE',
        ':gsi3': `${pad(expiresAt)}#T#${id}`,
      },
      ReturnValues: 'ALL_NEW',
    });
    return item ? transferFromItem(item) : null;
  }

  async openTransfer(id: string, now: number): Promise<OpenResult> {
    const item = await this.update({
      Key: transferKey(id),
      UpdateExpression: 'SET opens = opens + :one',
      ConditionExpression:
        '#status = :ready AND expiresAt > :now AND deleteAfter > :now AND (attribute_not_exists(maxOpens) OR opens < maxOpens)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':one': 1, ':ready': 'ready', ':now': now },
      ReturnValues: 'ALL_NEW',
    });
    if (item) return { ok: true, transfer: transferFromItem(item) };
    const current = await this.getTransfer(id);
    const usable = current && current.status === 'ready' && current.expiresAt > now && current.deleteAfter > now;
    return { ok: false, reason: usable ? 'limit' : 'unavailable' };
  }

  async setTransferDeleteAfter(id: string, deleteAfter: number) {
    await this.update({
      Key: transferKey(id),
      UpdateExpression: 'SET deleteAfter = :d, GSI3SK = :gsi3',
      ConditionExpression: 'attribute_exists(GSI3PK)',
      ExpressionAttributeValues: { ':d': deleteAfter, ':gsi3': `${pad(deleteAfter)}#T#${id}` },
    });
  }

  async endTransfer(id: string, status: 'expired' | 'revoked', ttl: number) {
    const item = await this.update({
      Key: transferKey(id),
      UpdateExpression: 'SET #status = :status, #ttl = :ttl REMOVE GSI3PK, GSI3SK',
      ConditionExpression: '#status IN (:uploading, :ready)',
      ExpressionAttributeNames: { '#status': 'status', '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':status': status, ':ttl': ttl, ':uploading': 'uploading', ':ready': 'ready' },
      ReturnValues: 'ALL_OLD',
    });
    return item ? transferFromItem(item) : null;
  }

  // ---------- lockout ----------

  async recordFailedUnlock(kind: LockableKind, id: string, now: number, maxFailures: number, lockSeconds: number) {
    const key = kind === 'transfer' ? transferKey(id) : requestKey(id);
    const item = await this.update({
      Key: key,
      UpdateExpression: 'ADD failedUnlocks :one',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':one': 1 },
      ReturnValues: 'UPDATED_NEW',
    });
    if (item && Number(item.failedUnlocks) >= maxFailures) {
      await this.update({
        Key: key,
        UpdateExpression: 'SET failedUnlocks = :zero, lockedUntil = :until',
        ExpressionAttributeValues: { ':zero': 0, ':until': now + lockSeconds * 1000 },
      });
    }
  }

  async clearFailedUnlocks(kind: LockableKind, id: string) {
    await this.update({
      Key: kind === 'transfer' ? transferKey(id) : requestKey(id),
      UpdateExpression: 'SET failedUnlocks = :zero',
      ConditionExpression: 'attribute_exists(PK)',
      ExpressionAttributeValues: { ':zero': 0 },
    });
  }

  // ---------- file requests ----------

  async createRequest(request: RequestRecord) {
    await this.db.send(
      new PutCommand({ TableName: this.table, Item: requestToItem(request), ConditionExpression: 'attribute_not_exists(PK)' }),
    );
  }

  async getRequest(id: string) {
    const item = await this.get(requestKey(id));
    return item ? requestFromItem(item) : null;
  }

  async listRequests(ownerSub: string, opts: { limit: number; cursor?: string | null }): Promise<Page<RequestRecord>> {
    const start = decodeCursor(opts.cursor);
    const { items, last } = await this.query({
      IndexName: 'GSI1',
      KeyConditionExpression: 'GSI1PK = :pk AND begins_with(GSI1SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `OWNER#${ownerSub}`, ':prefix': 'REQ#' },
      ScanIndexForward: false,
      Limit: opts.limit,
      ...(start ? { ExclusiveStartKey: start } : {}),
    });
    return { items: items.map(requestFromItem), cursor: encodeCursor(last) };
  }

  async claimSubmission(id: string, now: number) {
    const item = await this.update({
      Key: requestKey(id),
      UpdateExpression: 'ADD submissions :one',
      ConditionExpression:
        '#status = :active AND expiresAt > :now AND (attribute_not_exists(maxSubmissions) OR submissions < maxSubmissions)',
      ExpressionAttributeNames: { '#status': 'status' },
      ExpressionAttributeValues: { ':one': 1, ':active': 'active', ':now': now },
    });
    return item !== null;
  }

  async addSubmission(requestId: string, transferId: string, createdAt: number, ttl: number) {
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: { PK: `REQUEST#${requestId}`, SK: `SUB#${pad(createdAt)}#${transferId}`, type: 'submission', transferId, ttl },
      }),
    );
  }

  async listSubmissionIds(requestId: string, limit: number) {
    const { items } = await this.query({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': `REQUEST#${requestId}`, ':prefix': 'SUB#' },
      ScanIndexForward: false,
      Limit: limit,
    });
    return items.map((i) => i.transferId as string);
  }

  async endRequest(id: string, status: 'expired' | 'revoked', ttl: number) {
    const item = await this.update({
      Key: requestKey(id),
      UpdateExpression: 'SET #status = :status, #ttl = :ttl REMOVE GSI3PK, GSI3SK',
      ConditionExpression: '#status = :active',
      ExpressionAttributeNames: { '#status': 'status', '#ttl': 'ttl' },
      ExpressionAttributeValues: { ':status': status, ':ttl': ttl, ':active': 'active' },
      ReturnValues: 'ALL_OLD',
    });
    return item ? requestFromItem(item) : null;
  }

  // ---------- sessions ----------

  async createSession(session: SessionRecord) {
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: { PK: `SESSION#${session.id}`, SK: 'META', type: 'session', ...session, ttl: Math.ceil(session.expiresAt / 1000) },
      }),
    );
  }

  async getSession(id: string) {
    const item = await this.get({ PK: `SESSION#${id}`, SK: 'META' });
    return item ? { id: item.id as string, transferId: item.transferId as string, expiresAt: item.expiresAt as number } : null;
  }

  // ---------- events ----------

  async putEvent(event: EventRecord, ttl: number) {
    const day = new Date(event.at).toISOString().slice(0, 10);
    await this.db.send(
      new PutCommand({
        TableName: this.table,
        Item: {
          PK: event.subject,
          SK: `EVT#${pad(event.at)}#${event.id}`,
          type: 'event',
          ...event,
          GSI2PK: `AUDIT#${day}`,
          GSI2SK: `${pad(event.at)}#${event.id}`,
          ttl,
        },
      }),
    );
  }

  async listEvents(subject: string, limit: number) {
    const { items } = await this.query({
      KeyConditionExpression: 'PK = :pk AND begins_with(SK, :prefix)',
      ExpressionAttributeValues: { ':pk': subject, ':prefix': 'EVT#' },
      ScanIndexForward: false,
      Limit: limit,
    });
    return items.map(eventFromItem);
  }

  async listEventsByDay(day: string, opts: { limit: number; cursor?: string | null }): Promise<Page<EventRecord>> {
    const start = decodeCursor(opts.cursor);
    const { items, last } = await this.query({
      IndexName: 'GSI2',
      KeyConditionExpression: 'GSI2PK = :pk',
      ExpressionAttributeValues: { ':pk': `AUDIT#${day}` },
      ScanIndexForward: false,
      Limit: opts.limit,
      ...(start ? { ExclusiveStartKey: start } : {}),
    });
    return { items: items.map(eventFromItem), cursor: encodeCursor(last) };
  }

  // ---------- settings / system ----------

  async getSettings() {
    const item = await this.get({ PK: 'SETTINGS', SK: 'GLOBAL' });
    return (item?.settings as Partial<Settings> | undefined) ?? null;
  }

  async putSettings(settings: Settings) {
    await this.db.send(new PutCommand({ TableName: this.table, Item: { PK: 'SETTINGS', SK: 'GLOBAL', type: 'settings', settings } }));
  }

  async getSystemConfig() {
    const item = await this.get({ PK: 'SYSTEM', SK: 'CONFIG' });
    return (item?.config as SystemConfig | undefined) ?? null;
  }

  async putSystemConfig(config: SystemConfig) {
    await this.db.send(new PutCommand({ TableName: this.table, Item: { PK: 'SYSTEM', SK: 'CONFIG', type: 'system', config } }));
  }

  // ---------- sweeper ----------

  async listDue(now: number, limit: number): Promise<DueItem[]> {
    const { items } = await this.query({
      IndexName: 'GSI3',
      KeyConditionExpression: 'GSI3PK = :due AND GSI3SK < :bound',
      ExpressionAttributeValues: { ':due': 'DUE', ':bound': pad(now + 1) },
      Limit: limit,
    });
    return items.map((item) => {
      const [kind, id] = String(item.PK).split('#') as [string, string];
      return { kind: kind === 'TRANSFER' ? 'transfer' : 'request', id };
    });
  }
}
