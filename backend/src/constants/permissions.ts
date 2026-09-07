/**
 * The permission catalogue: every module and report the access matrix can gate.
 *
 * This file is the single source of truth for BOTH sides of the app. The admin matrix screen
 * renders from it, and `requirePermission()` validates against it — so a typo in a route guard
 * fails at startup rather than silently granting nothing.
 *
 * ## The two-layer rule
 *
 * The matrix answers one question only: *may this role touch this module with this action at
 * all?* It does NOT replace the state and ownership guards already in the services
 * (`orders:edit-pending`, "own visit only", "not yet approved"). Those still run underneath.
 * A Salesman granted `orders:edit` still cannot edit a delivered, invoiced order, because the
 * order service refuses it for reasons that have nothing to do with roles.
 *
 * Collapsing those rules into the matrix was considered and rejected: it would hand Admin a
 * checkbox that appears to permit rewriting invoiced history, which no one wants to be one
 * mis-click away from.
 */

/** The five actions from the requirement. Every gated operation maps onto exactly one. */
export const ACTIONS = {
  VIEW: 'view',
  ADD: 'add',
  EDIT: 'edit',
  DELETE: 'delete',
  /** Status transitions and approvals — the "change" action in the requirement. */
  CHANGE: 'change',
} as const;

export type Action = (typeof ACTIONS)[keyof typeof ACTIONS];

export const ALL_ACTIONS: readonly Action[] = Object.values(ACTIONS);

/** Grouping for the admin screen. Purely presentational — carries no access meaning. */
export const MODULE_GROUPS = {
  SALES: 'Sales & Field',
  INVENTORY: 'Inventory',
  PEOPLE: 'People',
  FINANCE: 'Accounts & Finance',
  SYSTEM: 'System',
} as const;

export type ModuleGroup = (typeof MODULE_GROUPS)[keyof typeof MODULE_GROUPS];

export interface ModuleDefinition {
  id: string;
  label: string;
  group: ModuleGroup;
  /**
   * Actions that mean something for this module. Anything omitted renders as a greyed `n/a`
   * cell in the admin UI and is refused by `isValidPermission()`.
   *
   * A Dashboard cannot be "added" and an Activity Log cannot be "edited". Showing a checkbox
   * for an action nothing enforces is worse than showing nothing — an Admin would tick it,
   * see no effect, and lose trust in the whole screen.
   */
  actions: readonly Action[];
  /** What "change" does here, shown as help text in the matrix. Omit when `change` is n/a. */
  changeMeans?: string;
}

const { VIEW, ADD, EDIT, DELETE, CHANGE } = ACTIONS;
const FULL: readonly Action[] = [VIEW, ADD, EDIT, DELETE, CHANGE];
const CRUD: readonly Action[] = [VIEW, ADD, EDIT, DELETE];
const READ_ONLY: readonly Action[] = [VIEW];

