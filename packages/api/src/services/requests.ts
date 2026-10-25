import type {
  CreateRequestInput,
  Page,
  PublicRequest,
  RequestDetail,
  RequestSummary,
  SubmissionInput,
  SubmissionResult,
} from '@sendless/shared';
import { hashPassword, randomId } from '../crypto.js';
import { editionFor } from '../edition.js';
import { badRequest, gone, notFound, type HttpRequest } from '../http.js';
import type { RequestRecord } from '../model.js';
import type { Deps, Principal } from '../ports.js';
import { auditExpiry, RECIPIENT, recordEvent, requestSubject, userActor } from './audit.js';
import { checkFiles, checkLifetime, checkPassword, effectiveLimits } from './limits.js';
import { checkLinkPassword, startTransfer } from './transfers.js';
import { iso, toRequestSummary, toTransferSummary } from './views.js';

const HOUR_MS = 3600 * 1000;

export async function createRequest(
  deps: Deps,
  principal: Principal,
  input: CreateRequestInput,
  req: HttpRequest,
): Promise<RequestSummary> {
  const settings = await deps.settings();
  const limits = effectiveLimits(settings, deps.env, editionFor(settings, deps.now()));
  checkLifetime(input.expiresInHours, limits);
  if (input.retentionHours > limits.maxExpiresInHours) {
    throw badRequest(`Received files can be kept for at most ${limits.maxExpiresInHours} hours`, 'retention_too_long');
  }
  checkPassword(input.password, { ...limits, requirePassword: false });
  if (input.maxBytesPerSubmission !== null && input.maxBytesPerSubmission > limits.maxTransferBytes) {
    throw badRequest('The size limit is higher than this installation allows', 'too_large');
  }

  const now = deps.now();
  const expiresAt = now + input.expiresInHours * HOUR_MS;
  const record: RequestRecord = {
    id: randomId(16),
    ownerSub: principal.sub,
    ownerEmail: principal.email,
    title: input.title,
    message: input.message ?? null,
    createdAt: now,
    expiresAt,
    passwordHash: input.password ? await hashPassword(input.password) : null,
    failedUnlocks: 0,
    lockedUntil: 0,
    maxSubmissions: input.maxSubmissions,
    submissions: 0,
    maxBytesPerSubmission: input.maxBytesPerSubmission,
    retentionHours: input.retentionHours,
    notifyOnSubmission: input.notifyOnSubmission && deps.mailer.enabled,
    status: 'active',
    ttl: await auditExpiry(deps, expiresAt),
  };
  await deps.store.createRequest(record);
  await recordEvent(deps, { subject: requestSubject(record.id), action: 'request.created', actor: userActor(principal), req });
  const { appUrl } = await deps.system();
  return toRequestSummary(record, appUrl, now);
}

export async function listRequests(deps: Deps, principal: Principal, cursor: string | null): Promise<Page<RequestSummary>> {
  const page = await deps.store.listRequests(principal.sub, { limit: 50, cursor });
  const { appUrl } = await deps.system();
  const now = deps.now();
  return { items: page.items.map((r) => toRequestSummary(r, appUrl, now)), cursor: page.cursor };
}

async function ownedRequest(deps: Deps, principal: Principal, id: string): Promise<RequestRecord> {
  const request = await deps.store.getRequest(id);
  if (!request || request.ownerSub !== principal.sub) throw notFound('Request not found');
  return request;
}

export async function getRequest(deps: Deps, principal: Principal, id: string): Promise<RequestDetail> {
  const request = await ownedRequest(deps, principal, id);
  const ids = await deps.store.listSubmissionIds(id, 500);
  const [transfers, { appUrl }] = await Promise.all([deps.store.getTransfers(ids), deps.system()]);
  const now = deps.now();
  return {
    ...toRequestSummary(request, appUrl, now),
    message: request.message,
    maxBytesPerSubmission: request.maxBytesPerSubmission,
    retentionHours: request.retentionHours,
    notifyOnSubmission: request.notifyOnSubmission,
    transfers: transfers
      .filter((t) => t.status !== 'uploading')
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((t) => toTransferSummary(t, appUrl, now)),
  };
}

export async function revokeRequest(deps: Deps, principal: Principal, id: string, req: HttpRequest): Promise<void> {
  const request = await ownedRequest(deps, principal, id);
  if (request.status !== 'active') return;
  await deps.store.endRequest(id, 'revoked', await auditExpiry(deps));
  await recordEvent(deps, { subject: requestSubject(id), action: 'request.revoked', actor: userActor(principal), req });
}

async function openRequest(deps: Deps, id: string): Promise<RequestRecord> {
  const request = await deps.store.getRequest(id);
  if (!request) throw notFound('This link does not exist');
  if (request.status !== 'active' || request.expiresAt <= deps.now()) throw gone('This request is closed');
  if (request.maxSubmissions !== null && request.submissions >= request.maxSubmissions) {
    throw gone('This request has received all the uploads it accepts', 'limit_reached');
  }
  return request;
}

async function submissionLimits(deps: Deps, request: RequestRecord) {
  const settings = await deps.settings();
  const limits = effectiveLimits(settings, deps.env, editionFor(settings, deps.now()));
  return { limits, settings, maxBytes: Math.min(request.maxBytesPerSubmission ?? limits.maxTransferBytes, limits.maxTransferBytes) };
}

export async function getPublicRequest(deps: Deps, id: string): Promise<PublicRequest> {
  const request = await openRequest(deps, id);
  const { limits, settings, maxBytes } = await submissionLimits(deps, request);
  return {
    id: request.id,
    title: request.title,
    message: request.message,
    ownerEmail: settings.showSenderEmail ? request.ownerEmail : null,
    expiresAt: iso(request.expiresAt),
    passwordRequired: request.passwordHash !== null,
    maxBytesPerSubmission: maxBytes,
    maxFilesPerSubmission: limits.maxFilesPerTransfer,
  };
}

export async function submitToRequest(deps: Deps, id: string, input: SubmissionInput, req: HttpRequest): Promise<SubmissionResult> {
  const request = await openRequest(deps, id);
  await checkLinkPassword(deps, 'request', request, input.password, req);
  const { limits, maxBytes } = await submissionLimits(deps, request);
  checkFiles(input.files, limits, maxBytes);

  if (!(await deps.store.claimSubmission(id, deps.now()))) throw gone('This request is closed');
  const { record, upload } = await startTransfer(deps, {
    kind: 'inbound',
    ownerSub: request.ownerSub,
    ownerEmail: request.ownerEmail,
    title: request.title,
    message: input.message ?? null,
    files: input.files,
    lifetimeHours: request.retentionHours,
    maxOpens: null,
    recipients: [],
    notifyOnOpen: false,
    requestId: request.id,
    submitter: { name: input.name ?? null, email: input.email ?? null, message: input.message ?? null },
  });
  await deps.store.addSubmission(request.id, record.id, record.createdAt, record.ttl);
  await recordEvent(deps, {
    subject: requestSubject(id),
    action: 'request.submission_started',
    actor: RECIPIENT,
    req,
    details: { transferId: record.id, files: record.fileOrder.length, bytes: record.totalSize },
  });
  return { upload };
}
