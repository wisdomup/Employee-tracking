import { AccessPolicyModel, IModuleGrant } from '../../models/access-policy.model';
import { UserModel } from '../../models/user.model';
import { ROLES } from '../../constants/global';
import {
  Action,
  ALL_ACTIONS,
  isValidPermission,
  MODULES,
  REPORTS,
  REPORT_SURFACES,
} from '../../constants/permissions';
import { invalidateAccessCache } from '../../services/access-control.service';

/**
 * Seeds the permission matrix with **exactly what each role could do before this change**.
 *
 * This is the single most important property of the migration. The matrix ships pre-filled to
 * mirror the hardcoded guards it replaces, so the deploy changes nobody's access and any later
 * difference is a bug with a known-good baseline to diff against — rather than 223 rewritten
 * guards and no way to tell a regression from an intended change.
 *
 * ## Where these lists come from
 *
 * They are **derived from the old backend `requireRoles(...)` lists**, endpoint by endpoint,
 * not transcribed from `admin/utils/permissions.ts`.
 *
 * The first cut of this file was written from the frontend's permission Sets, on the reasoning
 * that the frontend is the tighter of the two and is what users actually experience. An
 * automated parity check against git HEAD then found **83 endpoints where a role lost access
 * and 36 where one gained it** — the two models disagreed far more than expected. Access is
 * decided by the backend guard, so the backend guard is what this mirrors.
 *
 * Anything the frontend granted but the backend refused is deliberately NOT seeded: those were
 * buttons that rendered and returned 403. The matrix cell exists, so an admin can now grant
 * them on purpose, which will be the first time that decision has ever been made deliberately.
 *
 * Re-running is safe: existing policies are skipped unless `--force`, so an admin's hand-tuned
 * matrix is never overwritten by a redeploy.
 */

const reportsOn = (surface: string): string[] =>
  REPORTS.filter((r) => r.surface === surface).map((r) => r.id);

/**
 * Every role could reach `/api/analytics/*` before — the old guard was `ANY_STAFF`. Row-level
 * scoping is a separate concern and still lives in the analytics service: admin sees everyone,
 * a sales_manager sees their own reports, everyone else sees only themselves.
 */
const ANALYTICS_REPORTS = reportsOn(REPORT_SURFACES.PERFORMANCE);

/**
 * All six warehouse report tabs, matching the old frontend `warehouse-reports:view` grant.
 *
 * Deriving these from the backend alone under-grants: only the valuation and low-stock
 * endpoints carried a report guard, while the Movement, Transfers, Damage and Count tabs read
 * operational endpoints. Seeding only the two would silently remove four tabs these roles use.
 */
const WAREHOUSE_REPORTS = reportsOn(REPORT_SURFACES.WAREHOUSE);

interface RoleSeed {
  permissions: string[];
  reports: string[];
  note: string;
}

/**
 * Granted to every non-admin role.
 *
 * `GET /products`, `/categories`, `/catalogs`, the attendance check-in/out/note routes, the
 * approvals create/read/update routes and the task start/complete routes had **no role guard
 * at all** — any authenticated user could reach them. Putting a permission in front without
 * seeding it everywhere would revoke access on deploy, which is the one direction this must
 * not move in.
 *
 * Admin can untick any of them afterwards. The point is only that the starting state matches.
 */
