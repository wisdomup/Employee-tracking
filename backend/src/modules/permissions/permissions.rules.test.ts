/**
 * Static checks over the permission catalogue, the seed, and every route guard in the tree.
 *
 * No database and no server — this reads source files. That is the point: the failure it
 * catches is a guard naming a permission the catalogue does not have, which at runtime looks
 * like "a role mysteriously lost a screen" rather than like the typo it is.
 *
 * Run with `npm run test:permissions`.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';

import {
  ALL_ACTIONS,
  MODULES,
  REPORTS,
  allPermissionKeys,
  allReportIds,
  isValidPermission,
  isValidReport,
  parsePermissionKey,
} from '../../constants/permissions';
import { ROLE_SEEDS, validateSeed } from '../../database/seeds/access-policies.seed';
import { ROLES } from '../../constants/global';

let failures = 0;
function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  ok   ${name}`);
  } catch (err) {
    failures += 1;
    console.error(`  FAIL ${name}`);
    console.error(`       ${(err as Error).message}`);
  }
}

// ---------------------------------------------------------------------------
// Catalogue integrity
// ---------------------------------------------------------------------------

check('module ids are unique', () => {
  const ids = MODULES.map((m) => m.id);
  assert.strictEqual(new Set(ids).size, ids.length, `duplicate module id in ${ids.join(', ')}`);
});

check('report ids are unique', () => {
  const ids = REPORTS.map((r) => r.id);
  assert.strictEqual(new Set(ids).size, ids.length, 'duplicate report id');
});

check('every module declares at least view', () => {
  for (const m of MODULES) {
    assert.ok(m.actions.includes('view'), `${m.id} does not declare "view"`);
  }
});

check('every module declaring change explains what it means', () => {
  for (const m of MODULES) {
    if (m.actions.includes('change')) {
      assert.ok(
        m.changeMeans && m.changeMeans.length > 0,
        `${m.id} allows "change" but has no changeMeans help text`,
      );
    }
  }
});

check('modules declare only known actions', () => {
  for (const m of MODULES) {
    for (const a of m.actions) {
      assert.ok(ALL_ACTIONS.includes(a), `${m.id} declares unknown action "${a}"`);
    }
  }
});

check('isValidPermission rejects an action the module does not declare', () => {
  // Dashboard is view-only by design; if this ever passes, the n/a map has drifted.
  assert.strictEqual(isValidPermission('dashboard:delete'), false);
  assert.strictEqual(isValidPermission('dashboard:view'), true);
  assert.strictEqual(isValidPermission('nope:view'), false);
  assert.strictEqual(parsePermissionKey('orders'), null);
});

// ---------------------------------------------------------------------------
// Drill-down metrics must match the catalogue exactly
// ---------------------------------------------------------------------------

/**
 * `requireReportFrom` builds the report id straight from the `metric` query parameter, so a
 * metric the catalogue does not list is a report only Admin can ever open — and the person who
 * added the metric would have no reason to suspect the permission layer.
 *
 * This is not hypothetical: the first cut of the catalogue carried 12 analytics metrics when
 * the endpoint accepted 24, which would have silently hidden half the drill-downs.
 */
function assertMetricsMatch(prefix: string, endpointMetrics: readonly string[]): void {
  const inCatalogue = new Set(
    REPORTS.filter((r) => r.id.startsWith(prefix)).map((r) => r.id.slice(prefix.length)),
  );

  const missing = endpointMetrics.filter((m) => !inCatalogue.has(m));
  const extra = [...inCatalogue].filter((m) => !endpointMetrics.includes(m));

  assert.deepStrictEqual(
    missing,
    [],
    `metrics the endpoint accepts but the catalogue lacks (nobody but admin could open these): ${missing.join(', ')}`,
  );
  assert.deepStrictEqual(
    extra,
    [],
    `catalogue entries with no matching endpoint metric (dead checkboxes): ${extra.join(', ')}`,
  );
}

check('analytics drill-down metrics match the catalogue', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { PERFORMANCE_DETAIL_METRICS } = require('../analytics/performance-detail.service');
  assertMetricsMatch('analytics.', PERFORMANCE_DETAIL_METRICS);
});

check('dashboard report metrics match the catalogue', () => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { REPORT_DETAIL_METRICS } = require('../dashboard/report-detail.service');
  assertMetricsMatch('reports.', REPORT_DETAIL_METRICS);
});

// ---------------------------------------------------------------------------
// Seed integrity
// ---------------------------------------------------------------------------

check('seed references only real modules, actions and reports', () => {
  const problems = validateSeed();
  assert.deepStrictEqual(problems, [], `\n       ${problems.join('\n       ')}`);
});

