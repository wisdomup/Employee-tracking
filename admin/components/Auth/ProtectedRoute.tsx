import React, { useEffect } from 'react';
import { useRouter } from 'next/router';
import { useAuth } from '../../contexts/AuthContext';
import Loader from '../UI/Loader';

interface ProtectedRouteProps {
  children: React.ReactNode;
  /**
   * Roles allowed to access this route.
   * Defaults to ['admin'] — preserving existing admin-only behaviour.
   * Pass ALL_ROLES or a custom list to open a route to employee roles.
   */
  allowedRoles?: string[];
}

const ProtectedRoute: React.FC<ProtectedRouteProps> = ({
  children,
  allowedRoles = ['admin'],
}) => {
  const { isAuthenticated, loading, user } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !isAuthenticated) {
      router.push('/login');
    } else if (!loading && isAuthenticated && user?.role && !allowedRoles.includes(user.role)) {
      router.push('/login');
    }
  }, [isAuthenticated, loading, user, router, allowedRoles]);

  if (loading) {
    return <Loader />;
  }

  if (!isAuthenticated || !user?.role || !allowedRoles.includes(user.role)) {
    return null;
  }

  return <>{children}</>;
};

export default ProtectedRoute;