const BASELINE_PERMISSIONS = [
  'dashboard:view',
  /*
   * `products:view` is NOT baseline any more.
   *
   * The requirement: a Salesman takes orders but must not browse the product catalogue. As
   * baseline it was granted to every role, so the /products screen and the catalogue API stayed
   * open to them however the matrix was ticked — and that response carries what the company PAID
   * (`lastPurchaseRate`), the low-stock level, and a populated `createdBy` user document with the
   * creator's salary, notes, home address and phone.
   *
   * Selecting a product while booking an order does NOT need it: that reads
   * GET /api/products/picker, which is gated on being able to write the document it feeds
   * (`orders:add` and friends) and returns barcode, name, sale price, quantity and the category
   * name only.
   *
   * The roles whose screens genuinely browse products keep the cell explicitly below —
   * sales_manager, and both warehouse roles, whose stock-in, transfer, damage and opening-stock
   * forms load the full product list. Recorded in the parity test's INTENTIONAL list for
   * order_taker, delivery_man and employee.
   */
  'categories:view',
  'catalogs:view',
  'attendance:view',
  'attendance:add',
  // The note-only patch. Which fields a non-admin may actually change is still decided by the
  // per-role validator on that route, so this does not hand anyone the admin's edit form.
  'attendance:edit',
  'approvals:add',
  'approvals:edit',
  /*
   * `approvals:view` is NOT baseline, on purpose.
   *
   * `GET /approvals` was `requireRoles('admin', 'order_taker')`, but `GET /approvals/:id` had
   * no guard at all — any authenticated user could read anyone's leave request by guessing an
   * id. One `approvals:view` cell now covers both, and the two cannot be seeded differently.
   *
   * Choosing the restrictive side closes the hole rather than widening it into a deliberate
   * grant. The cost is that the five roles who could read a single approval by id no longer
   * can — recorded in the parity test's INTENTIONAL list.
   */
  // Task start / complete. `tasks:view` is NOT baseline — the task list had a real guard.
  'tasks:change',
];

/**
 * `admin` is absent on purpose — the resolver short-circuits on it and never reads a policy,
 * so the super-admin cannot be edited into a lockout.
 */
