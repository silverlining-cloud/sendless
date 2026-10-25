// Issues a signed Sendless Pro license key.
//   npm run license:issue -- --kid sendless-2026-1 --licensee "Acme GmbH" --days 365 [--features sso,audit]
import { createPrivateKey, randomUUID, sign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { PRO_FEATURES } from '@sendless/shared';
import { LICENSE_TYPE, licensePayloadSchema } from '../api/license.js';

const { values } = parseArgs({
  options: {
    kid: { type: 'string' },
    licensee: { type: 'string' },
    days: { type: 'string', default: '365' },
    features: { type: 'string', default: PRO_FEATURES.join(',') },
    key: { type: 'string' },
  },
});
if (!values.kid || !values.licensee) {
  console.error('Usage: license:issue -- --kid <key id> --licensee "<name>" [--days 365] [--features sso,audit] [--key <pem>]');
  process.exit(1);
}

const now = Math.floor(Date.now() / 1000);
const payload = licensePayloadSchema.parse({
  iss: 'sendless',
  lid: randomUUID(),
  licensee: values.licensee,
  edition: 'pro',
  features: values.features!.split(',').map((f) => f.trim()),
  iat: now,
  exp: now + Number(values.days) * 86_400,
});
const keyFile = values.key ?? path.join(homedir(), '.sendless', `${values.kid}.private.pem`);
const privateKey = createPrivateKey(readFileSync(keyFile));

const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const signingInput = `${encode({ alg: 'EdDSA', typ: LICENSE_TYPE, kid: values.kid })}.${encode(payload)}`;
const signature = sign(null, Buffer.from(signingInput), privateKey).toString('base64url');

console.error(`License ${payload.lid} for ${payload.licensee}, valid until ${new Date(payload.exp * 1000).toISOString().slice(0, 10)}`);
console.log(`${signingInput}.${signature}`);
