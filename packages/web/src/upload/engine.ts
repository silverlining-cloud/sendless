import type { FinalizeResult, PartUrl, UploadPlan } from '@sendless/shared';
import { ApiError, publicApi } from '../api/client.js';

/**
 * Uploads files straight to S3 with multipart uploads: presigned part URLs are fetched in
 * batches, parts go up in parallel with retries, each file is completed, then the transfer
 * is finalized. Nothing passes through Lambda except small JSON calls.
 */

export interface UploadProgress {
  uploaded: number;
  total: number;
  bytesPerSecond: number;
  secondsLeft: number;
}

export class UploadCancelled extends Error {
  constructor() {
    super('Upload cancelled');
  }
}

const CONCURRENCY = 4;
const URL_BATCH = 20;
const MAX_ATTEMPTS = 6;

interface Task {
  fileIndex: number;
  partNumber: number;
}

class PartError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function putPart(url: string, body: Blob, onProgress: (loaded: number) => void, xhrs: Set<XMLHttpRequest>): Promise<string> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhrs.add(xhr);
    xhr.open('PUT', url);
    xhr.upload.onprogress = (e) => onProgress(e.loaded);
    xhr.onload = () => {
      xhrs.delete(xhr);
      const etag = xhr.getResponseHeader('ETag');
      if (xhr.status >= 200 && xhr.status < 300 && etag) resolve(etag);
      else reject(new PartError(xhr.status, etag ? `Upload failed (${xhr.status})` : 'Missing ETag (check the bucket CORS settings)'));
    };
    xhr.onerror = () => {
      xhrs.delete(xhr);
      reject(new PartError(0, 'Network error'));
    };
    xhr.onabort = () => {
      xhrs.delete(xhr);
      reject(new UploadCancelled());
    };
    xhr.send(body);
  });
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener('abort', () => {
      clearTimeout(timer);
      reject(new UploadCancelled());
    }, { once: true });
  });

export async function runUpload(
  plan: UploadPlan,
  files: File[],
  opts: { onProgress(progress: UploadProgress): void; signal: AbortSignal },
): Promise<FinalizeResult> {
  const base = `/api/public/uploads/${encodeURIComponent(plan.transferId)}`;
  const { uploadToken } = plan;
  const xhrs = new Set<XMLHttpRequest>();
  opts.signal.addEventListener('abort', () => xhrs.forEach((x) => x.abort()), { once: true });

  const total = plan.files.reduce((sum, f) => sum + f.size, 0);
  let completedBytes = 0;
  const inFlight = new Map<string, number>();
  const samples: { at: number; bytes: number }[] = [];
  let lastReport = 0;
  const report = (force = false) => {
    const now = performance.now();
    if (!force && now - lastReport < 200) return;
    lastReport = now;
    const uploaded = completedBytes + [...inFlight.values()].reduce((a, b) => a + b, 0);
    samples.push({ at: now, bytes: uploaded });
    while (samples.length > 2 && now - samples[0]!.at > 6000) samples.shift();
    const first = samples[0]!;
    const rate = now > first.at ? ((uploaded - first.bytes) / (now - first.at)) * 1000 : 0;
    opts.onProgress({ uploaded, total, bytesPerSecond: rate, secondsLeft: rate > 0 ? (total - uploaded) / rate : Infinity });
  };

  // Presigned URLs, fetched lazily in batches (they are valid for an hour, so huge files refresh them).
  const batches = new Map<string, Promise<Map<number, string>>>();
  const urlFor = async (fileIndex: number, partNumber: number): Promise<string> => {
    const file = plan.files[fileIndex]!;
    const start = Math.floor((partNumber - 1) / URL_BATCH) * URL_BATCH + 1;
    const key = `${fileIndex}:${start}`;
    let batch = batches.get(key);
    if (!batch) {
      const partNumbers = Array.from({ length: Math.min(URL_BATCH, file.partCount - start + 1) }, (_, i) => start + i);
      batch = publicApi
        .post<{ parts: PartUrl[] }>(`${base}/files/${encodeURIComponent(file.id)}/parts`, { uploadToken, partNumbers })
        .then((r) => new Map(r.parts.map((p) => [p.partNumber, p.url])));
      batch.catch(() => batches.delete(key));
      batches.set(key, batch);
    }
    const url = (await batch).get(partNumber);
    if (!url) throw new Error(`No URL for part ${partNumber}`);
    return url;
  };
  const forgetUrls = (fileIndex: number, partNumber: number) => {
    batches.delete(`${fileIndex}:${Math.floor((partNumber - 1) / URL_BATCH) * URL_BATCH + 1}`);
  };

  const etags = plan.files.map(() => new Map<number, string>());
  const tasks: Task[] = plan.files.flatMap((f, fileIndex) =>
    Array.from({ length: f.partCount }, (_, i) => ({ fileIndex, partNumber: i + 1 })),
  );

  const completeFile = async (fileIndex: number) => {
    const file = plan.files[fileIndex]!;
    const parts = [...etags[fileIndex]!.entries()].sort(([a], [b]) => a - b).map(([partNumber, etag]) => ({ partNumber, etag }));
    await publicApi.post<void>(`${base}/files/${encodeURIComponent(file.id)}/complete`, { uploadToken, parts });
  };

  const uploadPart = async ({ fileIndex, partNumber }: Task) => {
    const meta = plan.files[fileIndex]!;
    const start = (partNumber - 1) * meta.partSize;
    const blob = files[fileIndex]!.slice(start, Math.min(start + meta.partSize, meta.size));
    const key = `${fileIndex}:${partNumber}`;
    for (let attempt = 1; ; attempt++) {
      if (opts.signal.aborted) throw new UploadCancelled();
      try {
        const url = await urlFor(fileIndex, partNumber);
        const etag = await putPart(url, blob, (loaded) => {
          inFlight.set(key, loaded);
          report();
        }, xhrs);
        inFlight.delete(key);
        completedBytes += blob.size;
        etags[fileIndex]!.set(partNumber, etag);
        report();
        return;
      } catch (error) {
        inFlight.delete(key);
        if (error instanceof UploadCancelled || opts.signal.aborted) throw new UploadCancelled();
        if (error instanceof ApiError && error.status < 500) throw error; // upload closed, bad token…
        if (attempt >= MAX_ATTEMPTS) throw error;
        if (error instanceof PartError && error.status === 403) forgetUrls(fileIndex, partNumber); // expired URL
        await sleep(Math.min(16_000, 1000 * 2 ** (attempt - 1)), opts.signal);
      }
    }
  };

  let next = 0;
  const finished = plan.files.map(() => 0);
  const worker = async () => {
    while (next < tasks.length) {
      const task = tasks[next++]!;
      await uploadPart(task);
      if (++finished[task.fileIndex]! === plan.files[task.fileIndex]!.partCount) await completeFile(task.fileIndex);
    }
  };

  try {
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, tasks.length) }, worker));
  } catch (error) {
    xhrs.forEach((x) => x.abort());
    throw error;
  }
  report(true);
  return publicApi.post<FinalizeResult>(`${base}/finalize`, { uploadToken });
}

/** Best effort: tell the server to discard an abandoned upload. */
export async function abortUpload(plan: UploadPlan): Promise<void> {
  try {
    await publicApi.post<void>(`/api/public/uploads/${encodeURIComponent(plan.transferId)}/abort`, { uploadToken: plan.uploadToken });
  } catch {
    // The sweeper cleans up within 24 hours anyway.
  }
}
