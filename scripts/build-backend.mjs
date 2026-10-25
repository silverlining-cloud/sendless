// Bundles the Lambda handlers with esbuild into dist/backend/*.mjs (one shared bundle per handler entry).
import { rmSync } from 'node:fs';
import { build } from 'esbuild';

const handlers = ['api', 'sweeper', 'setup', 'pre-signup', 'scan-result'];
rmSync('dist/backend', { recursive: true, force: true });

const result = await build({
  entryPoints: Object.fromEntries(handlers.map((h) => [h, `packages/api/src/handlers/${h}.ts`])),
  outdir: 'dist/backend',
  outExtension: { '.js': '.mjs' },
  bundle: true,
  splitting: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  minify: true,
  sourcemap: true,
  legalComments: 'linked',
  // Some AWS SDK dependencies are CommonJS and call require() at runtime.
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  metafile: true,
  logLevel: 'warning',
});

const outputs = Object.entries(result.metafile.outputs).filter(([file]) => file.endsWith('.mjs'));
const total = outputs.reduce((sum, [, o]) => sum + o.bytes, 0);
console.log(`backend: ${outputs.length} files, ${(total / 1024).toFixed(0)} KiB`);
