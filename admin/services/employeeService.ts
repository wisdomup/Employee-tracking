import api from './api';

export interface Employee {
  _id: string;
  userID: string;
  username: string;
  fullName?: string;
  phone: string;
  email?: string;
  role: string;
  /** Every role held, primary first. Absent on accounts written before multi-role. */
  roles?: string[];
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
  /** Sales manager this field-staff user reports to ('' or null clears it). */
  managerId?: string | null;
  /**
   * Warehouse this person works at ('' or null clears it). Required in practice for
   * `warehouse_staff` — without it they are locked out of the warehouse module rather than
   * given access to every warehouse.
   */
  warehouseId?: string | null;
  /** When false, the nightly cron does not generate route visits for this user. */
  autoAssignVisits?: boolean;
  /**
   * Late-start freeze — separate from `isActive`. `isActive` is the admin's permanent
   * on/off switch; this is the automatic lock for missing the first-visit deadline, and
   * is lifted from the Frozen Accounts page. See `accountFreezeService`.
   */
  isFrozen?: boolean;
  frozenAt?: string;
  frozenReason?: string;
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

  /**
   * Active delivery boys, for the rider pickers on the order and collection screens.
   * A rider with no `address.city` cannot be assigned an order — the backend refuses it — so
   * the callers surface `address.city` in the option label to make that visible up front.
   */
  async getRiders(): Promise<Employee[]> {
    const response = await api.get('/users?role=delivery_man&isActive=true');
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
