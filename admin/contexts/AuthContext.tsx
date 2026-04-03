import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { useRouter } from 'next/router';
import { authService, User, LoginCredentials, mapApiUserToAuthUser } from '../services/authService';
import { profileService } from '../services/profileService';

interface AuthContextType {
  user: User | null;
  isAuthenticated: boolean;
  loading: boolean;
  login: (credentials: LoginCredentials) => Promise<void>;
  logout: () => void;
  refreshUser: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

interface AuthProviderProps {
  children: ReactNode;
}

export const AuthProvider: React.FC<AuthProviderProps> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  useEffect(() => {
    // Check if user is authenticated on mount
    const checkAuth = () => {
      if (authService.isAuthenticated()) {
        const userData = authService.getUser();
        setUser(userData);
      }
      setLoading(false);
    };

    checkAuth();
  }, []);

  const login = async (credentials: LoginCredentials) => {
    try {
      const { user: userData } = await authService.login(credentials);
      setUser(userData);
      router.push('/dashboard');
    } catch (error) {
      throw error;
    }
  };

  const logout = () => {
    authService.logout();
    setUser(null);
    router.push('/login');
  };

  const refreshUser = async () => {
    const doc = await profileService.getProfileDocument();
    const next = mapApiUserToAuthUser(doc);
    authService.setStoredUser(next);
    setUser(next);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isAuthenticated: !!user,
        loading,
        login,
        logout,
        refreshUser,
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
