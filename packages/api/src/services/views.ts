import type { FileInfo, RequestSummary, TransferSummary } from '@s3ndless/shared';
import type { RequestRecord, StoredFile, TransferRecord } from '../model.js';

export const iso = (ms: number) => new Date(ms).toISOString();

export const transferUrl = (appUrl: string, id: string) => `${appUrl}/d/${id}`;
export const requestUrl = (appUrl: string, id: string) => `${appUrl}/r/${id}`;

export function toFileInfo(file: StoredFile): FileInfo {
  const info: FileInfo = {
    id: file.id,
    name: file.name,
    size: file.size,
    contentType: file.contentType,
    status: file.status,
  };
  if (file.scan) info.scan = file.scan;
  return info;
}

export function orderedFiles(transfer: TransferRecord): StoredFile[] {
  return transfer.fileOrder.map((id) => transfer.files[id]).filter((f): f is StoredFile => Boolean(f));
}

/** Expired-by-time transfers may still say `ready` until the sweeper runs; report what users see. */
export function effectiveTransferStatus(transfer: TransferRecord, now: number): TransferSummary['status'] {
  if (transfer.status === 'ready' && (transfer.expiresAt <= now || transfer.deleteAfter <= now)) return 'expired';
  return transfer.status;
}

export function toTransferSummary(transfer: TransferRecord, appUrl: string, now: number): TransferSummary {
  return {
    id: transfer.id,
    kind: transfer.kind,
    title: transfer.title,
    status: effectiveTransferStatus(transfer, now),
    createdAt: iso(transfer.createdAt),
    expiresAt: iso(transfer.expiresAt),
    maxOpens: transfer.maxOpens,
    opens: transfer.opens,
    totalSize: transfer.totalSize,
    fileCount: transfer.fileOrder.length,
    firstFileName: transfer.files[transfer.fileOrder[0] ?? '']?.name ?? null,
    hasPassword: transfer.passwordHash !== null,
    url: transfer.kind === 'outbound' ? transferUrl(appUrl, transfer.id) : null,
    requestId: transfer.requestId,
    submitter: transfer.submitter,
  };
}

export function effectiveRequestStatus(request: RequestRecord, now: number): RequestSummary['status'] {
  if (request.status === 'active' && request.expiresAt <= now) return 'expired';
  return request.status;
}

export function toRequestSummary(request: RequestRecord, appUrl: string, now: number): RequestSummary {
  return {
    id: request.id,
    title: request.title,
    status: effectiveRequestStatus(request, now),
    createdAt: iso(request.createdAt),
    expiresAt: iso(request.expiresAt),
    submissions: request.submissions,
    maxSubmissions: request.maxSubmissions,
    hasPassword: request.passwordHash !== null,
    url: requestUrl(appUrl, request.id),
  };
}
