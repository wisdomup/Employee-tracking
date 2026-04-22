import api from './api';

export interface Employee {
  _id: string;
  userID: string;
  username: string;
  fullName?: string;
  phone: string;
  email?: string;
  role: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
  };
  profileImage?: string;
  profilePicture?: string;
  isActive: boolean;
  designation?: string;
  perks?: { salary?: number; bonus?: number; allowance?: number };
  target?: string;
  achivedTarget?: string;
  extraNotes?: string;
  lastExperience?: string;
  createdAt: string;
  updatedAt: string;
}

export const employeeService = {
  async getEmployees(filters?: { role?: string; isActive?: boolean }) {
    const params = new URLSearchParams();
    if (filters?.role) params.append('role', filters.role);
    if (filters?.isActive !== undefined) params.append('isActive', filters.isActive.toString());
    
    const response = await api.get(`/users?${params.toString()}`);
    return response.data;
  },

  async getEmployee(id: string) {
    const response = await api.get(`/users/${id}`);
    return response.data;
  },

  async createEmployee(data: Partial<Employee> & { password: string }) {
    const response = await api.post('/users', data);
    return response.data;
  },

  async updateEmployee(id: string, data: Partial<Employee>) {
    const response = await api.put(`/users/${id}`, data);
    return response.data;
  },

  async deleteEmployee(id: string) {
    const response = await api.delete(`/users/${id}`);
    return response.data;
  },
};
