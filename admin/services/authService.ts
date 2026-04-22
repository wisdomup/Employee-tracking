import api from './api';
import { jwtDecode } from 'jwt-decode';

export interface LoginCredentials {
  username: string;
  password: string;
}

export interface User {
  id: string;
  username: string;
  fullName?: string;
  role: string;
  phone: string;
  email?: string;
  userID?: string;
  profileImage?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
  };
}

/** Map GET/PATCH /users/me response into the shape stored in localStorage + AuthContext. */
export function mapApiUserToAuthUser(data: {
  _id?: string;
  id?: string;
  username: string;
  fullName?: string;
  role: string;
  phone: string;
  email?: string;
  userID?: string;
  profileImage?: string;
  address?: User['address'];
}): User {
  const id = data._id != null ? String(data._id) : String(data.id ?? '');
  return {
    id,
    username: data.username,
    fullName: data.fullName?.trim() || undefined,
    role: data.role,
    phone: data.phone,
    email: data.email,
    userID: data.userID,
    profileImage: data.profileImage,
    address: data.address,
  };
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

  setStoredUser(user: User) {
    localStorage.setItem('user', JSON.stringify(user));
  },
};
