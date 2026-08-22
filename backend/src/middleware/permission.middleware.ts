import { Request, Response, NextFunction } from 'express';
import { forbidden } from '../utils/app-error';
import { isValidPermission, PermissionKey } from '../constants/permissions';
import {
  resolveAccess,
  accessAllows,
  accessAllowsReport,
  ResolvedAccess,
} from '../services/access-control.service';

/**
 * Route guards for the admin-editable permission matrix. Replaces `requireRoles(...)`.
 *
 * ## What this guard does and does not do
 *
 * It answers "may this role touch this module with this action at all". It does NOT replace
 * the state and ownership checks in the services — "only while pending", "own visit only",
 * "not yet approved" all still run afterwards and can still refuse. Both layers must pass.
 *
 * That split is deliberate. Folding the state rules into the matrix would hand an Admin a
 * checkbox that appears to permit rewriting an invoiced order, and a permission screen should
 * not be able to promise something the domain will refuse anyway.
 */

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /**
       * Memoised for the life of the request. Several guards can run on one route (a
       * permission plus a report check), and each would otherwise re-resolve identically.
       */
      access?: ResolvedAccess;
    }
  }
}

async function getAccess(req: Request): Promise<ResolvedAccess> {
  if (!req.access) {
    req.access = await resolveAccess(req.user);
  }
  return req.access;
}

/**
 * Fail fast on a typo. A guard naming a permission that is not in the catalogue would
 * otherwise deny every request to that route forever, and look like a config problem rather
 * than the code problem it is. Throwing at module load means the process refuses to boot.
 */
function validateOrThrow(permission: PermissionKey): void {
  if (!isValidPermission(permission)) {
    throw new Error(
      `requirePermission("${permission}") names a permission that is not in the catalogue. ` +
        `Check the module id and that the module declares this action in constants/permissions.ts.`,
    );
  }
}

/** Require one permission, e.g. `requirePermission('orders:edit')`. */
export function requirePermission(permission: PermissionKey) {
  validateOrThrow(permission);

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) return next(forbidden('Not authenticated'));

      const access = await getAccess(req);
      if (!accessAllows(access, permission)) {
        return next(forbidden('Insufficient permissions'));
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Require ANY of several permissions.
 *
 * For endpoints one action cannot describe — a list route serving both "view orders" and
 * "view my own deliveries", say. Prefer a single permission where one fits; a long any-of
 * list usually means the route is doing two jobs.
 */
export function requireAnyPermission(...permissions: PermissionKey[]) {
  if (permissions.length === 0) {
    throw new Error('requireAnyPermission() called with no permissions');
  }
  permissions.forEach(validateOrThrow);

  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) return next(forbidden('Not authenticated'));

      const access = await getAccess(req);
      if (!permissions.some((p) => accessAllows(access, p))) {
        return next(forbidden('Insufficient permissions'));
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Gate a single report by id, e.g. `requireReport('stock-reports.pl')`.
 *
 * Separate from `requirePermission` because reports are their own layer: one verb, no
 * module-level shortcut, and an allow-list rather than a grant object. A role with
 * `warehouse:view` still sees no warehouse report unless that specific report is ticked.
 */
export function requireReport(reportId: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) return next(forbidden('Not authenticated'));

      const access = await getAccess(req);
      if (!accessAllowsReport(access, reportId)) {
        return next(forbidden('You do not have access to this report'));
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Gate a report whose identity is only known at request time.
 *
 * The drill-down endpoints take the report as a parameter — `/performance/detail?metric=sales`
 * serves twelve different reports from one route. Gating the route on "any analytics report"
 * would let a role ticked for Sales read Overstays, which is exactly the per-report control
 * the requirement asks for. So the id is built from the request instead.
 *
 * An unrecognised id is refused rather than allowed: a metric the catalogue does not know is
 * a report nobody has been granted.
 */
export function requireReportFrom(build: (req: Request) => string | undefined) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) return next(forbidden('Not authenticated'));

      const reportId = build(req);
      if (!reportId) return next(forbidden('Unknown report'));

      const access = await getAccess(req);
      if (!accessAllowsReport(access, reportId)) {
        return next(forbidden('You do not have access to this report'));
      }

      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Allow through if the caller may see ANY report on a surface.
 *
 * For the index endpoints that render a report screen's shell and filter lists before the
 * user has picked a specific report. The per-report check still happens on the drill-down.
 */
export function requireAnyReportOn(prefix: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) return next(forbidden('Not authenticated'));

      const access = await getAccess(req);
      if (access.isAdmin) return next();

      for (const id of access.reports) {
        if (id.startsWith(prefix)) return next();
      }

      next(forbidden('You do not have access to these reports'));
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Admin-only, expressed without naming a role.
 *
 * A handful of operations are structurally the super-admin's and are not matrix cells at all
 * — editing the matrix itself, most obviously. Routing those through a permission key would
 * mean shipping a checkbox that can revoke the ability to un-revoke it.
 */
export function requireAdmin() {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      if (!req.user) return next(forbidden('Not authenticated'));

      const access = await getAccess(req);
      if (!access.isAdmin) return next(forbidden('Admin access required'));

      next();
    } catch (err) {
      next(err);
    }
  };
}