export const MODULES: readonly ModuleDefinition[] = [
  // ---- Sales & Field ----
  { id: 'dashboard', label: 'Dashboard', group: MODULE_GROUPS.SALES, actions: READ_ONLY },
  {
    id: 'orders', label: 'Orders', group: MODULE_GROUPS.SALES, actions: FULL,
    changeMeans: 'Move an order between statuses, or cancel it',
  },
  {
    id: 'visits', label: 'Visits', group: MODULE_GROUPS.SALES, actions: FULL,
    changeMeans: 'Check in, complete, or skip a visit',
  },
  { id: 'dealers', label: 'Clients / Dealers', group: MODULE_GROUPS.SALES, actions: FULL,
    changeMeans: 'Activate or deactivate a client, correct their pin' },
  { id: 'routes', label: 'Routes', group: MODULE_GROUPS.SALES, actions: CRUD },
  { id: 'route-assignments', label: 'Route Assignments', group: MODULE_GROUPS.SALES, actions: CRUD },
  { id: 'tasks', label: 'Tasks', group: MODULE_GROUPS.SALES, actions: FULL,
    changeMeans: 'Move a task between statuses' },
  {
    id: 'approvals', label: 'Approvals', group: MODULE_GROUPS.SALES, actions: FULL,
    changeMeans: 'Approve or reject a request',
  },
  {
    id: 'returns', label: 'Returns', group: MODULE_GROUPS.SALES, actions: FULL,
    changeMeans: 'Accept or reject a return',
  },
  {
    id: 'collections', label: 'Collections & Delivery', group: MODULE_GROUPS.SALES,
    // Collection entries are never hard-deleted — they are voided, which is a `change`.
    // A deleted cash record is an unauditable cash record.
    actions: [VIEW, ADD, EDIT, CHANGE],
    changeMeans: 'Mark packed, settle, void, or correct an entry',
  },
  { id: 'targets', label: 'Targets', group: MODULE_GROUPS.SALES, actions: CRUD },

  // ---- Inventory ----
  { id: 'products', label: 'Products', group: MODULE_GROUPS.INVENTORY, actions: FULL,
    changeMeans: 'Activate or deactivate a product' },
  { id: 'categories', label: 'Categories', group: MODULE_GROUPS.INVENTORY, actions: CRUD },
  { id: 'catalogs', label: 'Catalogs', group: MODULE_GROUPS.INVENTORY, actions: CRUD },
  // The warehouse is split into its five documents rather than kept as one module.
  //
  // With a single `warehouse` module, "receive a transfer" and "approve a write-off" both
  // collapse into one `change` tick — and approval is the only control on write-offs, so
  // granting a storeman the ability to receive would silently grant them the ability to
  // approve their own damage claims. Splitting keeps those on separate rows.
  //
  // Known limit of the five-action model, worth stating: within one document type, approve /
  // receive / cancel are all `change` and cannot be separated by the matrix alone. Where that
  // distinction carries money — approving a write-off — the service keeps its own guard
  // underneath, exactly as the state rules do.
  { id: 'warehouse', label: 'Warehouses & Stock on Hand', group: MODULE_GROUPS.INVENTORY, actions: FULL,
    changeMeans: 'Adjust stock, set low-stock levels, manage opening stock' },
  { id: 'stock-in', label: 'Stock In / Receipts', group: MODULE_GROUPS.INVENTORY, actions: FULL,
    changeMeans: 'Cancel a receipt' },
  { id: 'transfers', label: 'Stock Transfers', group: MODULE_GROUPS.INVENTORY, actions: FULL,
    changeMeans: 'Receive, approve or cancel a transfer' },
  { id: 'damage', label: 'Damage / Claims', group: MODULE_GROUPS.INVENTORY, actions: FULL,
    changeMeans: 'Approve or cancel a damage claim' },
  { id: 'stock-count', label: 'Stock Counts', group: MODULE_GROUPS.INVENTORY, actions: FULL,
    changeMeans: 'Approve or cancel a count' },

  // ---- People ----
  {
    id: 'employees', label: 'People / Employees', group: MODULE_GROUPS.PEOPLE, actions: FULL,
    changeMeans: 'Activate, deactivate, or assign roles',
  },
  { id: 'attendance', label: 'Attendance', group: MODULE_GROUPS.PEOPLE, actions: CRUD },
  {
    id: 'account-freeze', label: 'Account Freeze', group: MODULE_GROUPS.PEOPLE,
    actions: [VIEW, CHANGE],
    changeMeans: 'Freeze or unfreeze a late-starting rider',
  },
  {
    id: 'performance-flags', label: 'Performance Flags', group: MODULE_GROUPS.PEOPLE,
    actions: [VIEW, CHANGE],
    changeMeans: 'Clear or action a flag',
  },

  // ---- Accounts & Finance ----
  //
  // The module is split by DOCUMENT rather than kept as one `finance` row, for the same reason
  // the warehouse was split into five: under five actions, "post an entry" and "reverse a
  // posted entry" are both `change`, so a single row would make it impossible to let someone
  // record work without also letting them undo it. Segregation of duties is the whole point of
  // an accounting permission model, and it is only expressible one row at a time.
  //
  // Rows arrive with the step that builds the screens behind them. This is step 01.
  {
    id: 'finance-coa', label: 'Chart of Accounts', group: MODULE_GROUPS.FINANCE, actions: FULL,
    changeMeans: 'Activate or deactivate an account group or ledger',
  },
  {
    id: 'finance-journal', label: 'Journal Entries', group: MODULE_GROUPS.FINANCE, actions: FULL,
    changeMeans: 'Post a draft entry to the ledger',
  },
  {
    /*
     * Reversal is its OWN row, not a `change` on `finance-journal`.
     *
     * Under five actions, "post an entry" and "reverse a posted entry" are both `change`, so a
     * single row would make it impossible to let someone record work without also letting them
     * undo it. Separating the powers that share an action verb by splitting the row is the
     * technique already used when the warehouse became five rows — and here it is what makes
     * ordinary segregation of duties expressible at all.
     */
    id: 'finance-reversal', label: 'Reversals & Voids', group: MODULE_GROUPS.FINANCE,
    actions: [VIEW, CHANGE],
    changeMeans: 'Reverse a posted entry, or void a posted document',
  },
  {
    id: 'finance-period', label: 'Accounting Periods', group: MODULE_GROUPS.FINANCE,
    actions: [VIEW, CHANGE],
    changeMeans: 'Open, close or reopen an accounting month',
  },
  {
    /*
     * Deciding that money is not coming back.
     *
     * One row for both write-offs the business needs — a rider's cash shortfall, and an
     * uncollectable debt from a shop that has closed — because they are the same power: an
     * admin accepting a loss rather than recording a recovery. Whoever may do one may do the
     * other, and splitting them would suggest a distinction that does not exist.
     *
     * Held apart from `collections:change`, which covers settling and voiding. Confirming that
     * a rider handed cash over is routine; deciding they never will is not.
     */
    id: 'finance-writeoff', label: 'Write-offs', group: MODULE_GROUPS.FINANCE,
    actions: [VIEW, CHANGE],
    changeMeans: 'Write off a rider cash shortfall, or a debt that will not be collected',
  },

  // ---- System ----
  { id: 'activity-logs', label: 'Activity Logs', group: MODULE_GROUPS.SYSTEM, actions: READ_ONLY },
  {
    id: 'broadcast-notifications', label: 'Broadcast Notifications', group: MODULE_GROUPS.SYSTEM,
    actions: CRUD,
  },
  {
    id: 'trash', label: 'Trash', group: MODULE_GROUPS.SYSTEM,
    // Nothing is *added* to Trash directly; items arrive by being deleted elsewhere.
    // `delete` here is the permanent purge, `change` is restore.
    actions: [VIEW, DELETE, CHANGE],
    changeMeans: 'Restore a trashed record',
  },
  {
    id: 'settings', label: 'System Settings', group: MODULE_GROUPS.SYSTEM,
    actions: [VIEW, EDIT],
  },
  {
    /*
     * Download a list as CSV or PDF. One cell for the whole app, not one per screen.
     *
     * It gates a control, not an endpoint, which makes it the odd one out here: the export is
     * built in the browser from rows the page has already fetched, so a role that can see a
     * list can always read the same data through the API. What this decides is whether the
     * Export button is offered — the difference between "you may take the client list home in
     * a spreadsheet" and "you may look at it on this screen", which is the distinction the
     * requirement actually draws.
     *
     * Per-screen export cells were considered and rejected: 30-odd list pages would mean
     * 30-odd checkboxes that nobody would ever tick individually, and the honest boundary is
     * per person, not per screen.
     *
     * `view` is the only sensible action — an export cannot be added, edited or deleted.
     */
    id: 'exports', label: 'Data Export (CSV / PDF)', group: MODULE_GROUPS.SYSTEM,
    actions: READ_ONLY,
  },
];