const ROLE_SEEDS: Record<string, RoleSeed> = {
  // -------------------------------------------------------------------------
  [ROLES.SALES_MANAGER]: {
    note: 'Read across their team, target setting, and the performance-flag queue.',
    permissions: [
      // Held explicitly now that `products:view` is no longer baseline: a manager reviews the
      // catalogue and its prices.
      'products:view',
      // Managers may download the lists they can already read. Not baseline: a Salesman with
      // an export button can walk out with the client book.
      'exports:view',
      'dealers:view',
      'employees:view',
      'orders:view',
      'visits:view',
      // The flag queue: they raise and clear flags on their own reports.
      'performance-flags:view',
      'performance-flags:change',
      'targets:view',
      'targets:add',
      'targets:delete',
      /*
       * `warehouse:view` is deliberately NOT seeded, even though the old `STOCK_READERS`
       * guard let sales_manager read `/warehouses` and `/stock`.
       *
       * One `warehouse:view` cell now covers the whole module, including
       * `/stock/movements` and `/products/:id/last-purchase-rate` — and the last purchase
       * rate is what the company PAID. The old guard on those two was `WAREHOUSE_VIEWERS`,
       * which excluded sales_manager. Granting the cell to close a gap on the warehouse
       * list would open a wider one on cost.
       *
       * Nothing observable is lost: the admin panel's permission Sets never gave
       * sales_manager a warehouse screen, so no UI ever called those endpoints for them.
       */
      // NOT seeded, though the admin panel's old Sets granted them: activity-logs:view,
      // returns:view, routes:view, tasks:view, approvals beyond baseline. Every one of those
      // backend routes excluded sales_manager, so the links 403 today.
    ],
    reports: [...ANALYTICS_REPORTS, 'region-sales.daily'],
  },

  // -------------------------------------------------------------------------
  [ROLES.WAREHOUSE_MANAGER]: {
    note: 'Warehouse operations company-wide, plus the task list and visit status routes.',
    permissions: [
      // Same reason as warehouse_staff: every stock document form loads the product list.
      'products:view',
      // A manager, so the same export grant as sales_manager — stock and document lists.
      // Deliberately NOT given to warehouse_staff, who raise documents but do not report on them.
      'exports:view',
      'warehouse:view',
      'stock-in:view',
      'stock-in:add',
      'transfers:view',
      'transfers:add',
      // Receive. Approve / reject / resolve / cancel keep `requireAdmin()` on the route —
      // under the five-action model they would all be this same tick.
      'transfers:change',
      'damage:view',
      'damage:add',
      'stock-count:view',
      'stock-count:add',
      'stock-count:edit',
      'stock-count:change',
      'tasks:view',
      'targets:view',
      'performance-flags:view',
      // Guard sprawl, preserved rather than quietly removed: the old visit routes permitted
      // warehouse_manager on check-in, complete, skip and gallery, though no UI ever exposed
      // it. Dropping it here would be a silent behaviour change smuggled into a migration
      // whose whole promise is that nothing changes. Untick it in the matrix instead.
      'visits:view',
      'visits:change',
      'visits:edit',
      // NOT seeded, though the old frontend Sets granted them: orders:view, employees:view,
      // stock-in:change (cancel), damage:change (cancel). Those routes were admin-only.
    ],
    reports: [...ANALYTICS_REPORTS, ...WAREHOUSE_REPORTS],
  },

  // -------------------------------------------------------------------------
  [ROLES.ORDER_TAKER]: {
    note: 'Salesman: route visits, geofenced check-in/out, and booking orders in the shop.',
    permissions: [
      'activity-logs:view',
      'dealers:view',
      'dealers:add',
      // The pin fix only — correcting where the shop actually is. The full dealer edit form
      // (phone, category, route, status) is `dealers:edit` and stays with the admin.
      'dealers:change',
      'routes:view',
      'tasks:view',
      // `orders:edit` maps the old `orders:edit-pending`. The pending-only rule still runs in
      // the order service; the matrix only says they may edit orders at all.
      'orders:view',
      'orders:add',
      'orders:edit',
      'approvals:view',
      'approvals:delete',
      'returns:view',
      'returns:add',
      'returns:edit',
      'returns:delete',
      // Check-in, complete, skip. The geofence, the photo requirement and the "must be
      // checked_in first" rule are all untouched by this.
      'visits:view',
      'visits:change',
      'visits:edit',
      'targets:view',
      'performance-flags:view',
    ],
    reports: ANALYTICS_REPORTS,
  },

  // -------------------------------------------------------------------------
  [ROLES.DELIVERY_MAN]: {
    note: 'Rider: delivery, cash collection, recovery, settlement — plus order-taking.',
    permissions: [
      'dealers:view',
      'dealers:change',
      'tasks:view',
      'targets:view',
      'performance-flags:view',
      'visits:view',
      'visits:change',
      'visits:edit',
      // Deliver, recover, settle. `collections:change` covers mark-packed and settle; void
      // and correct stay `requireAdmin()` on the route, because a rider correcting their own
      // cash record defeats the point of the record.
      'collections:view',
      'collections:add',
      'collections:change',

      // --- THE ONE DELIBERATE GRANT: "a rider can take orders too" ---
      // Everything else in this file preserves existing access exactly. These three are new.
      //
      // Deliberately the order-booking subset, NOT the salesman's visit flow: no extra visit
      // permissions beyond what riders already had, so they are not running geofenced route
      // visits and are not swept by the late-start freeze. Widen this if riders are meant to
      // run routes as well.
      'orders:view',
      'orders:add',
      'orders:edit',
    ],
    reports: [...ANALYTICS_REPORTS, 'collection.activity', 'collection.day-end'],
  },

  // -------------------------------------------------------------------------
  [ROLES.WAREHOUSE_STAFF]: {
    note: 'Day-to-day stock work at one warehouse. Raises documents, never approves them.',
    permissions: [
      // The stock-in, transfer, damage and opening-stock forms each load the full product list.
      'products:view',
      'warehouse:view',
      'stock-in:view',
      'stock-in:add',
      'transfers:view',
      'transfers:add',
      'transfers:change',
      'damage:view',
      'damage:add',
      'stock-count:view',
      'stock-count:add',
      'stock-count:edit',
      'stock-count:change',
      'performance-flags:view',
      // NOT seeded, though the old frontend Sets granted it: tasks:view. The task list route
      // excluded warehouse_staff. They keep `tasks:change` from the baseline, because the
      // start/complete routes were unguarded.
    ],
    reports: [...ANALYTICS_REPORTS, ...WAREHOUSE_REPORTS],
  },

  // -------------------------------------------------------------------------
  [ROLES.EMPLOYEE]: {
    /*
     * The legacy generic role — hidden from the roles picker, but seeded with everything it
     * can reach today rather than with nothing.
     *
     * "Zero-permission default" governs what NEW self-registrations receive, and that still
     * holds: nobody new is assigned this role, and the public register endpoint hands out an
     * account with no admin-panel screens beyond the baseline. But the accounts already
     * sitting on `employee` must keep working, and the old backend guards let them reach 35
     * endpoints across dealers, orders, routes, visits and tasks. Seeding it empty would have
     * broken every one of them on deploy.
     */
    note: 'Legacy generic role. Hidden from the picker; kept working for existing accounts.',
    permissions: [
      'activity-logs:view',
      'dealers:view',
      'dealers:add',
      'dealers:edit',
      'dealers:change',
      'employees:view',
      'orders:view',
      'orders:add',
      'orders:edit',
      'returns:view',
      'returns:add',
      'route-assignments:view',
      'routes:view',
      'routes:add',
      'routes:edit',
      'targets:view',
      'tasks:view',
      'tasks:add',
      'tasks:edit',
      'visits:view',
      'visits:add',
      'visits:change',
      'visits:edit',
      'performance-flags:view',
    ],
    reports: ANALYTICS_REPORTS,
  },

  // -------------------------------------------------------------------------
  /*
   * The two accounting roles, seeded with the baseline and NOTHING else.
   *
   * They exist from this commit so accounts can be created and the seed stays complete
   * (`permissions.flow.test.ts` asserts one policy per non-admin role), but the finance module
   * they are named for does not exist yet. Every finance cell is granted in the step that
   * builds the screens behind it, so a role is never carrying a permission to reach something
   * unbuilt.
   *
   * Baseline is added by `buildGrants` and is deliberately not suppressed: an accountant still
   * needs the dashboard, their own attendance and the ability to file a leave request, exactly
   * like every other non-admin.
   */
  [ROLES.ACCOUNTANT]: {
    note: 'Enters and posts the daily work. Cannot reverse it, and cannot close the month.',
    permissions: [
      // Read-only on the chart of accounts. An accountant works INSIDE the chart every day and
      // cannot do so without seeing it, but restructuring it is a decision with reporting
      // consequences that outlive whoever made it — that stays with the Finance Manager.
      'finance-coa:view',

      // The full day job: write, correct and post their own entries.
      'finance-journal:view',
      'finance-journal:add',
      'finance-journal:edit',
      'finance-journal:delete',
      'finance-journal:change',

      /*
       * `finance-reversal:change` is deliberately ABSENT, and this is the whole reason reversal
       * has its own matrix row.
       *
       * Whoever records the work should not also be able to undo it — the oldest control in
       * accounting. Under a single `finance-journal` row, "post" and "reverse" would both be
       * `change` and this separation would be inexpressible.
       */
      'finance-reversal:view',

      // Sees which months are open, so they know where an entry will land. Cannot close one.
      'finance-period:view',
    ],
    reports: ['finance.trial-balance', 'finance.ledger-statement', 'finance.day-book'],
  },

  // -------------------------------------------------------------------------
  [ROLES.FINANCE_MANAGER]: {
    note: 'Everything the accountant does, plus reversals, the chart, and closing the month.',
    permissions: [
      'finance-coa:view',
      'finance-coa:add',
      'finance-coa:edit',
      'finance-coa:delete',
      'finance-coa:change',

      'finance-journal:view',
      'finance-journal:add',
      'finance-journal:edit',
      'finance-journal:delete',
      'finance-journal:change',

      'finance-reversal:view',
      'finance-reversal:change',

      'finance-period:view',
      'finance-period:change',
    ],
    reports: ['finance.trial-balance', 'finance.ledger-statement', 'finance.day-book'],
  },
};

