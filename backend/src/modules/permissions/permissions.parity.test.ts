/**
 * Access parity: prove the migration did not change who can reach what.
 *
 * For every endpoint, compare the roles that could reach it BEFORE (frozen in
 * `pre-migration-access.json`) against the roles that can reach it NOW — resolved by running
 * the new guard against the seeded matrix.
 *
 *   LOST   — a role that had access and no longer does.
 *   GAINED — a role that did not have access and now does. The more dangerous direction.
 *
 * Both must be empty except for the entries in `INTENTIONAL` below.
 *
 * ## Why this test exists
 *
 * The first cut of the seed was written from `admin/utils/permissions.ts`, on the reasonable-
 * sounding theory that the frontend model was the tighter of the two. This check found **83
 * lost endpoints and 36 gained** — including a rider able to approve their own approval
 * requests, every role able to read the company-wide dashboard totals, and salesmen handed the
 * full dealer edit form when they should only have been able to correct a shop's pin.
 *
 * None of that would have been visible by reading the diff.
 *
 * Run with `npm run test:permissions:parity`.
 */
import * as fs from 'fs';
import * as path from 'path';
import * as assert from 'assert';

import { ROLE_SEEDS, BASELINE_PERMISSIONS } from '../../database/seeds/access-policies.seed';
import { ROLES } from '../../constants/global';

const MODULES_DIR = path.join(__dirname, '..');
const BASELINE_FILE = path.join(__dirname, 'pre-migration-access.json');

const NON_ADMIN_ROLES = Object.values(ROLES).filter((r) => r !== ROLES.ADMIN);

/**
 * Differences that are correct and deliberate. Everything else fails the test.
 *
 * Keyed `file|VERB|path`, listing the roles allowed to differ there and why. Adding an entry
 * is a decision worth reviewing; that is the point of making it explicit rather than adjusting
 * a threshold.
 */
const INTENTIONAL: Record<string, { roles: string[]; why: string }> = {
  // --- The requirement: "a Salesman takes orders but must not view all the products" ---
  //
  // `products:view` left BASELINE_PERMISSIONS, so these three roles lose the catalogue list and
  // detail endpoints. They are not losing the ability to work: the order and return forms read
  // GET /api/products/picker, gated on `orders:add` / `returns:add` and projected down to
  // barcode, name, sale price, quantity and category name.
  //
  // What they stop being able to read is the catalogue response itself — `lastPurchaseRate`
  // (what the company paid), `survivalQuantity`, and a populated `createdBy` user document
  // carrying the creator's salary, notes, home address and phone.
  'products_products.routes.ts|GET|/': {
    roles: ['order_taker', 'delivery_man', 'employee'],
    why: 'Requirement: field roles select products in a line item but do not browse the catalogue. They use GET /picker.',
  },
  'products_products.routes.ts|GET|/:id': {
    roles: ['order_taker', 'delivery_man', 'employee'],
    why: 'Requirement: no product detail page for field roles. Nothing in the order flow opens it.',
  },

  // --- The requirement: "Rider/Delivery Boy should also include Order Taker capability" ---
  'orders_orders.routes.ts|POST|/': {
    roles: ['delivery_man'],
    why: 'Requirement: a rider can take orders too.',
  },
  'orders_orders.routes.ts|GET|/': {
    roles: ['delivery_man'],
    why: 'Requirement: a rider can take orders too — they must see the orders they book.',
  },
  'orders_orders.routes.ts|GET|/:id': {
    roles: ['delivery_man'],
    why: 'Requirement: a rider can take orders too.',
  },
  'orders_orders.routes.ts|PUT|/:id': {
    roles: ['delivery_man'],
    why: 'Requirement: a rider can take orders too. The pending-only rule still applies in the service.',
  },

  // --- Collapses where one permission covers two endpoints on the same data ---
  'dealers_dealers.routes.ts|GET|/nearby': {
    roles: ['delivery_man'],
    why:
      'One `dealers:view` cell covers the list, the detail and the geo search. Riders already ' +
      'had the list and the detail, so the geo search exposes no record they could not read.',
  },
  'visits_visits.routes.ts|GET|/:id/skip-preview': {
    roles: ['sales_manager'],
    why:
      'One `visits:view` cell covers the list, the detail and the skip preview. Sales managers ' +
      'already read the visit; the preview adds no new record.',
  },

  // --- Deliberate tightenings: a collapsed cell forced a choice, and this is the safe side ---
  'approvals_approvals.routes.ts|GET|/:id': {
    roles: ['sales_manager', 'warehouse_manager', 'delivery_man', 'warehouse_staff', 'employee'],
    why:
      'TIGHTENED. This route had no guard at all — any authenticated user could read anyone ' +
      "else's leave request by guessing an id, while the list beside it was admin + salesman " +
      'only. One `approvals:view` cell now covers both and they cannot be seeded apart, so the ' +
      'restrictive side wins. Admin can grant the cell to any role that turns out to need it.',
  },
  'warehouse_warehouse.routes.ts|GET|/warehouses': {
    roles: ['sales_manager'],
    why:
      'TIGHTENED. `warehouse:view` now also covers `/stock/movements` and the last-purchase ' +
      'rate, which is what the company paid — the old guard on those excluded sales_manager. ' +
      'Granting the cell to keep the warehouse list would open a wider hole on cost. No UI ' +
      'ever called these for sales_manager, so nothing observable is lost.',
  },
  'warehouse_warehouse.routes.ts|GET|/warehouses/main': {
    roles: ['sales_manager'],
    why: 'TIGHTENED — see `GET /warehouses` above.',
  },
  'warehouse_warehouse.routes.ts|GET|/warehouses/:id': {
    roles: ['sales_manager'],
    why: 'TIGHTENED — see `GET /warehouses` above.',
  },
  'warehouse_warehouse.routes.ts|GET|/stock': {
    roles: ['sales_manager'],
    why: 'TIGHTENED — see `GET /warehouses` above.',
  },
  'warehouse_warehouse.routes.ts|GET|/stock/matrix': {
    roles: ['sales_manager'],
    why: 'TIGHTENED — see `GET /warehouses` above.',
  },
};

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
// What the seed grants
// ---------------------------------------------------------------------------