const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m]));

export function getModule(moduleId: string): ModuleDefinition | undefined {
  return MODULE_BY_ID.get(moduleId);
}

/** `'orders:edit'` — the canonical wire format for a single matrix cell. */
export type PermissionKey = string;

export function permissionKey(moduleId: string, action: Action): PermissionKey {
  return `${moduleId}:${action}`;
}

export function parsePermissionKey(
  key: PermissionKey,
): { moduleId: string; action: Action } | null {
  const idx = key.indexOf(':');
  if (idx < 1) return null;
  const moduleId = key.slice(0, idx);
  const action = key.slice(idx + 1) as Action;
  if (!MODULE_BY_ID.has(moduleId)) return null;
  if (!ALL_ACTIONS.includes(action)) return null;
  return { moduleId, action };
}

/**
 * True when the key names a real module AND an action that module actually supports.
 *
 * Route guards are validated against this at startup, so `requirePermission('order:edit')`
 * (missing the plural) throws while the process is booting instead of quietly denying every
 * request in production.
 */
export function isValidPermission(key: PermissionKey): boolean {
  const parsed = parsePermissionKey(key);
  if (!parsed) return false;
  const mod = MODULE_BY_ID.get(parsed.moduleId);
  return !!mod && mod.actions.includes(parsed.action);
}

