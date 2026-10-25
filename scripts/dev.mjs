// Runs the API dev server (in-memory adapters, no AWS needed) and the Vite dev server together.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
// --pro: enable S3ndless Pro features with a throwaway development license.
const env = { ...process.env, ...(process.argv.includes('--pro') ? { S3NDLESS_DEV_PRO: '1' } : {}) };
const children = [
  spawn('npx', ['tsx', 'watch', 'packages/api/src/dev/server.ts'], { cwd: root, stdio: 'inherit', env }),
  spawn('npx', ['vite'], { cwd: `${root}packages/web`, stdio: 'inherit' }),
];

const stop = () => {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
for (const child of children) child.on('exit', (code) => code && code !== 0 && stop());