check('admin has no seeded policy', () => {
  assert.ok(
    !(ROLES.ADMIN in ROLE_SEEDS),
    'admin must not have a policy — the resolver short-circuits before reading one, and a ' +
      'stored admin policy would imply the super-admin is editable',
  );
});

check('every non-admin role is seeded', () => {
  const expected = Object.values(ROLES).filter((r) => r !== ROLES.ADMIN);
  for (const role of expected) {
    assert.ok(role in ROLE_SEEDS, `role "${role}" has no seed — its users would resolve to nothing`);
  }
});

check('no role is seeded an approval it cannot reach', () => {
  // Transfers, damage and stock counts keep `requireAdmin()` on approve. Seeding a role the
  // matching `change` grant is fine (it covers receive/submit/cancel), but seeding it to a
  // role the routes never let near the module would be dead configuration.
  for (const [role, seed] of Object.entries(ROLE_SEEDS)) {
    for (const key of seed.permissions) {
      const parsed = parsePermissionKey(key);
      assert.ok(parsed, `${role}: "${key}" does not parse`);
    }
  }
});

// ---------------------------------------------------------------------------
// Route guards — the check that matters
// ---------------------------------------------------------------------------

function routeFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) routeFiles(full, acc);
    else if (/\.(routes|router)\.ts$/.test(entry.name)) acc.push(full);
  }
  return acc;
}

const MODULES_DIR = path.join(__dirname, '..');
const files = routeFiles(MODULES_DIR);

check('route files were found', () => {
  assert.ok(files.length > 20, `only found ${files.length} route files — the glob is wrong`);
});

check('no route still uses the old requireRoles guard', () => {
  const stragglers: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const [i, line] of src.split('\n').entries()) {
      // Skip doc comments, which legitimately mention the old name while explaining history.
      if (/^\s*\*/.test(line)) continue;
      if (line.includes('requireRoles(')) {
        stragglers.push(`${path.relative(MODULES_DIR, f)}:${i + 1}`);
      }
    }
  }
  assert.deepStrictEqual(stragglers, [], `\n       ${stragglers.join('\n       ')}`);
});

check('every requirePermission key exists in the catalogue', () => {
  const bad: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/requirePermission\('([^']+)'\)/g)) {
      if (!isValidPermission(m[1])) {
        bad.push(`${path.relative(MODULES_DIR, f)}: "${m[1]}"`);
      }
    }
  }
  assert.deepStrictEqual(bad, [], `\n       ${bad.join('\n       ')}`);
});

check('every requireReport id exists in the catalogue', () => {
  const bad: string[] = [];
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/requireReport\('([^']+)'\)/g)) {
      if (!isValidReport(m[1])) {
        bad.push(`${path.relative(MODULES_DIR, f)}: "${m[1]}"`);
      }
    }
  }
  assert.deepStrictEqual(bad, [], `\n       ${bad.join('\n       ')}`);
});

// ---------------------------------------------------------------------------
// The admin panel's legacy vocabulary
// ---------------------------------------------------------------------------

/**
 * `admin/utils/permissions.ts` translates the old permission names the UI still uses
 * (`orders:edit-pending`, `stock:adjust`, …) into the new `module:action` keys.
 *
 * A mapping that points at a key the catalogue does not have fails silently and permanently:
 * `can()` returns false for everyone but Admin, and the feature simply never appears. Nothing
 * throws, nothing logs. So the map is checked here, from the side that owns the catalogue.
 */
const ADMIN_DIR = path.resolve(__dirname, '../../../../admin');
const ADMIN_PERMISSIONS = path.join(ADMIN_DIR, 'utils/permissions.ts');

const adminPermsExists = fs.existsSync(ADMIN_PERMISSIONS);

check('the admin permission util was found', () => {
  assert.ok(adminPermsExists, `expected ${ADMIN_PERMISSIONS} — adjust the path if admin/ moved`);
});