/** Every legal cell in the matrix, in display order. Drives the admin screen and the seed. */
export function allPermissionKeys(): PermissionKey[] {
  const keys: PermissionKey[] = [];
  for (const mod of MODULES) {
    for (const action of mod.actions) {
      keys.push(permissionKey(mod.id, action));
    }
  }
  return keys;
}

// ---------------------------------------------------------------------------
// Reports — a separate, stricter layer
// ---------------------------------------------------------------------------

/**
 * Reports are gated one report at a time, not one module at a time, and they are
 * **view-only for every role including Admin**. There is deliberately no add/edit/delete
 * axis here and no export, print or download path — see `REPORTS_ARE_VIEW_ONLY` below.
 */
export interface ReportDefinition {
  id: string;
  label: string;
  /** The screen it lives on. Groups the checkboxes in the admin UI. */
  surface: string;
  /** Admin route the report renders at, used by the frontend guard. */
  path: string;
}

export const REPORT_SURFACES = {
  DASHBOARD: 'Dashboard Reports',
  PERFORMANCE: 'Performance Analytics',
  WAREHOUSE: 'Warehouse Reports',
  STOCK: 'Stock Reports',
  COLLECTION: 'Collection',
  FINANCE: 'Finance Reports',
  REGION: 'Region Sales',
} as const;

/**
 * The ids MUST match the `metric` values the drill-down endpoints accept
 * (`ReportDetailMetric` in the dashboard module, `PERFORMANCE_DETAIL_METRICS` in analytics).
 * `requireReportFrom` builds the id straight from the query parameter, so a metric missing
 * here is a report nobody but Admin can ever open. `permissions.rules.test.ts` asserts the
 * two lists agree.
 */
