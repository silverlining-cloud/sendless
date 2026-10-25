import type { FileStatus, RequestStatus, ScanStatus, Submitter, TransferKind, TransferStatus } from '@sendless/shared';

/** All timestamps are epoch milliseconds unless the name says otherwise. */

export interface StoredFile {
  id: string;
  name: string;
  size: number;
  contentType: string;
  /** S3 object key. */
  key: string;
  /** Multipart upload ID while the file is being uploaded. */
  uploadId: string | null;
  partSize: number;
  partCount: number;
  status: FileStatus;
  scan: ScanStatus | null;
}

export interface TransferRecord {
  id: string;
  kind: TransferKind;
  ownerSub: string;
  ownerEmail: string;
  title: string | null;
  message: string | null;
  recipients: string[];
  createdAt: number;
  /** Requested lifetime; the final expiry is counted from when the upload finishes. */
  lifetimeHours: number;
  /** When the link stops working (shown to users). */
  expiresAt: number;
  /** When the sweeper deletes the files. Earlier than expiresAt once the open limit is used up. */
  deleteAfter: number;
  maxOpens: number | null;
  opens: number;
  passwordHash: string | null;
  failedUnlocks: number;
  lockedUntil: number;
  status: TransferStatus;
  uploadToken: string;
  files: Record<string, StoredFile>;
  fileOrder: string[];
  totalSize: number;
  notifyOnOpen: boolean;
  requestId: string | null;
  submitter: Submitter | null;
  /** DynamoDB TTL (epoch seconds) for the metadata record itself. */
  ttl: number;
}

export interface RequestRecord {
  id: string;
  ownerSub: string;
  ownerEmail: string;
  title: string;
  message: string | null;
  createdAt: number;
  expiresAt: number;
  passwordHash: string | null;
  failedUnlocks: number;
  lockedUntil: number;
  maxSubmissions: number | null;
  submissions: number;
  maxBytesPerSubmission: number | null;
  retentionHours: number;
  notifyOnSubmission: boolean;
  status: RequestStatus;
  ttl: number;
}

export interface SessionRecord {
  id: string;
  transferId: string;
  expiresAt: number;
}

export type ActorRecord = { type: 'user'; sub: string; email: string } | { type: 'recipient' } | { type: 'system' };

export interface EventRecord {
  id: string;
  /** What the event is about: `TRANSFER#id`, `REQUEST#id` or `ADMIN`. */
  subject: string;
  at: number;
  action: string;
  actor: ActorRecord;
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  details: Record<string, string | number | boolean> | null;
}

/** Written by the setup custom resource at deploy time; breaks dependency cycles in the template. */
export interface SystemConfig {
  appUrl: string;
  userPoolId: string;
  clientId: string;
  cognitoDomain: string;
  selfSignUp: boolean;
}

export interface SsoProviderRecord {
  name: string;
  type: 'saml' | 'oidc';
  emailDomains: string[];
}
