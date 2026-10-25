import type { ScanStatus, TransferKind } from '@s3ndless/shared';
import { badRequest } from '../http.js';
import type { EventRecord, RequestRecord, SessionRecord, SystemConfig, TransferRecord } from '../model.js';
import type { DueItem, LockableKind, OpenResult, Page, Store } from '../ports.js';
import type { Settings } from '../settings.js';

const clone = <T>(value: T): T => structuredClone(value);

/** In-memory Store with the same semantics as DynamoStore. For tests and the local dev server. */
export class MemoryStore implements Store {
  private transfers = new Map<string, TransferRecord>();
  private requests = new Map<string, RequestRecord>();
  private sessions = new Map<string, SessionRecord>();
  private events: EventRecord[] = [];
  private submissions = new Map<string, { transferId: string; createdAt: number }[]>();
  private settings: Settings | null = null;
  private system: SystemConfig | null = null;

  constructor(system?: SystemConfig) {
    this.system = system ?? null;
  }

  /** Dev server: survive restarts by saving and loading a JSON snapshot. */
  snapshot(): string {
    return JSON.stringify({
      transfers: [...this.transfers.values()],
      requests: [...this.requests.values()],
      sessions: [...this.sessions.values()],
      events: this.events,
      submissions: [...this.submissions.entries()],
      settings: this.settings,
    });
  }

  restore(json: string): void {
    const data = JSON.parse(json);
    this.transfers = new Map(data.transfers.map((t: TransferRecord) => [t.id, t]));
    this.requests = new Map(data.requests.map((r: RequestRecord) => [r.id, r]));
    this.sessions = new Map(data.sessions.map((s: SessionRecord) => [s.id, s]));
    this.events = data.events;
    this.submissions = new Map(data.submissions);
    this.settings = data.settings;
  }

  async createTransfer(transfer: TransferRecord) {
    if (this.transfers.has(transfer.id)) throw new Error('duplicate transfer id');
    this.transfers.set(transfer.id, clone(transfer));
  }

  async getTransfer(id: string) {
    const t = this.transfers.get(id);
    return t ? clone(t) : null;
  }

  async getTransfers(ids: string[]) {
    return ids.map((id) => this.transfers.get(id)).filter((t): t is TransferRecord => Boolean(t)).map(clone);
  }

  async listTransfers(ownerSub: string, kind: TransferKind, opts: { limit: number; cursor?: string | null }) {
    const all = [...this.transfers.values()]
      .filter((t) => t.ownerSub === ownerSub && t.kind === kind)
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    return paginate(all, opts).map(clone);
  }

  private file(transferId: string, fileId: string) {
    const file = this.transfers.get(transferId)?.files[fileId];
    if (!file) throw new Error('file not found');
    return file;
  }

  async markFileUploaded(transferId: string, fileId: string, scanPending: boolean) {
    const file = this.file(transferId, fileId);
    file.status = 'uploaded';
    file.uploadId = null;
    if (scanPending && file.scan === null) file.scan = 'pending';
  }

  async markFileFailed(transferId: string, fileId: string) {
    const file = this.file(transferId, fileId);
    file.status = 'failed';
    file.uploadId = null;
  }

  async setFileScan(transferId: string, fileId: string, scan: ScanStatus) {
    this.file(transferId, fileId).scan = scan;
  }

  async markTransferReady(id: string, expiresAt: number) {
    const t = this.transfers.get(id);
    if (!t || t.status !== 'uploading') return null;
    t.status = 'ready';
    t.expiresAt = expiresAt;
    t.deleteAfter = expiresAt;
    return clone(t);
  }

  async openTransfer(id: string, now: number): Promise<OpenResult> {
    const t = this.transfers.get(id);
    if (!t || t.status !== 'ready' || t.expiresAt <= now || t.deleteAfter <= now) return { ok: false, reason: 'unavailable' };
    if (t.maxOpens !== null && t.opens >= t.maxOpens) return { ok: false, reason: 'limit' };
    t.opens += 1;
    return { ok: true, transfer: clone(t) };
  }

  async setTransferDeleteAfter(id: string, deleteAfter: number) {
    const t = this.transfers.get(id);
    if (t && (t.status === 'ready' || t.status === 'uploading')) t.deleteAfter = deleteAfter;
  }

  async endTransfer(id: string, status: 'expired' | 'revoked', ttl: number) {
    const t = this.transfers.get(id);
    if (!t || (t.status !== 'uploading' && t.status !== 'ready')) return null;
    const before = clone(t);
    t.status = status;
    t.ttl = ttl;
    return before;
  }

  private lockable(kind: LockableKind, id: string) {
    return kind === 'transfer' ? this.transfers.get(id) : this.requests.get(id);
  }

