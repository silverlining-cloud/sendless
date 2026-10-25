// Generates an Ed25519 key pair for signing Sendless Pro licenses.
// The private key goes to ~/.sendless/ (never into the repository); the public key is printed
// for ee/api/keys.ts.
import { generateKeyPairSync } from 'node:crypto';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const kid = process.argv[2] ?? `sendless-${new Date().getFullYear()}-1`;
const dir = path.join(homedir(), '.sendless');
const file = path.join(dir, `${kid}.private.pem`);
if (existsSync(file)) {
  console.error(`Refusing to overwrite ${file}`);
  process.exit(1);
}

const { privateKey, publicKey } = generateKeyPairSync('ed25519');
mkdirSync(dir, { recursive: true, mode: 0o700 });
writeFileSync(file, privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 });

console.log(`Private key written to ${file} — back it up somewhere safe.\n`);
console.log('Add this entry to LICENSE_PUBLIC_KEYS in ee/api/keys.ts:\n');
console.log(`  '${kid}': \`${String(publicKey.export({ type: 'spki', format: 'pem' })).trim()}\`,`);
