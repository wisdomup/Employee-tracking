import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../../contexts/AuthContext';
import { can, canViewAnyReportOn, canViewReport } from '../../utils/permissions';
import Loader from '../UI/Loader';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /**
   * Roles allowed to reach this page. Defaults to `['admin']`.
   *
   * Still supported because 66 pages pass it, and it is a cheap coarse gate. It now matches
   * against ALL of the user's roles, not just the primary one — otherwise a Salesman who was
   * also given Warehouse Staff would lose every page they had before the second role was added.
   *
   * Prefer `permission` for new pages: a role list here has to be kept in step with the matrix
   * by hand, which is the drift this whole module exists to remove.
   */
  allowedRoles?: string[];
  /**
   * Permission required to open the page, e.g. `'orders:view'`. When given, this decides
   * access and `allowedRoles` is ignored.
   */
  permission?: string;
  /** Report id required to open the page. Reports are gated one at a time. */
  report?: string;
  /**
   * Open the page when the user may view ANY report whose id starts with this prefix.
   *
   * For screens that host several reports — the Stock Reports tabs, the Performance
   * drill-downs. Naming one specific report there would lock out a role granted only one of
   * the others: someone ticked for Profit &amp; Loss alone could not reach the page that
   * contains it. The individual tabs still filter themselves.
   */
  reportPrefix?: string;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles = ['admin'],
  permission,
  report,
  reportPrefix,
}) => {
  const { isAuthenticated, loading, accessLoading, user } = useAuth();
  const router = useRouter();

  const gatedOnAccess = Boolean(permission || report || reportPrefix);

  // "Still loading" is not "denied". Deciding before the grants arrive would bounce every
  // permission-gated page to /login on a hard refresh, which reads as a broken login.
  const settled = !loading && (!gatedOnAccess || !accessLoading);

  const allowed = (() => {
    if (!isAuthenticated || !user) return false;
    if (permission) return can(undefined, permission);
    if (report) return canViewReport(report);
    if (reportPrefix) return canViewAnyReportOn(reportPrefix);

    const held = user.roles?.length ? user.roles : user.role ? [user.role] : [];
    return held.some((r) => allowedRoles.includes(r));
  })();

  useEffect(() => {
    if (!settled) return;

    if (!isAuthenticated) {
      router.push('/login');
    } else if (!allowed) {
      // Signed in but not permitted is a different situation from signed out, and sending
      // them back to /login makes it look like their session expired. The dashboard is
      // reachable by every role, so it is the safe landing place.
      router.push('/dashboard');
    }
  }, [settled, isAuthenticated, allowed, router]);

  if (!settled) {
    return <Loader />;
  }

  if (!allowed) {
    return null;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
