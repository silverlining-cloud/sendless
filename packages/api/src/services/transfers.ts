import {
  LOCKOUT_SECONDS,
  MAX_FAILED_UNLOCKS,
  SESSION_TTL_SECONDS,
  type CreateTransferInput,
  type CreateTransferResult,
  type DownloadUrl,
  type FileInput,
  type FinalizeResult,
  type Page,
  type PartUrl,
  type PublicTransfer,
  type Submitter,
  type TransferDetail,
  type TransferKind,
  type TransferSummary,
  type UnlockResult,
  type UploadPlan,
} from '@sendless/shared';
import { checkFileScan } from '@sendless/ee/api';
import { hashPassword, randomId, safeEqual, verifyPassword } from '../crypto.js';
import { editionFor, hasFeature } from '../edition.js';
import { contentDisposition, planParts, safeContentType, sanitizeFileName } from '../files.js';
import { badRequest, conflict, gone, HttpError, notFound, type HttpRequest } from '../http.js';
import type { ActorRecord, StoredFile, TransferRecord } from '../model.js';
import type { Deps, Principal, UploadedPart } from '../ports.js';
import { auditExpiry, RECIPIENT, recordEvent, requestSubject, toEventInfo, transferSubject, userActor } from './audit.js';
import { checkFiles, checkLifetime, checkOpens, checkPassword, checkRecipients, effectiveLimits } from './limits.js';
import { sendSafely, submissionReceivedMail, transferOpenedMail, transferSharedMail } from './notify.js';
import { iso, orderedFiles, toFileInfo, toTransferSummary, transferUrl } from './views.js';

/** Time allowed to finish an upload before the sweeper discards it. */
export const UPLOAD_WINDOW_MS = 24 * 3600 * 1000;
const PART_URL_TTL_SECONDS = 3600;
const DOWNLOAD_URL_TTL_SECONDS = 300;
const HOUR_MS = 3600 * 1000;

