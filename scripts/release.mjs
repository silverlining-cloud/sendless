// Builds a release: dist/release/{backend.zip, web.zip, sendless.yaml, SHA256SUMS}.
//
//   npm run release -- --base-url https://my-bucket.s3.amazonaws.com/sendless
//
// --base-url is the folder that holds one v<version>/ folder per release; this release goes to
// <base-url>/v<version>/. The template pins the version and the SHA-256 of both zips; the zips are
// byte-for-byte reproducible, so anyone can rebuild a release and compare the checksums.
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { zipSync } from 'fflate';

const { values } = parseArgs({
  options: {
    'base-url': { type: 'string' },
    'skip-build': { type: 'boolean', default: false },
  },
});
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
const baseUrl = (values['base-url'] ?? 'https://REPLACE-WITH-YOUR-BUCKET.s3.amazonaws.com/sendless').replace(/\/$/, '');
if (!baseUrl.startsWith('https://')) throw new Error('--base-url must start with https://');
if (/\/v\d+\.\d+\.\d+[^/]*$/.test(baseUrl)) {
  throw new Error(`--base-url is the folder above the version folders; drop the trailing /v… (got ${baseUrl})`);
}

if (!values['skip-build']) execSync('npm run build', { stdio: 'inherit' });

const FIXED_TIME = new Date('2026-01-01T00:00:00Z');

/** Deterministic zip: sorted entries, fixed timestamps. */
function zipDir(dir) {
  const files = {};
  const walk = (current) => {
    for (const name of readdirSync(current).sort()) {
      const full = path.join(current, name);
      if (statSync(full).isDirectory()) walk(full);
      else files[path.relative(dir, full).split(path.sep).join('/')] = [readFileSync(full), { mtime: FIXED_TIME }];
    }
  };
  walk(dir);
  return zipSync(files, { level: 9, mtime: FIXED_TIME });
}

const sha256 = (data) => createHash('sha256').update(data).digest('hex');

rmSync('dist/release', { recursive: true, force: true });
mkdirSync('dist/release', { recursive: true });

const backend = zipDir('dist/backend');
const web = zipDir('packages/web/dist');
writeFileSync('dist/release/backend.zip', backend);
writeFileSync('dist/release/web.zip', web);

const checksums = { backend: sha256(backend), web: sha256(web) };
const template = readFileSync('template/sendless.yaml', 'utf8')
  .replaceAll('__VERSION__', version)
  .replaceAll('__BACKEND_SHA256__', checksums.backend)
  .replaceAll('__WEB_SHA256__', checksums.web)
  .replaceAll('https://__ARTIFACT_BASE_URL__', baseUrl);
if (/__[A-Z_]+__/.test(template)) throw new Error('Unreplaced placeholder in template');
writeFileSync('dist/release/sendless.yaml', template);
writeFileSync(
  'dist/release/SHA256SUMS',
  `${checksums.backend}  backend.zip\n${checksums.web}  web.zip\n${sha256(template)}  sendless.yaml\n`,
);

console.log(`\nSendless ${version}`);
console.log(`  backend.zip  ${(backend.length / 1024).toFixed(0)} KiB  ${checksums.backend}`);
console.log(`  web.zip      ${(web.length / 1024).toFixed(0)} KiB  ${checksums.web}`);
console.log(`  artifacts expected at ${baseUrl}/v${version}/`);
console.log('\nUpload with: scripts/publish.sh <bucket> [<prefix>]');
