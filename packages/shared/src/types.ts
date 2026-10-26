import type { ProFeature } from './constants.js';
import type { Branding, Policies, ProBranding, SettingsInput } from './schemas.js';

export type Edition = 'community' | 'pro';
export type TransferKind = 'outbound' | 'inbound';
export type TransferStatus = 'uploading' | 'ready' | 'expired' | 'revoked';
export type RequestStatus = 'active' | 'expired' | 'revoked';
export type FileStatus = 'pending' | 'uploaded' | 'failed';
export type ScanStatus = 'pending' | 'clean' | 'infected' | 'unsupported' | 'error';

export interface ApiErrorBody {
  error: { code: string; message: string };
}

export interface AuthConfig {
  mode: 'cognito' | 'dev';
  region: string;
  userPoolId: string;
  clientId: string;
  /** Cognito managed login domain, e.g. `sendless-…auth.eu-central-1.amazoncognito.com`. */
  domain: string;
  selfSignUp: boolean;
}

export interface EffectiveLimits {
  maxTransferBytes: number;
  maxFilesPerTransfer: number;
  maxExpiresInHours: number;
  defaultExpiresInHours: number;
  defaultMaxOpens: number | null;
  allowUnlimitedOpens: boolean;
  /** Highest open limit a sender may choose (null = no cap). */
  maxOpensLimit: number | null;
  requirePassword: boolean;
  minPasswordLength: number;
  blockedExtensions: string[];
  allowedRecipientDomains: string[];
}

export interface PublicConfig {
  version: string;
  edition: Edition;
  branding: Branding;
  auth: AuthConfig;
  features: { email: boolean; malwareScanning: boolean };
  limits: EffectiveLimits;
}

export interface FileInfo {
  id: string;
  name: string;
  size: number;
  contentType: string;
  status: FileStatus;
  /** Only present when malware scanning is active. */
  scan?: ScanStatus;
}

export interface Submitter {
  name: string | null;
  email: string | null;
  message: string | null;
}

export interface TransferSummary {
  id: string;
  kind: TransferKind;
  title: string | null;
  status: TransferStatus;
  createdAt: string;
  expiresAt: string;
  maxOpens: number | null;
  opens: number;
  totalSize: number;
  fileCount: number;
  /** Shown when there is no title. */
  firstFileName: string | null;
  hasPassword: boolean;
  /** Public download link (outbound transfers only). */
  url: string | null;
  requestId: string | null;
  submitter: Submitter | null;
}

export type EventActor =
  | { type: 'user'; email: string }
  | { type: 'recipient' }
  | { type: 'system' };

export interface EventInfo {
  id: string;
  at: string;
  action: string;
  actor: EventActor;
  ip: string | null;
  country: string | null;
  userAgent: string | null;
  details: Record<string, string | number | boolean> | null;
  subject: string;
}

export interface TransferDetail extends TransferSummary {
  message: string | null;
  recipients: string[];
  notifyOnOpen: boolean;
  files: FileInfo[];
  events: EventInfo[];
}

export interface UploadPlanFile {
  id: string;
  name: string;
  size: number;
  partSize: number;
  partCount: number;
}

export interface UploadPlan {
  transferId: string;
  uploadToken: string;
  files: UploadPlanFile[];
}

export interface CreateTransferResult {
  transfer: TransferSummary;
  upload: UploadPlan;
}

export interface PartUrl {
  partNumber: number;
  url: string;
}

export interface FinalizeResult {
  transferId: string;
  /** Public download link for outbound transfers, null for inbound submissions. */
  url: string | null;
}

export interface PublicTransfer {
  id: string;
  title: string | null;
  message: string | null;
  senderEmail: string | null;
  expiresAt: string;
  passwordRequired: boolean;
  fileCount: number;
  totalSize: number;
  opensLeft: number | null;
}

export interface UnlockResult {
  sessionId: string;
  sessionExpiresAt: string;
  files: FileInfo[];
}

export interface DownloadUrl {
  url: string;
  expiresAt: string;
}

export interface RequestSummary {
  id: string;
  title: string;
  status: RequestStatus;
  createdAt: string;
  expiresAt: string;
  submissions: number;
  maxSubmissions: number | null;
  hasPassword: boolean;
  url: string;
}

export interface RequestDetail extends RequestSummary {
  message: string | null;
  maxBytesPerSubmission: number | null;
  retentionHours: number;
  notifyOnSubmission: boolean;
  transfers: TransferSummary[];
}

export interface PublicRequest {
  id: string;
  title: string;
  message: string | null;
  ownerEmail: string | null;
  expiresAt: string;
  passwordRequired: boolean;
  maxBytesPerSubmission: number;
  maxFilesPerSubmission: number;
}

export interface SubmissionResult {
  upload: UploadPlan;
}

export interface Me {
  sub: string;
  email: string;
  isAdmin: boolean;
}

export interface UserInfo {
  username: string;
  email: string;
  enabled: boolean;
  status: string;
  isAdmin: boolean;
  createdAt: string | null;
}

export interface LicenseInfo {
  licenseId: string;
  licensee: string;
  edition: Edition;
  features: ProFeature[];
  expiresAt: string;
}

export interface SystemInfo {
  version: string;
  region: string;
  appUrl: string;
  emailEnabled: boolean;
  malwareScanningAvailable: boolean;
  maxRetentionDays: number;
}

export interface AdminSettings {
  settings: SettingsInput;
  /** Stored even without a license; it only takes effect with the `branding` feature. */
  branding: ProBranding;
  policies: Policies;
  license: LicenseInfo | null;
  licenseError: string | null;
  system: SystemInfo;
}

export interface Page<T> {
  items: T[];
  cursor: string | null;
}

export interface SsoProviderInfo {
  name: string;
  type: 'saml' | 'oidc';
  emailDomains: string[];
}