/** Expand a flat `module:action` list into the stored grant map. */
function buildGrants(permissions: string[]): Map<string, IModuleGrant> {
  const grants = new Map<string, IModuleGrant>();

  for (const key of new Set([...BASELINE_PERMISSIONS, ...permissions])) {
    if (!isValidPermission(key)) {
      throw new Error(
        `Seed lists "${key}", which is not a valid permission. ` +
          `Fix the seed or add the action to the module in constants/permissions.ts.`,
      );
    }
    const [moduleId, action] = key.split(':') as [string, Action];
    const existing = grants.get(moduleId) ?? {};
    existing[action] = true;
    grants.set(moduleId, existing);
  }

  return grants;
}

export interface SeedOptions {
  /** Overwrite policies that already exist. Off by default — see the header note. */
  force?: boolean;
  /** Backfill `roles: [role]` onto user documents written before the multi-role change. */
  backfillUsers?: boolean;
}

export interface SeedResult {
  created: string[];
  updated: string[];
  skipped: string[];
  usersBackfilled: number;
}

export async function seedAccessPolicies(options: SeedOptions = {}): Promise<SeedResult> {
  const { force = false, backfillUsers = true } = options;

  const result: SeedResult = { created: [], updated: [], skipped: [], usersBackfilled: 0 };

  for (const [role, seed] of Object.entries(ROLE_SEEDS)) {
    const existing = await AccessPolicyModel.findOne({
      subjectType: 'role',
      subjectKey: role,
    }).exec();

    if (existing && !force) {
      result.skipped.push(role);
      continue;
    }

    const doc = {
      subjectType: 'role' as const,
      subjectKey: role,
      grants: buildGrants(seed.permissions),
      reports: seed.reports,
      isSystem: true,
    };

    if (existing) {
      existing.set(doc);
      await existing.save();
      result.updated.push(role);
    } else {
      await AccessPolicyModel.create(doc);
      result.created.push(role);
    }
  }

  if (backfillUsers) {
    // `roles` missing entirely, or present but empty. Both mean "written before this change".
    const stale = await UserModel.find({
      $or: [{ roles: { $exists: false } }, { roles: { $size: 0 } }],
    })
      .select('_id role')
      .lean()
      .exec();

    for (const u of stale) {
      if (!u.role) continue;
      await UserModel.updateOne({ _id: u._id }, { $set: { roles: [u.role] } }).exec();
      result.usersBackfilled += 1;
    }
  }

  invalidateAccessCache();
  return result;
}