const grantedPerms = new Map<string, Set<string>>();
const grantedReports = new Map<string, Set<string>>();

for (const role of NON_ADMIN_ROLES) {
  const seed = ROLE_SEEDS[role];
  grantedPerms.set(role, new Set([...BASELINE_PERMISSIONS, ...(seed?.permissions ?? [])]));
  grantedReports.set(role, new Set(seed?.reports ?? []));
}

// ---------------------------------------------------------------------------
// What the routes require
// ---------------------------------------------------------------------------

interface Endpoint {
  verb: string;
  path: string;
  guard: { kind: string; cap?: string } | null;
}

/** Parse `router.<verb>( … )` calls, single-line and multi-line, with their guard. */
function endpoints(src: string): Endpoint[] {
  const out: Endpoint[] = [];
  const lines = src.split('\n');

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^router\.(get|post|put|patch|delete)\(\s*(?:'([^']*)')?/);
    if (!m) continue;

    let routePath: string | undefined = m[2];
    let guard: Endpoint['guard'] = null;

    for (let j = i; j < Math.min(i + 14, lines.length); j++) {
      const line = lines[j];
      if (!routePath) {
        const pm = line.match(/^\s*'([^']*)',/);
        if (pm) routePath = pm[1];
      }
      if (!guard) {
        let g = line.match(/requirePermission\('([^']+)'\)/);
        if (g) guard = { kind: 'permission', cap: g[1] };
        else if ((g = line.match(/requireReport\('([^']+)'\)/))) guard = { kind: 'report', cap: g[1] };
        else if ((g = line.match(/requireAnyReportOn\('([^']+)'\)/))) guard = { kind: 'anyReport', cap: g[1] };
        else if (/requireReportFrom\(/.test(line)) guard = { kind: 'reportFrom' };
        else if (/requireAdmin\(\)/.test(line)) guard = { kind: 'admin' };
      }
      if (j > i && /^\s*\);/.test(line)) break;
      if (/\);\s*$/.test(line)) break;
    }

    out.push({ verb: m[1], path: routePath ?? '?', guard });
  }
  return out;
}

/** Which non-admin roles satisfy this guard, given the seed. */
function rolesAllowedNow(guard: Endpoint['guard'], file: string): string[] {
  if (!guard) return [...NON_ADMIN_ROLES]; // still unguarded: any authenticated user
  if (guard.kind === 'admin') return [];

  if (guard.kind === 'permission') {
    return NON_ADMIN_ROLES.filter((r) => grantedPerms.get(r)!.has(guard.cap!));
  }
  if (guard.kind === 'report') {
    return NON_ADMIN_ROLES.filter((r) => grantedReports.get(r)!.has(guard.cap!));
  }
  if (guard.kind === 'anyReport') {
    return NON_ADMIN_ROLES.filter((r) =>
      [...grantedReports.get(r)!].some((id) => id.startsWith(guard.cap!)),
    );
  }
  // `reportFrom` builds the id from the request; approximate with the surface it serves.
  const prefix = file.includes('analytics') ? 'analytics.' : 'reports.';
  return NON_ADMIN_ROLES.filter((r) =>
    [...grantedReports.get(r)!].some((id) => id.startsWith(prefix)),
  );
}

// ---------------------------------------------------------------------------
// Compare
// ---------------------------------------------------------------------------

const baseline = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8')) as {
  endpoints: number;
  routes: Record<string, Array<{ index: number; verb: string; path: string; roles: string[] }>>;
};

