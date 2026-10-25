import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { pipeline } from 'node:stream/promises';
import type { BlobStore, UploadedPart } from '../ports.js';

/**
 * Dev-only BlobStore on the local file system. "Presigned" URLs point at the dev server
 * (`/__dev/blob/...`) and are HMAC-signed with an expiry, mimicking S3's behaviour closely
 * enough to exercise the real upload and download code in the browser.
 */
export class LocalBlobStore implements BlobStore {
  private readonly secret = randomBytes(32);

  constructor(private readonly root: string) {}

  private objectPath(key: string): string {
    if (!/^[A-Za-z0-9/_-]+$/.test(key) || key.includes('..')) throw new Error(`invalid key ${key}`);
    return path.join(this.root, 'objects', key);
  }

  private uploadDir(uploadId: string): string {
    if (!/^[A-Za-z0-9_-]+$/.test(uploadId)) throw new Error('invalid upload id');
    return path.join(this.root, 'uploads', uploadId);
  }

  private sign(params: Record<string, string>): string {
    const canonical = Object.keys(params)
      .sort()
      .map((k) => `${k}=${params[k]}`)
      .join('&');
    return createHmac('sha256', this.secret).update(canonical).digest('hex');
  }

  private url(kind: 'part' | 'object', params: Record<string, string>, expiresInSeconds: number): string {
    const all = { ...params, exp: String(Date.now() + expiresInSeconds * 1000) };
    return `/__dev/blob/${kind}?${new URLSearchParams({ ...all, sig: this.sign(all) })}`;
  }

  async createMultipartUpload(key: string) {
    const uploadId = randomBytes(12).toString('base64url');
    await mkdir(this.uploadDir(uploadId), { recursive: true });
    await writeFile(path.join(this.uploadDir(uploadId), 'key'), key);
    return uploadId;
  }

  async presignUploadPart(key: string, uploadId: string, partNumber: number, expiresInSeconds: number) {
    return this.url('part', { key, uploadId, partNumber: String(partNumber) }, expiresInSeconds);
  }

  async completeMultipartUpload(key: string, uploadId: string, parts: UploadedPart[]) {
    const dir = this.uploadDir(uploadId);
    if ((await readFile(path.join(dir, 'key'), 'utf8')) !== key) throw new Error('upload does not belong to key');
    const target = this.objectPath(key);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, '');
    for (const part of parts) {
      const file = path.join(dir, String(part.partNumber));
      const etag = `"${createHash('md5').update(await readFile(file)).digest('hex')}"`;
      if (etag !== part.etag && `"${part.etag}"` !== etag) throw new Error(`ETag mismatch for part ${part.partNumber}`);
      await pipeline(createReadStream(file), createWriteStream(target, { flags: 'a' }));
    }
    await rm(dir, { recursive: true, force: true });
  }

  async abortMultipartUpload(_key: string, uploadId: string) {
    await rm(this.uploadDir(uploadId), { recursive: true, force: true });
  }

  async size(key: string) {
    try {
      return (await stat(this.objectPath(key))).size;
    } catch {
      return null;
    }
  }

  async presignDownload(key: string, opts: { contentDisposition: string; contentType: string; expiresInSeconds: number }) {
    return this.url('object', { key, cd: opts.contentDisposition, ct: opts.contentType }, opts.expiresInSeconds);
  }

  async deleteObjects(keys: string[]) {
    await Promise.all(keys.map((k) => rm(this.objectPath(k), { force: true })));
  }

  /** Handles `/__dev/blob/*` requests on the dev server. Returns false for other paths. */
  async handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/__dev/blob/')) return false;
    const params = Object.fromEntries(url.searchParams);
    const { sig = '', ...signed } = params;
    const expected = this.sign(signed);
    const valid = sig.length === expected.length && timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
    if (!valid || Number(signed.exp) < Date.now()) {
      res.writeHead(403, { 'content-type': 'text/plain' }).end('Request has expired or signature is invalid');
      return true;
    }
    if (url.pathname === '/__dev/blob/part' && req.method === 'PUT') {
      const file = path.join(this.uploadDir(signed.uploadId!), signed.partNumber!);
      const hash = createHash('md5');
      req.on('data', (chunk: Buffer) => hash.update(chunk));
      await pipeline(req, createWriteStream(file));
      res.writeHead(200, { etag: `"${hash.digest('hex')}"`, 'access-control-expose-headers': 'ETag' }).end();
      return true;
    }
    if (url.pathname === '/__dev/blob/object' && req.method === 'GET') {
      const file = this.objectPath(signed.key!);
      const info = await stat(file).catch(() => null);
      if (!info) {
        res.writeHead(404, { 'content-type': 'text/plain' }).end('NoSuchKey');
        return true;
      }
      res.writeHead(200, {
        'content-type': signed.ct ?? 'application/octet-stream',
        'content-disposition': signed.cd ?? 'attachment',
        'content-length': String(info.size),
      });
      await pipeline(createReadStream(file), res);
      return true;
    }
    res.writeHead(405).end();
    return true;
  }
}