/**
 * Sanity check for the seed and the catalogue, run by `npm run test:permissions`.
 * Cheap enough for CI: it catches a module renamed in one file and not the other, which would
 * otherwise show up as a role quietly losing a screen.
 */
export function validateSeed(): string[] {
  const problems: string[] = [];
  const moduleIds = new Set(MODULES.map((m) => m.id));
  const reportIds = new Set(REPORTS.map((r) => r.id));

  for (const [role, seed] of Object.entries(ROLE_SEEDS)) {
    for (const key of [...BASELINE_PERMISSIONS, ...seed.permissions]) {
      const [moduleId, action] = key.split(':');
      if (!moduleIds.has(moduleId)) {
        problems.push(`${role}: unknown module "${moduleId}" in "${key}"`);
      } else if (!ALL_ACTIONS.includes(action as Action)) {
        problems.push(`${role}: unknown action "${action}" in "${key}"`);
      } else if (!isValidPermission(key)) {
        problems.push(`${role}: module "${moduleId}" does not support action "${action}"`);
      }
    }
    for (const reportId of seed.reports) {
      if (!reportIds.has(reportId)) {
        problems.push(`${role}: unknown report "${reportId}"`);
      }
    }
  }

  return problems;
}

export { ROLE_SEEDS, BASELINE_PERMISSIONS };
