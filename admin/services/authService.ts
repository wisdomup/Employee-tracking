import api from './api';
import { jwtDecode } from 'jwt-decode';

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface User {
  id: string;
  username: string;
  role: string;
  phone: string;
  email?: string;
}

export const authService = {
  async login(credentials: LoginCredentials) {
    const response = await api.post('/auth/login', credentials);
    const { access_token, user } = response.data;
    
    // Store token and user data
    localStorage.setItem('token', access_token);
    localStorage.setItem('user', JSON.stringify(user));
    
    return { token: access_token, user };
  },

  logout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
  },

  getToken(): string | null {
    return localStorage.getItem('token');
  },

  getUser(): User | null {
    const userStr = localStorage.getItem('user');
    return userStr ? JSON.parse(userStr) : null;
  },

  isAuthenticated(): boolean {
    const token = this.getToken();
    if (!token) return false;

    try {
      const decoded: any = jwtDecode(token);
      return decoded.exp * 1000 > Date.now();
    } catch {
      return false;
    }
  },

  isAdmin(): boolean {
    const user = this.getUser();
    return user?.role === 'admin';
  },
};