const lost: string[] = [];
const gained: string[] = [];
const unmatched: string[] = [];
let compared = 0;

for (const [file, oldEps] of Object.entries(baseline.routes)) {
  // `orders_orders.routes.ts` -> `orders/orders.routes.ts`
  const sep = file.indexOf('_');
  const full = path.join(MODULES_DIR, file.slice(0, sep), file.slice(sep + 1));

  if (!fs.existsSync(full)) {
    unmatched.push(`${file}: route file no longer exists`);
    continue;
  }

  const newEps = endpoints(fs.readFileSync(full, 'utf8'));

  for (const o of oldEps) {
    // Match on verb + path, with the frozen index only as a tie-break for a file that declares
    // the same verb and path twice.
    //
    // This used to be `newEps[o.index]` alone, which read a legitimately INSERTED route as four
    // endpoints having vanished: adding `GET /picker` above `GET /:id` (it has to be above, or
    // Express matches "picker" as an id) shifted every later index by one, and the frozen #3–#6
    // came back unmatched while the access they carry had not moved at all.
    //
    // A genuinely removed or renamed endpoint still fails, which is what this check is for.
    const sameSignature = newEps.filter((n) => n.verb === o.verb && n.path === o.path);
    const n = sameSignature.length > 1
      ? (newEps[o.index]?.verb === o.verb && newEps[o.index]?.path === o.path
          ? newEps[o.index]
          : sameSignature[0])
      : sameSignature[0];

    if (!n) {
      unmatched.push(`${file} #${o.index} ${o.verb.toUpperCase()} ${o.path}: no matching endpoint now`);
      continue;
    }

    compared++;
    const key = `${file}|${o.verb.toUpperCase()}|${o.path}`;
    const exempt = new Set(INTENTIONAL[key]?.roles ?? []);
    const now = rolesAllowedNow(n.guard, file);
    const before = o.roles.filter((r) => r !== 'admin');

    for (const role of before) {
      if (!now.includes(role) && !exempt.has(role)) {
        lost.push(`${key}  LOST   ${role}  (now: ${n.guard?.cap ?? n.guard?.kind ?? 'unguarded'})`);
      }
    }
    for (const role of now) {
      if (!before.includes(role) && !exempt.has(role)) {
        gained.push(`${key}  GAINED ${role}  (now: ${n.guard?.cap ?? n.guard?.kind ?? 'unguarded'})`);
      }
    }
  }
}

// ---------------------------------------------------------------------------

check('the frozen baseline was read', () => {
  assert.ok(compared > 200, `only compared ${compared} endpoints — the fixture or the parser is wrong`);
});

check('no role GAINED access it did not have before', () => {
  assert.deepStrictEqual(
    gained,
    [],
    `\n       ${gained.join('\n       ')}\n\n       ` +
      'A silent privilege grant. Either tighten the guard, remove the grant from the seed, ' +
      'or add it to INTENTIONAL with a reason.',
  );
});

check('no role LOST access it had before', () => {
  assert.deepStrictEqual(
    lost,
    [],
    `\n       ${lost.join('\n       ')}\n\n       ` +
      'A regression. Add the permission to that role in access-policies.seed.ts, or add it ' +
      'to INTENTIONAL with a reason.',
  );
});

check('every frozen endpoint still has a counterpart', () => {
  assert.deepStrictEqual(unmatched, [], `\n       ${unmatched.join('\n       ')}`);
});

console.log(
  `\n  ${compared} endpoints compared against the pre-migration baseline, ` +
    `${Object.keys(INTENTIONAL).length} deliberate differences allowed`,
);

if (failures > 0) {
  console.error(`\n  ${failures} check(s) failed\n`);
  process.exit(1);
}
console.log('\n  access parity holds\n');