export const REPORTS: readonly ReportDefinition[] = [
  // /reports — the nine dashboard KPI drill-downs, plus the invoice-level Sales Ledger.
  { id: 'reports.current-stock',      label: 'Current Stock',              surface: REPORT_SURFACES.DASHBOARD, path: '/reports/current-stock' },
  { id: 'reports.stock-hold',         label: 'Stock Hold',                 surface: REPORT_SURFACES.DASHBOARD, path: '/reports/stock-hold' },
  { id: 'reports.returned-qty',       label: 'Returned Qty',               surface: REPORT_SURFACES.DASHBOARD, path: '/reports/returned-qty' },
  { id: 'reports.damaged-qty',        label: 'Damaged Qty',                surface: REPORT_SURFACES.DASHBOARD, path: '/reports/damaged-qty' },
  { id: 'reports.sold-qty',           label: 'Sold Qty',                   surface: REPORT_SURFACES.DASHBOARD, path: '/reports/sold-qty' },
  { id: 'reports.earned',             label: 'Earned (Delivered Sales)',   surface: REPORT_SURFACES.DASHBOARD, path: '/reports/earned' },
  { id: 'reports.paid-back',          label: 'Paid Back (Returns)',        surface: REPORT_SURFACES.DASHBOARD, path: '/reports/paid-back' },
  { id: 'reports.net-after-returns',  label: 'Net After Returns',          surface: REPORT_SURFACES.DASHBOARD, path: '/reports/net-after-returns' },
  { id: 'reports.booked-sales',       label: 'Booked Sales (Open Orders)', surface: REPORT_SURFACES.DASHBOARD, path: '/reports/booked-sales' },
  { id: 'reports.sales-ledger',       label: 'Sales Ledger',               surface: REPORT_SURFACES.DASHBOARD, path: '/reports/sales-ledger' },

  // /analytics — the performance drill-downs
  { id: 'analytics.sales',              label: 'Sales',              surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/sales' },
  { id: 'analytics.target',             label: 'Target',             surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/target' },
  { id: 'analytics.achievement',        label: 'Achievement',        surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/achievement' },
  { id: 'analytics.booked',             label: 'Booked',             surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/booked' },
  { id: 'analytics.orders',             label: 'Orders',             surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/orders' },
  { id: 'analytics.visits-completed',   label: 'Visits Completed',   surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/visits-completed' },
  { id: 'analytics.overstays',          label: 'Overstays',          surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/overstays' },
  { id: 'analytics.new-clients',        label: 'New Clients',        surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/new-clients' },
  { id: 'analytics.visit-completion',   label: 'Visit Completion',   surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/visit-completion' },
  { id: 'analytics.visits-skipped',     label: 'Visits Skipped',     surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/visits-skipped' },
  { id: 'analytics.extra-visits',       label: 'Extra Visits',       surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/extra-visits' },
  { id: 'analytics.total-visits-done',  label: 'Total Visits Done',  surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/total-visits-done' },
  { id: 'analytics.open-flags',         label: 'Open Flags',         surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/open-flags' },
  { id: 'analytics.days-present',       label: 'Days Present',       surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/days-present' },
  { id: 'analytics.collected',          label: 'Collected',          surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/collected' },
  { id: 'analytics.outstanding',        label: 'Outstanding',        surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/outstanding' },
  { id: 'analytics.collection-rate',    label: 'Collection Rate',    surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/collection-rate' },
  { id: 'analytics.returns',            label: 'Returns',            surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/returns' },
  { id: 'analytics.avg-order-value',    label: 'Avg Order Value',    surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/avg-order-value' },
  { id: 'analytics.strike-rate',        label: 'Strike Rate',        surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/strike-rate' },
  { id: 'analytics.tasks-done',         label: 'Tasks Done',         surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/tasks-done' },
  { id: 'analytics.achieved-target',    label: 'Achieved Target',    surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/achieved-target' },
  { id: 'analytics.behind-pace',        label: 'Behind Pace',        surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/behind-pace' },
  { id: 'analytics.below-visits',       label: 'Below Visits',       surface: REPORT_SURFACES.PERFORMANCE, path: '/analytics/below-visits' },

  // /warehouse/reports — six tabs
  { id: 'warehouse-reports.stock',      label: 'Stock on Hand',      surface: REPORT_SURFACES.WAREHOUSE, path: '/warehouse/reports?tab=stock' },
  { id: 'warehouse-reports.movement',   label: 'Movement History',   surface: REPORT_SURFACES.WAREHOUSE, path: '/warehouse/reports?tab=movement' },
  { id: 'warehouse-reports.transfers',  label: 'Transfers',          surface: REPORT_SURFACES.WAREHOUSE, path: '/warehouse/reports?tab=transfers' },
  { id: 'warehouse-reports.damage',     label: 'Damage / Claim',     surface: REPORT_SURFACES.WAREHOUSE, path: '/warehouse/reports?tab=damage' },
  { id: 'warehouse-reports.count',      label: 'Monthly Count',      surface: REPORT_SURFACES.WAREHOUSE, path: '/warehouse/reports?tab=count' },
  { id: 'warehouse-reports.valuation',  label: 'Sales & Valuation',  surface: REPORT_SURFACES.WAREHOUSE, path: '/warehouse/reports?tab=valuation' },

  // /stock-reports — five tabs
  { id: 'stock-reports.current',   label: 'Current Stock',     surface: REPORT_SURFACES.STOCK, path: '/stock-reports?tab=current' },
  { id: 'stock-reports.hold',      label: 'Hold Stock',        surface: REPORT_SURFACES.STOCK, path: '/stock-reports?tab=hold' },
  { id: 'stock-reports.damage',    label: 'Return Damage',     surface: REPORT_SURFACES.STOCK, path: '/stock-reports?tab=damage' },
  { id: 'stock-reports.pl',        label: 'Profit & Loss',     surface: REPORT_SURFACES.STOCK, path: '/stock-reports?tab=pl' },
  { id: 'stock-reports.lowstock',  label: 'Low Stock Alerts',  surface: REPORT_SURFACES.STOCK, path: '/stock-reports?tab=lowstock' },

  // /collection — three reporting screens (the operational screens are gated by the
  // `collections` module above, not here)
  { id: 'collection.report',    label: 'Collection Report', surface: REPORT_SURFACES.COLLECTION, path: '/collection/report' },
  { id: 'collection.day-end',   label: 'Day End',           surface: REPORT_SURFACES.COLLECTION, path: '/collection/day-end' },
  { id: 'collection.activity',  label: 'Rider Activity',    surface: REPORT_SURFACES.COLLECTION, path: '/collection/activity' },

  // /region-sales
  { id: 'region-sales.daily', label: 'Region-wise Daily Sale', surface: REPORT_SURFACES.REGION, path: '/region-sales' },

  // /finance/reports — the three that make the posting engine usable. The statements (P&L,
  // Balance Sheet, Cash Flow, ageing) arrive with the step that builds them.
  { id: 'finance.trial-balance',    label: 'Trial Balance',    surface: REPORT_SURFACES.FINANCE, path: '/finance/reports/trial-balance' },
  { id: 'finance.ledger-statement', label: 'Ledger Statement', surface: REPORT_SURFACES.FINANCE, path: '/finance/reports/ledger-statement' },
  { id: 'finance.day-book',         label: 'Day Book',         surface: REPORT_SURFACES.FINANCE, path: '/finance/reports/day-book' },
  { id: 'finance.health',           label: 'Finance Health',   surface: REPORT_SURFACES.FINANCE, path: '/finance/health' },
];

const REPORT_BY_ID = new Map(REPORTS.map((r) => [r.id, r]));

export function getReport(reportId: string): ReportDefinition | undefined {
  return REPORT_BY_ID.get(reportId);
}

export function isValidReport(reportId: string): boolean {
  return REPORT_BY_ID.has(reportId);
}

export function allReportIds(): string[] {
  return REPORTS.map((r) => r.id);
}

/**
 * Reports carry no export, print or download path for any role, Admin included.
 *
 * Kept as an exported constant rather than a comment so the intent is greppable: if someone
 * later adds an export button to a report screen, the reviewer can point at this.
 *
 * Note the honest limit — this removes the UI affordance, not the data. The report APIs still
 * return JSON to anyone holding a valid token and browser dev tools. Closing that means
 * removing the server-side export endpoints too, which is a separate, deliberate decision.
 *
 * Operational documents are NOT reports and keep their print path: order invoices, warehouse
 * stock-in / transfer / damage slips, and the product catalog download. Riders and warehouse
 * staff hand those to customers on paper.
 */
export const REPORTS_ARE_VIEW_ONLY = true;
