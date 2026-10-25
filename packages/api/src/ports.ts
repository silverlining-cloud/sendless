import type { ProFeature, ScanStatus, SsoProviderInfo, SsoProviderInput, TransferKind, UserInfo } from '@sendless/shared';
import type { HttpRequest } from './http.js';
import type { Logger } from './log.js';
import type { EventRecord, RequestRecord, SessionRecord, SystemConfig, TransferRecord } from './model.js';
import type { Settings } from './settings.js';

export interface Page<T> {
  items: T[];
  cursor: string | null;
}

export type OpenResult = { ok: true; transfer: TransferRecord } | { ok: false; reason: 'limit' | 'unavailable' };
export type DueItem = { kind: 'transfer' | 'request'; id: string };
export type LockableKind = 'transfer' | 'request';

/** Persistence. Implemented by DynamoStore (AWS) and MemoryStore (dev/tests). */
export interface Store {
  createTransfer(transfer: TransferRecord): Promise<void>;
  getTransfer(id: string): Promise<TransferRecord | null>;
  getTransfers(ids: string[]): Promise<TransferRecord[]>;
  listTransfers(ownerSub: string, kind: TransferKind, opts: { limit: number; cursor?: string | null }): Promise<Page<TransferRecord>>;
  /** Marks a file uploaded. With `scanPending`, sets scan=pending unless a scan result already arrived. */
  markFileUploaded(transferId: string, fileId: string, scanPending: boolean): Promise<void>;
  markFileFailed(transferId: string, fileId: string): Promise<void>;
  setFileScan(transferId: string, fileId: string, scan: ScanStatus): Promise<void>;
  /** Moves an `uploading` transfer to `ready` with its final expiry. Returns null if it was not uploading. */
  markTransferReady(id: string, expiresAt: number): Promise<TransferRecord | null>;
  /** Atomically counts one open if the transfer is ready, unexpired and below its open limit. */
  openTransfer(id: string, now: number): Promise<OpenResult>;
  /** Brings forward when an active transfer's files are deleted (used when the open limit is reached). */
  setTransferDeleteAfter(id: string, deleteAfter: number): Promise<void>;
  /** Ends a transfer and removes it from the due index. Returns the record before the change. */
  endTransfer(id: string, status: 'expired' | 'revoked', ttl: number): Promise<TransferRecord | null>;

  recordFailedUnlock(kind: LockableKind, id: string, now: number, maxFailures: number, lockSeconds: number): Promise<void>;
  clearFailedUnlocks(kind: LockableKind, id: string): Promise<void>;

  createRequest(request: RequestRecord): Promise<void>;
  getRequest(id: string): Promise<RequestRecord | null>;
  listRequests(ownerSub: string, opts: { limit: number; cursor?: string | null }): Promise<Page<RequestRecord>>;
  /** Atomically reserves one submission slot. False if the request is closed or full. */
  claimSubmission(id: string, now: number): Promise<boolean>;
  addSubmission(requestId: string, transferId: string, createdAt: number, ttl: number): Promise<void>;
  listSubmissionIds(requestId: string, limit: number): Promise<string[]>;
  endRequest(id: string, status: 'expired' | 'revoked', ttl: number): Promise<RequestRecord | null>;

  createSession(session: SessionRecord): Promise<void>;
  getSession(id: string): Promise<SessionRecord | null>;

  putEvent(event: EventRecord, ttl: number): Promise<void>;
  listEvents(subject: string, limit: number): Promise<EventRecord[]>;
  /** `day` is `YYYY-MM-DD` (UTC). Newest first. */
  listEventsByDay(day: string, opts: { limit: number; cursor?: string | null }): Promise<Page<EventRecord>>;

  getSettings(): Promise<Partial<Settings> | null>;
  putSettings(settings: Settings): Promise<void>;
  getSystemConfig(): Promise<SystemConfig | null>;
  putSystemConfig(config: SystemConfig): Promise<void>;

  /** Transfers and requests whose deleteAfter/expiresAt has passed. */
  listDue(now: number, limit: number): Promise<DueItem[]>;
}

export interface UploadedPart {
  partNumber: number;
  etag: string;
}

/** File storage. Implemented by S3BlobStore and LocalBlobStore (dev). */
export interface BlobStore {
  createMultipartUpload(key: string, contentType: string): Promise<string>;
  presignUploadPart(key: string, uploadId: string, partNumber: number, expiresInSeconds: number): Promise<string>;
  completeMultipartUpload(key: string, uploadId: string, parts: UploadedPart[]): Promise<void>;
  abortMultipartUpload(key: string, uploadId: string): Promise<void>;
  /** Object size in bytes, or null if it does not exist. */
  size(key: string): Promise<number | null>;
  presignDownload(
    key: string,
    opts: { contentDisposition: string; contentType: string; expiresInSeconds: number },
  ): Promise<string>;
  deleteObjects(keys: string[]): Promise<void>;
}

/** User management. Implemented by CognitoDirectory and MemoryDirectory (dev). */
export interface Directory {
  listUsers(): Promise<UserInfo[]>;
  inviteUser(email: string, admin: boolean): Promise<UserInfo>;
  setEnabled(username: string, enabled: boolean): Promise<void>;
  setAdmin(username: string, admin: boolean): Promise<void>;
  deleteUser(username: string): Promise<void>;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  replyTo?: string;
}

export interface Mailer {
  readonly enabled: boolean;
  send(message: MailMessage): Promise<void>;
}

/** Pro: SAML/OIDC identity providers in the user pool. Implemented in ee/. */
export interface IdentityProviders {
  list(): Promise<SsoProviderInfo[]>;
  create(input: SsoProviderInput): Promise<void>;
  delete(name: string): Promise<void>;
  /** Makes the app client offer exactly these providers (plus Cognito's own login). */
  syncClient(providerNames: string[]): Promise<void>;
}

export interface Principal {
  sub: string;
  username: string;
  email: string;
  isAdmin: boolean;
}

export interface Authenticator {
  authenticate(token: string): Promise<Principal | null>;
}

/** Static configuration from environment variables. */
export interface Env {
  version: string;
  region: string;
  maxRetentionDays: number;
  malwareScanning: boolean;
  devMode: boolean;
}

export interface Deps {
  env: Env;
  store: Store;
  blobs: BlobStore;
  directory: Directory;
  idp: IdentityProviders;
  mailer: Mailer;
  auth: Authenticator;
  log: Logger;
  now(): number;
  /** Deploy-time configuration (cached). */
  system(): Promise<SystemConfig>;
  /** Admin settings merged with defaults (cached for a few seconds). */
  settings(): Promise<Settings>;
  invalidateSettings(): void;
}

/** What Pro route handlers (ee/) receive from the core. */
export interface ProRouteContext {
  deps: Deps;
  requireAdmin(req: HttpRequest): Promise<Principal>;
  /** Throws 403 `pro_required` unless the installed license includes the feature. */
  requireFeature(feature: ProFeature): Promise<void>;
}