if (adminPermsExists) {
  const src = fs.readFileSync(ADMIN_PERMISSIONS, 'utf8');

  const mapBlock = src.slice(
    src.indexOf('const LEGACY_KEYS'),
    src.indexOf('};', src.indexOf('const LEGACY_KEYS')),
  );
  const mappings = [...mapBlock.matchAll(/'([^']+)':\s*(ADMIN|'([^']+)')/g)].map((m) => ({
    from: m[1],
    to: m[3] ?? 'ADMIN',
  }));

  check('the legacy key map has entries', () => {
    assert.ok(mappings.length > 20, `only parsed ${mappings.length} mappings — the parser drifted`);
  });

  check('every legacy mapping points at something real', () => {
    const bad: string[] = [];
    for (const { from, to } of mappings) {
      if (to === 'ADMIN') continue;
      if (to.startsWith('report*:')) {
        const prefix = to.slice(8);
        if (!REPORTS.some((r) => r.id.startsWith(prefix))) {
          bad.push(`"${from}" -> "${to}" (no report starts with "${prefix}")`);
        }
      } else if (to.startsWith('report:')) {
        if (!isValidReport(to.slice(7))) bad.push(`"${from}" -> "${to}" (unknown report)`);
      } else if (!isValidPermission(to)) {
        bad.push(`"${from}" -> "${to}" (unknown permission)`);
      }
    }
    assert.deepStrictEqual(bad, [], `\n       ${bad.join('\n       ')}`);
  });

  check('every permission key the admin UI checks resolves', () => {
    const known = new Set(mappings.map((m) => m.from));
    const used = new Set<string>();

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '.next') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (/\.tsx?$/.test(entry.name)) {
          const text = fs.readFileSync(full, 'utf8');
          for (const m of text.matchAll(/\bcan\(\s*[^,)]+,\s*'([^']+)'\s*\)/g)) used.add(m[1]);
          for (const m of text.matchAll(/permission:\s*'([^']+)'/g)) used.add(m[1]);
        }
      }
    };
    for (const sub of ['pages', 'components', 'hooks', 'utils']) {
      const d = path.join(ADMIN_DIR, sub);
      if (fs.existsSync(d)) walk(d);
    }

    // A key is fine if it is already a valid new-style key, or the map translates it.
    const orphans = [...used].filter((k) => !isValidPermission(k) && !known.has(k)).sort();
    assert.deepStrictEqual(
      orphans,
      [],
      `\n       these keys are checked in the UI but match no catalogue entry and no legacy ` +
        `mapping, so they are permanently false for every non-admin:\n       ${orphans.join('\n       ')}`,
    );
  });
}

/**
 * Pages allowed to keep a hardcoded `allowedRoles={['admin']}` gate.
 *
 * Every one of these calls a backend route guarded by `requireAdmin()`, so a permission gate
 * would promise something the API then refuses. Anything else with a hardcoded role list is a
 * page the matrix cannot actually control — tick the permission, and the page still bounces.
 */
const ADMIN_ONLY_PAGES = [
  'attendance/create.tsx',
  'settings/permissions.tsx',
  'warehouse/opening-stock/index.tsx',
  'warehouse/warehouses/create.tsx',
  'warehouse/warehouses/[id]/edit.tsx',
  'warehouse/stock-in/[id]/edit.tsx',
];

if (adminPermsExists) {
  check('no page gates on a hardcoded role list instead of a permission', () => {
    const pagesDir = path.join(ADMIN_DIR, 'pages');
    const offenders: string[] = [];

    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.tsx')) continue;

        const text = fs.readFileSync(full, 'utf8');
        if (!/allowedRoles=\{\[/.test(text)) continue;

        const rel = path.relative(pagesDir, full).split(path.sep).join('/');
        if (ADMIN_ONLY_PAGES.includes(rel)) continue;

        offenders.push(rel);
      }
    };
    walk(pagesDir);

    assert.deepStrictEqual(
      offenders,
      [],
      `\n       these pages still gate on a role list, so the matrix cannot open them:\n       ` +
        `${offenders.join('\n       ')}\n\n       ` +
        'Use `permission="module:action"` (or `reportPrefix`), or add the page to ' +
        'ADMIN_ONLY_PAGES if its backend route is genuinely requireAdmin().',
    );
  });
}

check('every gated module is actually reachable from some route', () => {
  // A module in the catalogue that no guard names is a row of checkboxes that does nothing.
  const used = new Set<string>();
  for (const f of files) {
    const src = fs.readFileSync(f, 'utf8');
    for (const m of src.matchAll(/requirePermission\('([^']+)'\)/g)) {
      const parsed = parsePermissionKey(m[1]);
      if (parsed) used.add(parsed.moduleId);
    }
  }
  // `settings` has no backend routes yet — it gates admin-panel screens only.
  const exempt = new Set(['settings']);
  const orphans = MODULES.filter((m) => !used.has(m.id) && !exempt.has(m.id)).map((m) => m.id);
  assert.deepStrictEqual(orphans, [], `modules with no route guard: ${orphans.join(', ')}`);
});

// ---------------------------------------------------------------------------

console.log(
  `\n  ${MODULES.length} modules, ${allPermissionKeys().length} permission cells, ` +
    `${allReportIds().length} reports, ${files.length} route files scanned`,
);

if (failures > 0) {
  console.error(`\n  ${failures} check(s) failed\n`);
  process.exit(1);
}
console.log('\n  all permission checks passed\n');
