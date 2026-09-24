#!/usr/bin/env node
/*
 * Runs the Next.js CLI with a larger JavaScript heap.
 *
 * The admin app has outgrown Node's default heap: `next build` and `next dev` both died with
 * "JavaScript heap out of memory" once the finance module was compiled, at about 2.6 GB. The limit
 * has to reach Next's worker processes as well as this one, and only the NODE_OPTIONS environment
 * variable does that. Setting it inline in package.json (`NODE_OPTIONS=... next build`) does not work
 * under Windows' shell, and the production server runs this same script — hence a launcher rather
 * than a new dependency.
 *
 * A limit already present in NODE_OPTIONS wins, so a machine that needs a different figure can set
 * one without editing this file. The figure is a ceiling, not a reservation: nothing is allocated
 * up front.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

// Resolved the way Node itself would find the package, from this app's own node_modules.
const resolveFrom = createRequire(import.meta.url);

const HEAP_MB = 4096;

const existing = process.env.NODE_OPTIONS || '';
const nodeOptions = /--max-old-space-size/.test(existing)
  ? existing
  : `${existing} --max-old-space-size=${HEAP_MB}`.trim();

const result = spawnSync(
  process.execPath,
  [resolveFrom.resolve('next/dist/bin/next'), ...process.argv.slice(2)],
  { stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: nodeOptions } },
);

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
process.exit(result.status === null ? 1 : result.status);
