import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../utils/permissions';
import Loader from '../UI/Loader';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /**
   * Roles allowed to access this route.
   * Defaults to ['admin'] — preserving existing admin-only behaviour.
   * Pass ALL_ROLES or a custom list to open a route to employee roles.
   */
  allowedRoles?: string[];
  /**
   * Optional permission key checked via `can()` on top of `allowedRoles` — both must pass.
   * Use it when a page is gated by a permission rather than by a role list, so the role
   * mapping lives only in `utils/permissions.ts` (see `products:view-catalog`).
   */
  requiredPermission?: string;
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles = ['admin'],
  requiredPermission,
}) => {
  const { isAuthenticated, loading, user } = useAuth();
  const router = useRouter();

  const denied =
    !user?.role ||
    !allowedRoles.includes(user.role) ||
    (!!requiredPermission && !can(user.role, requiredPermission));

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    } else if (!loading && isAuthenticated && denied) {
      router.push('/login');
    }
  }, [isAuthenticated, loading, denied, router]);

  if (loading) {
    return <Loader />;
  }

  if (!isAuthenticated || denied) {
    return null;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
