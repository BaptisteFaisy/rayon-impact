#!/usr/bin/env node
/**
 * Builds the offline demo bundle: the app's own screens, resolvers and actions,
 * with the two Forge modules replaced by the doubles the test suite already
 * ships (`@forge/react` renders real HTML, `@forge/bridge` is never called).
 *
 * Why a bundle: the screens are TypeScript + JSX against `@forge/react`, which
 * only draws inside Atlassian's runtime. esbuild resolves it to the test mock,
 * so the demo mounts the SAME components the app mounts.
 *
 * Rule: files < 500 lines, functions < 50 lines.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'demo/.build/entry.mjs');
const ESBUILD = resolve(ROOT, 'node_modules/.bin/esbuild');

/** The `require` an ESM bundle needs for the CJS packages it pulls in. */
const BANNER = "import{createRequire as __cr}from'module';" + "const require=__cr(import.meta.url);"

const ARGS = [
  ESBUILD,
  'scripts/demo/entry.ts',
  '--bundle',
  '--platform=node',
  '--format=esm',
  `--outfile=${OUT}`,
  '--alias:@forge/react=./scripts/demo/kit-mock.tsx',
  '--alias:@forge/bridge=./tests/demo/bridge-stub.ts',
  '--external:react',
  '--external:react-dom',
  '--external:react-dom/server',
  '--define:process.env.NODE_ENV="production"',
  // Forge SDKs load lazily (non-literal specifier) and Atlaskit is CJS:
  // an ESM bundle has no `require`, so one is provided at module top.
  '--banner:js=' + BANNER,
];

if (!existsSync(ESBUILD)) {
  console.error('esbuild introuvable — lance `npm ci` à la racine du dépôt.');
  process.exit(1);
}

const child = spawn(ARGS[0], ARGS.slice(1), { cwd: ROOT, stdio: 'inherit' });
child.on('exit', (code) => {
  if (code !== 0) process.exit(code ?? 1);
  console.log(`Bundle de démo prêt : ${OUT}`);
});
