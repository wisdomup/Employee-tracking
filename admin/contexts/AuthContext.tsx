import React, { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import { useRouter } from 'next/router';
import { authService, User, LoginCredentials, mapApiUserToAuthUser } from '../services/authService';
import { profileService } from '../services/profileService';
import { permissionService } from '../services/permissionService';
import {
  ResolvedAccess,
  clearResolvedAccess,
  setResolvedAccess,
} from '../utils/permissions';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  /**
   * The signed-in user's resolved grants, or null before they arrive.
   *
   * Kept in state as well as in the `utils/permissions` module store: the module store is what
   * the 45 plain `can()` call sites read, and this is what makes React re-render when the
   * answer changes. Without the state copy a screen that mounted before the fetch resolved
   * would keep rendering the "no permission" branch forever.
   */
  access: ResolvedAccess | null;
  /**
   * True until permissions have been fetched for a signed-in user. Screens must wait on this
   * before deciding someone is not allowed in — treating "not loaded yet" as "denied" is what
   * makes a permission system flash an error page on every refresh.
   */
  accessLoading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
  refreshAccess: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<ResolvedAccess | null>(null);
  const [accessLoading, setAccessLoading] = useState(false);
  const router = useRouter();

  const loadAccess = useCallback(async () => {
    setAccessLoading(true);
    try {
      const resolved = await permissionService.getMyAccess();
      setResolvedAccess(resolved);
      setAccess(resolved);
    } catch {
      // A failed fetch must not leave stale grants from a previous session in the store.
      // Empty is the safe answer: screens render their read-only branch rather than offering
      // buttons that will 403.
      clearResolvedAccess();
      setAccess(null);
    } finally {
      setAccessLoading(false);
    }
  }, []);

  useEffect(() => {
    const checkAuth = () => {
      if (authService.isAuthenticated()) {
        const userData = authService.getUser();
        setUser(userData);
        void loadAccess();
      }
      setLoading(false);
    };

    checkAuth();
  }, [loadAccess]);

  const login = async (credentials: LoginCredentials) => {
    const { user: userData } = await authService.login(credentials);
    setUser(userData);
    // Awaited, not fired and forgotten: the dashboard reads permissions as it mounts, and
    // navigating first would render it against an empty set.
    await loadAccess();
    router.push('/dashboard');
  };

  const logout = () => {
    authService.logout();
    clearResolvedAccess();
    setAccess(null);
    setUser(null);
    router.push('/login');
  };

  const refreshUser = async () => {
    const doc = await profileService.getProfileDocument();
    const next = mapApiUserToAuthUser(doc);
    authService.setStoredUser(next);
    setUser(next);
    // Roles may have changed while they were signed in — an admin can reassign them at any
    // moment, and the backend already resolves per request rather than from the token.
    await loadAccess();
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
        access,
        accessLoading,
        login,
        logout,
        refreshUser,
        refreshAccess: loadAccess,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