interface NewTransfer {
  kind: TransferKind;
  ownerSub: string;
  ownerEmail: string;
  title: string | null;
  message: string | null;
  files: FileInput[];
  lifetimeHours: number;
  maxOpens: number | null;
  password?: string | undefined;
  recipients: string[];
  notifyOnOpen: boolean;
  requestId: string | null;
  submitter: Submitter | null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const index = next++;
      results[index] = await fn(items[index]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

/** Creates the transfer record and one multipart upload per file. Shared by outbound transfers and request submissions. */
export async function startTransfer(deps: Deps, input: NewTransfer): Promise<{ record: TransferRecord; upload: UploadPlan }> {
  const now = deps.now();
  const id = randomId(16);
  const files = await mapLimit(input.files, 8, async (file): Promise<StoredFile> => {
    const fileId = randomId(9);
    const key = `files/${id}/${fileId}`;
    const contentType = safeContentType(file.contentType);
    const uploadId = await deps.blobs.createMultipartUpload(key, contentType);
    return {
      id: fileId,
      name: sanitizeFileName(file.name),
      size: file.size,
      contentType,
      key,
      uploadId,
      ...planParts(file.size),
      status: 'pending',
      scan: null,
    };
  });
  const expiresAt = now + UPLOAD_WINDOW_MS + input.lifetimeHours * HOUR_MS;
  const record: TransferRecord = {
    id,
    kind: input.kind,
    ownerSub: input.ownerSub,
    ownerEmail: input.ownerEmail,
    title: input.title,
    message: input.message,
    recipients: input.recipients,
    createdAt: now,
    lifetimeHours: input.lifetimeHours,
    expiresAt,
    deleteAfter: now + UPLOAD_WINDOW_MS,
    maxOpens: input.maxOpens,
    opens: 0,
    passwordHash: input.password ? await hashPassword(input.password) : null,
    failedUnlocks: 0,
    lockedUntil: 0,
    status: 'uploading',
    uploadToken: randomId(24),
    files: Object.fromEntries(files.map((f) => [f.id, f])),
    fileOrder: files.map((f) => f.id),
    totalSize: files.reduce((sum, f) => sum + f.size, 0),
    notifyOnOpen: input.notifyOnOpen,
    requestId: input.requestId,
    submitter: input.submitter,
    ttl: (await auditExpiry(deps, expiresAt)) + 86_400,
  };
  await deps.store.createTransfer(record);
  return {
    record,
    upload: {
      transferId: id,
      uploadToken: record.uploadToken,
      files: files.map((f) => ({ id: f.id, name: f.name, size: f.size, partSize: f.partSize, partCount: f.partCount })),
    },
  };
}

export async function createTransfer(
  deps: Deps,
  principal: Principal,
  input: CreateTransferInput,
  req: HttpRequest,
): Promise<CreateTransferResult> {
  const settings = await deps.settings();
  const limits = effectiveLimits(settings, deps.env, editionFor(settings, deps.now()));
  checkFiles(input.files, limits);
  checkLifetime(input.expiresInHours, limits);
  checkOpens(input.maxOpens, limits);
  checkPassword(input.password, limits);
  const recipients = [...new Set(input.recipients.map((r) => r.toLowerCase()))];
  checkRecipients(recipients, limits, deps.mailer.enabled);

  const { record, upload } = await startTransfer(deps, {
    kind: 'outbound',
    ownerSub: principal.sub,
    ownerEmail: principal.email,
    title: input.title ?? null,
    message: input.message ?? null,
    files: input.files,
    lifetimeHours: input.expiresInHours,
    maxOpens: input.maxOpens,
    password: input.password,
    recipients,
    notifyOnOpen: input.notifyOnOpen,
    requestId: null,
    submitter: null,
  });
  await recordEvent(deps, {
    subject: transferSubject(record.id),
    action: 'transfer.created',
    actor: userActor(principal),
    req,
    details: { files: record.fileOrder.length, bytes: record.totalSize, password: record.passwordHash !== null },
  });
  const { appUrl } = await deps.system();
  return { transfer: toTransferSummary(record, appUrl, deps.now()), upload };
}

async function uploadingTransfer(deps: Deps, transferId: string, uploadToken: string): Promise<TransferRecord> {
  const transfer = await deps.store.getTransfer(transferId);
  if (!transfer || !safeEqual(transfer.uploadToken, uploadToken)) throw notFound('Upload not found');
  if (transfer.status !== 'uploading' || transfer.deleteAfter <= deps.now()) {
    throw conflict('This upload is no longer active', 'upload_closed');
  }
  return transfer;
}

function pendingFile(transfer: TransferRecord, fileId: string): StoredFile & { uploadId: string } {
  const file = transfer.files[fileId];
  if (!file) throw notFound('File not found');
  if (file.status !== 'pending' || !file.uploadId) throw conflict('This file is already uploaded', 'file_closed');
  return file as StoredFile & { uploadId: string };
}

export async function presignParts(
  deps: Deps,
  transferId: string,
  fileId: string,
  input: { uploadToken: string; partNumbers: number[] },
): Promise<PartUrl[]> {
  const transfer = await uploadingTransfer(deps, transferId, input.uploadToken);
  const file = pendingFile(transfer, fileId);
  const parts = [...new Set(input.partNumbers)];
  if (parts.some((n) => n > file.partCount)) throw badRequest(`This file has ${file.partCount} parts`);
  return Promise.all(
    parts.map(async (partNumber) => ({
      partNumber,
      url: await deps.blobs.presignUploadPart(file.key, file.uploadId, partNumber, PART_URL_TTL_SECONDS),
    })),
  );
}

export async function completeFile(
  deps: Deps,
  transferId: string,
  fileId: string,
  input: { uploadToken: string; parts: UploadedPart[] },
): Promise<void> {
  const transfer = await uploadingTransfer(deps, transferId, input.uploadToken);
  const file = pendingFile(transfer, fileId);
  const parts = [...input.parts].sort((a, b) => a.partNumber - b.partNumber);
  const complete = parts.length === file.partCount && parts.every((p, i) => p.partNumber === i + 1);
  if (!complete) throw badRequest(`Expected parts 1 to ${file.partCount}`);

  await deps.blobs.completeMultipartUpload(file.key, file.uploadId, parts);
  // Presigned part URLs cannot enforce a length, so verify what actually arrived.
  const actual = await deps.blobs.size(file.key);
  if (actual !== file.size) {
    await deps.blobs.deleteObjects([file.key]);
    await deps.store.markFileFailed(transfer.id, file.id);
    throw badRequest('The uploaded file does not match the announced size', 'size_mismatch');
  }
  await deps.store.markFileUploaded(transfer.id, file.id, deps.env.malwareScanning);
}

export async function finalizeUpload(deps: Deps, transferId: string, uploadToken: string, req: HttpRequest): Promise<FinalizeResult> {
  const transfer = await uploadingTransfer(deps, transferId, uploadToken);
  if (orderedFiles(transfer).some((f) => f.status !== 'uploaded')) {
    throw conflict('Not all files have been uploaded yet', 'upload_incomplete');
  }
  const ready = await deps.store.markTransferReady(transfer.id, deps.now() + transfer.lifetimeHours * HOUR_MS);
  if (!ready) throw conflict('This upload is no longer active', 'upload_closed');

  const settings = await deps.settings();
  const { appUrl } = await deps.system();
  const brand = settings.branding;

  if (ready.kind === 'outbound') {
    const url = transferUrl(appUrl, ready.id);
    const mail = transferSharedMail(brand, {
      sender: ready.ownerEmail,
      title: ready.title,
      message: ready.message,
      url,
      expiresAt: ready.expiresAt,
      fileCount: ready.fileOrder.length,
      totalSize: ready.totalSize,
    });
    let sent = 0;
    for (const to of ready.recipients) if (await sendSafely(deps, { ...mail, to })) sent++;
    await recordEvent(deps, {
      subject: transferSubject(ready.id),
      action: 'transfer.ready',
      actor: { type: 'user', sub: ready.ownerSub, email: ready.ownerEmail },
      req,
      details: { emailsSent: sent },
    });
    return { transferId: ready.id, url };
  }

  await recordEvent(deps, {
    subject: ready.requestId ? requestSubject(ready.requestId) : transferSubject(ready.id),
    action: 'request.submission_received',
    actor: RECIPIENT,
    req,
    details: { transferId: ready.id, files: ready.fileOrder.length, bytes: ready.totalSize },
  });
  if (ready.requestId) {
    const request = await deps.store.getRequest(ready.requestId);
    if (request?.notifyOnSubmission) {
      const mail = submissionReceivedMail(brand, {
        requestTitle: request.title,
        submitter: ready.submitter?.name ?? ready.submitter?.email ?? null,
        message: ready.submitter?.message ?? null,
        fileCount: ready.fileOrder.length,
        totalSize: ready.totalSize,
        detailUrl: `${appUrl}/transfers/${ready.id}`,
      });
      await sendSafely(deps, { ...mail, to: request.ownerEmail, ...(ready.submitter?.email ? { replyTo: ready.submitter.email } : {}) });
    }
  }
  return { transferId: ready.id, url: null };
}

/** Ends a transfer and deletes its files. Used by revoke, abort and the sweeper. */
export async function destroyTransfer(
  deps: Deps,
  id: string,
  status: 'expired' | 'revoked',
  actor: ActorRecord,
  req?: HttpRequest,
): Promise<boolean> {
  const ended = await deps.store.endTransfer(id, status, await auditExpiry(deps));
  if (!ended) return false;
  const files = orderedFiles(ended);
  await Promise.all(
    files
      .filter((f) => f.status === 'pending' && f.uploadId)
      .map((f) =>
        deps.blobs.abortMultipartUpload(f.key, f.uploadId!).catch((error) => deps.log.warn('abort failed', { key: f.key, error })),
      ),
  );
  await deps.blobs.deleteObjects(files.map((f) => f.key));
  await recordEvent(deps, {
    subject: transferSubject(id),
    action: status === 'revoked' ? 'transfer.revoked' : 'transfer.expired',
    actor,
    ...(req ? { req } : {}),
  });
  return true;
}

export async function abortUpload(deps: Deps, transferId: string, uploadToken: string, req: HttpRequest): Promise<void> {
  const transfer = await uploadingTransfer(deps, transferId, uploadToken);
  await destroyTransfer(deps, transfer.id, 'revoked', transfer.kind === 'outbound' ? { type: 'user', sub: transfer.ownerSub, email: transfer.ownerEmail } : RECIPIENT, req);
}

// ---------- signed-in owner ----------

async function ownedTransfer(deps: Deps, principal: Principal, id: string): Promise<TransferRecord> {
  const transfer = await deps.store.getTransfer(id);
  if (!transfer || transfer.ownerSub !== principal.sub) throw notFound('Transfer not found');
  return transfer;
}

export async function listTransfers(
  deps: Deps,
  principal: Principal,
  kind: TransferKind,
  cursor: string | null,
): Promise<Page<TransferSummary>> {
  const page = await deps.store.listTransfers(principal.sub, kind, { limit: 50, cursor });
  const { appUrl } = await deps.system();
  const now = deps.now();
  return { items: page.items.map((t) => toTransferSummary(t, appUrl, now)), cursor: page.cursor };
}

export async function getTransfer(deps: Deps, principal: Principal, id: string): Promise<TransferDetail> {
  const transfer = await ownedTransfer(deps, principal, id);
  const [{ appUrl }, events] = await Promise.all([deps.system(), deps.store.listEvents(transferSubject(id), 200)]);
  return {
    ...toTransferSummary(transfer, appUrl, deps.now()),
    message: transfer.message,
    recipients: transfer.recipients,
    notifyOnOpen: transfer.notifyOnOpen,
    files: orderedFiles(transfer).map(toFileInfo),
    events: events.map(toEventInfo),
  };
}

export async function revokeTransfer(deps: Deps, principal: Principal, id: string, req: HttpRequest): Promise<void> {
  const transfer = await ownedTransfer(deps, principal, id);
  if (transfer.status === 'expired' || transfer.status === 'revoked') return;
  await destroyTransfer(deps, id, 'revoked', userActor(principal), req);
}

async function presignFile(deps: Deps, file: StoredFile): Promise<DownloadUrl> {
  const settings = await deps.settings();
  const edition = editionFor(settings, deps.now());
  if (deps.env.malwareScanning && hasFeature(edition, 'malware-scanning')) {
    const allowUnscannable = hasFeature(edition, 'policies') && settings.policies.allowUnscannableFiles;
    checkFileScan(file, { allowUnscannable });
  }
  const url = await deps.blobs.presignDownload(file.key, {
    contentDisposition: contentDisposition(file.name),
    contentType: file.contentType,
    expiresInSeconds: DOWNLOAD_URL_TTL_SECONDS,
  });
  return { url, expiresAt: iso(deps.now() + DOWNLOAD_URL_TTL_SECONDS * 1000) };
}

export async function ownerDownload(
  deps: Deps,
  principal: Principal,
  id: string,
  fileId: string,
  req: HttpRequest,
): Promise<DownloadUrl> {
  const transfer = await ownedTransfer(deps, principal, id);
  if (transfer.status !== 'ready' || transfer.deleteAfter <= deps.now()) throw gone('These files have been deleted');
  const file = transfer.files[fileId];
  if (!file || file.status !== 'uploaded') throw notFound('File not found');
  const result = await presignFile(deps, file);
  await recordEvent(deps, {
    subject: transferSubject(id),
    action: 'file.downloaded',
    actor: userActor(principal),
    req,
    details: { fileId, name: file.name },
  });
  return result;
}

// ---------- public recipients ----------

async function openableTransfer(deps: Deps, id: string): Promise<TransferRecord> {
  const transfer = await deps.store.getTransfer(id);
  if (!transfer || transfer.kind !== 'outbound' || transfer.status === 'uploading') {
    throw notFound('This link does not exist');
  }
  const now = deps.now();
  if (transfer.status !== 'ready' || transfer.expiresAt <= now || transfer.deleteAfter <= now) {
    throw gone('This link has expired');
  }
  if (transfer.maxOpens !== null && transfer.opens >= transfer.maxOpens) {
    throw gone('This link has reached its download limit', 'limit_reached');
  }
  return transfer;
}

export async function getPublicTransfer(deps: Deps, id: string): Promise<PublicTransfer> {
  const transfer = await openableTransfer(deps, id);
  const settings = await deps.settings();
  return {
    id: transfer.id,
    title: transfer.title,
    message: transfer.message,
    senderEmail: settings.showSenderEmail ? transfer.ownerEmail : null,
    expiresAt: iso(transfer.expiresAt),
    passwordRequired: transfer.passwordHash !== null,
    fileCount: transfer.fileOrder.length,
    totalSize: transfer.totalSize,
    opensLeft: transfer.maxOpens === null ? null : transfer.maxOpens - transfer.opens,
  };
}

/** Checks a link password with lockout. Shared by transfers and file requests. */
export async function checkLinkPassword(
  deps: Deps,
  kind: 'transfer' | 'request',
  record: { id: string; passwordHash: string | null; failedUnlocks: number; lockedUntil: number },
  password: string | undefined,
  req: HttpRequest,
): Promise<void> {
  const now = deps.now();
  if (record.lockedUntil > now) {
    throw new HttpError(429, 'locked', 'Too many wrong passwords. Please try again later.');
  }
  if (!record.passwordHash) return;
  if (password && (await verifyPassword(password, record.passwordHash))) {
    if (record.failedUnlocks > 0) await deps.store.clearFailedUnlocks(kind, record.id);
    return;
  }
  await deps.store.recordFailedUnlock(kind, record.id, now, MAX_FAILED_UNLOCKS, LOCKOUT_SECONDS);
  await recordEvent(deps, {
    subject: kind === 'transfer' ? transferSubject(record.id) : requestSubject(record.id),
    action: `${kind}.password_failed`,
    actor: RECIPIENT,
    req,
  });
  throw new HttpError(401, 'wrong_password', password ? 'Wrong password' : 'Password required');
}

export async function unlockTransfer(deps: Deps, id: string, password: string | undefined, req: HttpRequest): Promise<UnlockResult> {
  const transfer = await openableTransfer(deps, id);
  await checkLinkPassword(deps, 'transfer', transfer, password, req);

  const now = deps.now();
  const result = await deps.store.openTransfer(id, now);
  if (!result.ok) {
    throw result.reason === 'limit'
      ? gone('This link has reached its download limit', 'limit_reached')
      : gone('This link has expired');
  }
  const opened = result.transfer;
  const sessionEnd = Math.min(now + SESSION_TTL_SECONDS * 1000, opened.expiresAt);
  if (opened.maxOpens !== null && opened.opens >= opened.maxOpens) {
    // Last allowed open: keep files only until this session ends.
    await deps.store.setTransferDeleteAfter(id, Math.min(opened.deleteAfter, sessionEnd));
  }
  const session = { id: randomId(24), transferId: id, expiresAt: sessionEnd };
  await deps.store.createSession(session);
  await recordEvent(deps, {
    subject: transferSubject(id),
    action: 'transfer.opened',
    actor: RECIPIENT,
    req,
    details: { opens: opened.opens },
  });
  if (opened.notifyOnOpen) {
    const [settings, { appUrl }] = await Promise.all([deps.settings(), deps.system()]);
    await sendSafely(deps, {
      to: opened.ownerEmail,
      ...transferOpenedMail(settings.branding, {
        title: opened.title,
        opens: opened.opens,
        maxOpens: opened.maxOpens,
        detailUrl: `${appUrl}/transfers/${id}`,
      }),
    });
  }
  return {
    sessionId: session.id,
    sessionExpiresAt: iso(session.expiresAt),
    files: orderedFiles(opened).filter((f) => f.status === 'uploaded').map(toFileInfo),
  };
}

export async function sessionDownload(
  deps: Deps,
  id: string,
  fileId: string,
  sessionId: string,
  req: HttpRequest,
): Promise<DownloadUrl> {
  const now = deps.now();
  const session = await deps.store.getSession(sessionId);
  if (!session || session.transferId !== id || session.expiresAt <= now) {
    throw new HttpError(401, 'session_expired', 'Your download session has expired. Please reload the page.');
  }
  const transfer = await deps.store.getTransfer(id);
  if (!transfer || transfer.status !== 'ready' || transfer.deleteAfter <= now || transfer.expiresAt <= now) {
    throw gone('This link has expired');
  }
  const file = transfer.files[fileId];
  if (!file || file.status !== 'uploaded') throw notFound('File not found');
  const result = await presignFile(deps, file);
  await recordEvent(deps, {
    subject: transferSubject(id),
    action: 'file.downloaded',
    actor: RECIPIENT,
    req,
    details: { fileId, name: file.name },
  });
  return result;
}
