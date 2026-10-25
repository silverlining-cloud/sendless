import { MemoryIdentityProviders } from '@s3ndless/ee/api';
import { DevAuthenticator, MemoryDirectory } from './adapters/dev.js';
import { ConsoleMailer } from './adapters/mailers.js';
import { MemoryStore } from './adapters/memory-store.js';
import { createApp } from './app.js';
import { createDeps } from './deps.js';
import type { HttpRequest, HttpResponse } from './http.js';
import type { Logger } from './log.js';
import type { BlobStore, Deps, Principal, UploadedPart } from './ports.js';

/** In-memory S3 stand-in that tracks uploaded bytes per part, so size checks can be exercised. */
export class FakeBlobs implements BlobStore {
  objects = new Map<string, number>();
  uploads = new Map<string, { key: string; parts: Map<number, number> }>();
  private seq = 0;

  async createMultipartUpload(key: string) {
    const id = `up-${++this.seq}`;
    this.uploads.set(id, { key, parts: new Map() });
    return id;
  }
  async presignUploadPart(key: string, uploadId: string, partNumber: number) {
    return `https://blobs.test/${key}?uploadId=${uploadId}&partNumber=${partNumber}`;
  }
  /** Test helper: what the browser's PUT to a presigned part URL would do. */
  putPart(uploadId: string, partNumber: number, bytes: number): UploadedPart {
    this.uploads.get(uploadId)!.parts.set(partNumber, bytes);
    return { partNumber, etag: `"etag-${uploadId}-${partNumber}"` };
  }
  async completeMultipartUpload(key: string, uploadId: string, parts: UploadedPart[]) {
    const upload = this.uploads.get(uploadId);
    if (!upload || upload.key !== key) throw new Error('NoSuchUpload');
    const size = parts.reduce((sum, p) => {
      const bytes = upload.parts.get(p.partNumber);
      if (bytes === undefined) throw new Error('InvalidPart');
      return sum + bytes;
    }, 0);
    this.objects.set(key, size);
    this.uploads.delete(uploadId);
  }
  async abortMultipartUpload(_key: string, uploadId: string) {
    this.uploads.delete(uploadId);
  }
  async size(key: string) {
    return this.objects.get(key) ?? null;
  }
  async presignDownload(key: string, opts: { contentDisposition: string }) {
    return `https://blobs.test/${key}?download=${encodeURIComponent(opts.contentDisposition)}`;
  }
  async deleteObjects(keys: string[]) {
    for (const k of keys) this.objects.delete(k);
  }
}

export const silentLog: Logger = { info() {}, warn() {}, error() {} };

export interface Harness {
  deps: Deps;
  store: MemoryStore;
  blobs: FakeBlobs;
  mailer: ConsoleMailer;
  directory: MemoryDirectory;
  clock: { now: number; advance(ms: number): void };
  admin: Principal;
  user: Principal;
  call(method: string, path: string, opts?: { body?: unknown; as?: 'admin' | 'user'; ip?: string }): Promise<HttpResponse & { json: any }>;
  request(overrides?: Partial<HttpRequest>): HttpRequest;
}

export function createHarness(options: { malwareScanning?: boolean; email?: boolean } = {}): Harness {
  const clock = {
    now: Date.parse('2026-06-01T10:00:00Z'),
    advance(ms: number) {
      this.now += ms;
    },
  };
  const store = new MemoryStore({
    appUrl: 'https://files.example.com',
    userPoolId: 'pool',
    clientId: 'client',
    cognitoDomain: 'login.example.com',
    selfSignUp: false,
  });
  const blobs = new FakeBlobs();
  const mailer = new ConsoleMailer();
  const directory = new MemoryDirectory([
    { email: 'admin@example.com', admin: true },
    { email: 'user@example.com', admin: false },
  ]);
  const deps = createDeps({
    env: { version: 'test', region: 'eu-central-1', maxRetentionDays: 30, malwareScanning: options.malwareScanning ?? false, devMode: true },
    store,
    blobs,
    directory,
    idp: new MemoryIdentityProviders(),
    mailer: options.email === false ? { enabled: false, send: async () => {} } : mailer,
    auth: new DevAuthenticator(directory),
    log: silentLog,
    now: () => clock.now,
  });
  const app = createApp(deps);
  const request = (overrides: Partial<HttpRequest> = {}): HttpRequest => ({
    method: 'GET',
    path: '/',
    headers: {},
    query: {},
    body: undefined,
    ip: '203.0.113.7',
    country: 'DE',
    userAgent: 'vitest',
    ...overrides,
  });
  return {
    deps,
    store,
    blobs,
    mailer,
    directory,
    clock,
    admin: { sub: 'dev-admin-example-com', username: 'admin-example-com', email: 'admin@example.com', isAdmin: true },
    user: { sub: 'dev-user-example-com', username: 'user-example-com', email: 'user@example.com', isAdmin: false },
    request,
    async call(method, path, opts = {}) {
      const [pathname, qs] = path.split('?');
      const res = await app(
        request({
          method,
          path: pathname!,
          query: Object.fromEntries(new URLSearchParams(qs ?? '')),
          headers: opts.as ? { 'x-s3ndless-token': `dev:${opts.as}@example.com` } : {},
          body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
          ...(opts.ip ? { ip: opts.ip } : {}),
        }),
      );
      return { ...res, json: res.body && res.headers?.['content-type']?.includes('json') ? JSON.parse(res.body) : undefined };
    },
  };
}
