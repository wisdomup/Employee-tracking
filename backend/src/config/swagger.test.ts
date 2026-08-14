/**
 * Guard: every annotated route file is actually registered with swagger-jsdoc.
 *
 * `swagger.ts` uses an explicit ALLOWLIST of files, not a glob. A module left out of it is
 * invisible in /api/docs no matter how carefully its routes are annotated, nothing fails, and
 * nothing warns — the annotations just silently do nothing. Seven modules had accumulated 52
 * undocumented endpoints between them before anyone noticed, including the entire warehouse
 * module, which is the most heavily annotated one in the codebase.
 *
 * This test makes that failure loud. If you add a route file with an `@openapi` block, add it to
 * BOTH lists in `swagger.ts` (the `.ts` entry and the `.js` entry for the built app).
 *
 * Run with: npm run test:swagger
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { swaggerSpec } from './swagger';

let passed = 0;
function test(name: string, fn: () => void): void {
  fn();
  passed += 1;
  // eslint-disable-next-line no-console
  console.log(`  ✓ ${name}`);
}

const MODULES_DIR = path.join(__dirname, '..', 'modules');
const SWAGGER_SOURCE = fs.readFileSync(path.join(__dirname, 'swagger.ts'), 'utf8');

/** Every `*.routes.ts` / `*.router.ts` that carries at least one `@openapi` block. */
function annotatedRouteFiles(): { relative: string; blocks: number }[] {
  const out: { relative: string; blocks: number }[] = [];

  for (const moduleName of fs.readdirSync(MODULES_DIR)) {
    const moduleDir = path.join(MODULES_DIR, moduleName);
    if (!fs.statSync(moduleDir).isDirectory()) continue;

    for (const file of fs.readdirSync(moduleDir)) {
      if (!/\.(routes|router)\.ts$/.test(file)) continue;
      const source = fs.readFileSync(path.join(moduleDir, file), 'utf8');
      const blocks = source.split('@openapi').length - 1;
      if (blocks > 0) out.push({ relative: `modules/${moduleName}/${file}`, blocks });
    }
  }

  return out.sort((a, b) => b.blocks - a.blocks);
}

// ---------------------------------------------------------------------------
console.log('Swagger registration');
// ---------------------------------------------------------------------------

test('every annotated route file is in the allowlist, for both .ts and .js', () => {
  const missing: string[] = [];

  for (const { relative, blocks } of annotatedRouteFiles()) {
    const jsVariant = relative.replace(/\.ts$/, '.js');
    if (!SWAGGER_SOURCE.includes(relative)) {
      missing.push(`${relative} (${blocks} annotated endpoint(s)) — missing the .ts entry`);
    } else if (!SWAGGER_SOURCE.includes(jsVariant)) {
      missing.push(`${relative} — has the .ts entry but not the .js one, so docs vanish in prod`);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `These route files are annotated but never scanned, so their docs do not exist:\n  ${missing.join('\n  ')}`,
  );
});

test('the generated spec is not obviously truncated', () => {
  const paths = Object.keys((swaggerSpec as { paths?: Record<string, unknown> }).paths ?? {});
  // A floor, not an exact count — this fails when a whole module drops out, without needing an
  // update every time a single endpoint is added.
  assert.ok(
    paths.length >= 100,
    `expected at least 100 documented endpoints, found ${paths.length} — did a module stop being scanned?`,
  );
});

test('the modules most likely to be forgotten are present', () => {
  const paths = Object.keys((swaggerSpec as { paths?: Record<string, unknown> }).paths ?? {});
  // One representative endpoint per module that was undocumented at some point.
  for (const expected of [
    '/api/warehouse/stock/matrix',
    '/api/warehouse/stock/adjust',
    '/api/warehouse/opening-stock/matrix',
    '/api/collections/my/orders',
    '/api/attendance',
    '/api/analytics/performance',
    '/api/region-sales/regions',
    '/api/stock-reports/current',
  ]) {
    assert.ok(paths.includes(expected), `${expected} is missing from the API docs`);
  }
});

test('every documented path carries at least one HTTP method', () => {
  const spec = swaggerSpec as { paths?: Record<string, Record<string, unknown>> };
  const empty = Object.entries(spec.paths ?? {})
    .filter(([, methods]) => Object.keys(methods).length === 0)
    .map(([p]) => p);
  assert.deepEqual(empty, [], 'a path with no methods means a malformed @openapi block');
});

// eslint-disable-next-line no-console
console.log(`\nAll ${passed} swagger registration tests passed.`);