  async recordFailedUnlock(kind: LockableKind, id: string, now: number, maxFailures: number, lockSeconds: number) {
    const record = this.lockable(kind, id);
    if (!record) return;
    record.failedUnlocks += 1;
    if (record.failedUnlocks >= maxFailures) {
      record.failedUnlocks = 0;
      record.lockedUntil = now + lockSeconds * 1000;
    }
  }

  async clearFailedUnlocks(kind: LockableKind, id: string) {
    const record = this.lockable(kind, id);
    if (record) record.failedUnlocks = 0;
  }

  async createRequest(request: RequestRecord) {
    if (this.requests.has(request.id)) throw new Error('duplicate request id');
    this.requests.set(request.id, clone(request));
  }

  async getRequest(id: string) {
    const r = this.requests.get(id);
    return r ? clone(r) : null;
  }

  async listRequests(ownerSub: string, opts: { limit: number; cursor?: string | null }) {
    const all = [...this.requests.values()]
      .filter((r) => r.ownerSub === ownerSub)
      .sort((a, b) => b.createdAt - a.createdAt || b.id.localeCompare(a.id));
    return paginate(all, opts).map(clone);
  }

  async claimSubmission(id: string, now: number) {
    const r = this.requests.get(id);
    if (!r || r.status !== 'active' || r.expiresAt <= now) return false;
    if (r.maxSubmissions !== null && r.submissions >= r.maxSubmissions) return false;
    r.submissions += 1;
    return true;
  }

  async addSubmission(requestId: string, transferId: string, createdAt: number) {
    const list = this.submissions.get(requestId) ?? [];
    list.push({ transferId, createdAt });
    this.submissions.set(requestId, list);
  }

  async listSubmissionIds(requestId: string, limit: number) {
    return (this.submissions.get(requestId) ?? [])
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, limit)
      .map((s) => s.transferId);
  }

  async endRequest(id: string, status: 'expired' | 'revoked', ttl: number) {
    const r = this.requests.get(id);
    if (!r || r.status !== 'active') return null;
    const before = clone(r);
    r.status = status;
    r.ttl = ttl;
    return before;
  }

  async createSession(session: SessionRecord) {
    this.sessions.set(session.id, clone(session));
  }

  async getSession(id: string) {
    const s = this.sessions.get(id);
    return s ? clone(s) : null;
  }

  async putEvent(event: EventRecord) {
    this.events.push(clone(event));
  }

  /** Newest first; events in the same millisecond keep reverse insertion order. */
  private newestFirst(filter: (e: EventRecord) => boolean): EventRecord[] {
    return this.events
      .map((e, index) => ({ e, index }))
      .filter(({ e }) => filter(e))
      .sort((a, b) => b.e.at - a.e.at || b.index - a.index)
      .map(({ e }) => e);
  }

  async listEvents(subject: string, limit: number) {
    return this.newestFirst((e) => e.subject === subject)
      .slice(0, limit)
      .map(clone);
  }

  async listEventsByDay(day: string, opts: { limit: number; cursor?: string | null }) {
    const all = this.newestFirst((e) => new Date(e.at).toISOString().slice(0, 10) === day);
    return paginate(all, opts).map(clone);
  }

  async getSettings() {
    return this.settings ? clone(this.settings) : null;
  }

  async putSettings(settings: Settings) {
    this.settings = clone(settings);
  }

  async getSystemConfig() {
    return this.system ? clone(this.system) : null;
  }

  async putSystemConfig(config: SystemConfig) {
    this.system = clone(config);
  }

  async listDue(now: number, limit: number): Promise<DueItem[]> {
    const due: { item: DueItem; at: number }[] = [];
    for (const t of this.transfers.values()) {
      if ((t.status === 'uploading' || t.status === 'ready') && t.deleteAfter <= now) due.push({ item: { kind: 'transfer', id: t.id }, at: t.deleteAfter });
    }
    for (const r of this.requests.values()) {
      if (r.status === 'active' && r.expiresAt <= now) due.push({ item: { kind: 'request', id: r.id }, at: r.expiresAt });
    }
    return due.sort((a, b) => a.at - b.at).slice(0, limit).map((d) => d.item);
  }
}

/** Offset-based cursor; good enough for in-memory data. */
function paginate<T>(items: T[], opts: { limit: number; cursor?: string | null }): Page<T> & { map<U>(fn: (t: T) => U): Page<U> } {
  let offset = 0;
  if (opts.cursor) {
    offset = Number(Buffer.from(opts.cursor, 'base64url').toString());
    if (!Number.isInteger(offset) || offset < 0) throw badRequest('Invalid cursor');
  }
  const slice = items.slice(offset, offset + opts.limit);
  const next = offset + opts.limit < items.length ? Buffer.from(String(offset + opts.limit)).toString('base64url') : null;
  return {
    items: slice,
    cursor: next,
    map: (fn) => ({ items: slice.map(fn), cursor: next }),
  };
}
