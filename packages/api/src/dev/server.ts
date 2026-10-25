/**
 * Local development server: runs the real API against in-memory adapters, so the whole app
 * works without an AWS account. Data and files are kept in .dev-data/ (delete it to start over).
 *
 * Users: admin@example.com (admin) and user@example.com. Sign in with just the email address.
 */
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { CONTENT_SHA256_HEADER, PRO_FEATURES } from '@s3ndless/shared';
import { LICENSE_TYPE, MemoryIdentityProviders, trustDevelopmentKey } from '@s3ndless/ee/api';
import { DevAuthenticator, MemoryDirectory } from '../adapters/dev.js';
import { LocalBlobStore } from '../adapters/local-blobs.js';
import { ConsoleMailer } from '../adapters/mailers.js';
import { MemoryStore } from '../adapters/memory-store.js';
import { createApp } from '../app.js';
import { createDeps } from '../deps.js';
import type { HttpRequest } from '../http.js';
import { createLogger } from '../log.js';
import { sweep } from '../services/sweeper.js';

// Not PORT: tools often set that for the web dev server, which the Vite proxy forwards to us.
const PORT = Number(process.env.S3NDLESS_API_PORT ?? 8787);
const APP_URL = process.env.APP_URL ?? 'http://localhost:5173';
const DATA_DIR = path.resolve(import.meta.dirname, '../../../../.dev-data');
const EMPTY_SHA256 = createHash('sha256').update('').digest('hex');

const log = createLogger({ dev: true });
const directory = new MemoryDirectory([
  { email: 'admin@example.com', admin: true },
  { email: 'user@example.com', admin: false },
]);
const store = new MemoryStore({ appUrl: APP_URL, userPoolId: 'local', clientId: 'local', cognitoDomain: 'local', selfSignUp: false });
const SNAPSHOT = path.join(DATA_DIR, 'store.json');
if (existsSync(SNAPSHOT)) store.restore(readFileSync(SNAPSHOT, 'utf8'));
let lastSnapshot = '';
const saveSnapshot = () => {
  const next = store.snapshot();
  if (next === lastSnapshot) return;
  mkdirSync(DATA_DIR, { recursive: true });
  writeFileSync(SNAPSHOT, next);
  lastSnapshot = next;
};
setInterval(saveSnapshot, 1000).unref();
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    saveSnapshot();
    process.exit(0);
  });
}
const blobs = new LocalBlobStore(path.join(DATA_DIR, 'blobs'));
const deps = createDeps({
  env: {
    version: 'dev',
    region: 'local',
    maxRetentionDays: 30,
    malwareScanning: process.env.DEV_MALWARE_SCANNING === 'true',
    devMode: true,
  },
  store,
  blobs,
  directory,
  idp: new MemoryIdentityProviders(),
  mailer: new ConsoleMailer(log),
  auth: new DevAuthenticator(directory),
  log,
});
const app = createApp(deps);

// S3NDLESS_DEV_PRO=1: install a Pro license signed by a throwaway key that only this process trusts.
if (process.env.S3NDLESS_DEV_PRO === '1') {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  trustDevelopmentKey('local', String(publicKey.export({ type: 'spki', format: 'pem' })));
  const now = Math.floor(Date.now() / 1000);
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url');
  const input = `${enc({ alg: 'EdDSA', typ: LICENSE_TYPE, kid: 'dev:local' })}.${enc({
    iss: 's3ndless',
    lid: 'development',
    licensee: 'Local development',
    edition: 'pro',
    features: [...PRO_FEATURES],
    iat: now,
    exp: now + 30 * 86_400,
  })}`;
  const licenseKey = `${input}.${sign(null, Buffer.from(input), privateKey).toString('base64url')}`;
  await store.putSettings({ ...(await deps.settings()), licenseKey });
  deps.invalidateSettings();
  log.info('Pro features enabled with a development license');
}

function readBody(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    if (await blobs.handle(req, res)) return;
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/api/')) {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
      return;
    }
    const body = await readBody(req);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k.toLowerCase()] = v;

    // Behave like CloudFront OAC + Lambda URLs: writes must carry the SHA-256 of their body.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      const expected = body.length ? createHash('sha256').update(body).digest('hex') : EMPTY_SHA256;
      if (headers[CONTENT_SHA256_HEADER] !== expected) {
        res.writeHead(403, { 'content-type': 'application/json' }).end(
          JSON.stringify({ message: `Missing or wrong ${CONTENT_SHA256_HEADER} header (CloudFront OAC would reject this)` }),
        );
        return;
      }
    }

    const request: HttpRequest = {
      method: req.method ?? 'GET',
      path: url.pathname,
      headers,
      query: Object.fromEntries(url.searchParams),
      body: body.length ? body.toString('utf8') : undefined,
      ip: req.socket.remoteAddress ?? null,
      country: null,
      userAgent: headers['user-agent'] ?? null,
    };
    const response = await app(request);
    res.writeHead(response.statusCode, response.headers).end(response.body ?? '');
  } catch (error) {
    log.error('dev server error', { error });
    if (!res.headersSent) res.writeHead(500).end();
  }
});

server.listen(PORT, () => {
  log.info(`API dev server on http://localhost:${PORT} — sign in as admin@example.com or user@example.com`);
});

setInterval(() => {
  sweep(deps, 5_000)
    .then((r) => (r.transfers || r.requests) && log.info('swept', { ...r }))
    .catch((error) => log.error('sweep failed', { error }));
}, 30_000).unref();
