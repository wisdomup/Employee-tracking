import api from './api';

export interface OrderProduct {
  productId: any;
  quantity: number;
  price: number;
  /** Flat Rs. off this line's subtotal. */
  discount?: number;
}

export interface Order {
  _id: string;
  /** Sequential sale invoice number (server-assigned). */
  invoiceNumber?: number;
  products: OrderProduct[];
  totalPrice?: number;
  discount?: number;
  grandTotal?: number;
  paidAmount?: number;
  description?: string;
  /** Sanitized HTML; admin-only writes. */
  termsAndConditions?: string;
  status: 'pending' | 'approved' | 'packed' | 'dispatched' | 'delivered' | 'cancelled';
  paymentType?: 'online' | 'adjustment' | 'cash' | 'credit';
  orderDate?: string;
  deliveryDate?: string;
  dealerId: any;
  routeId?: any;
  /**
   * Shop visit this order was punched during ("Order Lena" while checked in). Absent for
   * orders raised from the Orders screen. The server refuses a visit the caller is not
   * checked in to, or whose client does not match.
   */
  visitId?: string;
  /**
   * Warehouse the stock came out of. Resolved from the salesman's city on create; only an admin can
   * change it, and doing so moves the reservation between warehouses.
   */
  warehouseId?: any;
  createdBy?: any;
  /** Populated user who approved (set when status becomes approved from pending). */
  approvedBy?: any;
  approvedAt?: string;
  /** Populated delivery boy this order was handed to. Riders see only their own. */
  assignedRiderId?: any;
  assignedAt?: string;
  /** Set by the assigned rider on approved -> packed. */
  packedAt?: string;
  /** Set by the assigned rider on packed -> delivered, alongside the collection entry. */
  deliveredAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const orderService = {
  /**
   * Change which warehouse an order draws its stock from. Applied as a compensating pair of
   * movements, so total stock is unchanged; refused if the new warehouse is short.
   */
  async setSourceWarehouse(id: string, warehouseId: string) {
    const response = await api.put(`/orders/${id}`, { warehouseId });
    return response.data;
  },

  async getOrders(filters?: {
    clientId?: string;
    routeId?: string;
    status?: string;
    createdBy?: string;
    /** A rider id, or the literal 'unassigned' for orders nobody is carrying yet. */
    assignedRiderId?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const params = new URLSearchParams();
    if (filters?.clientId) params.append('dealerId', filters.clientId);
    if (filters?.routeId) params.append('routeId', filters.routeId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.createdBy) params.append('createdBy', filters.createdBy);
    if (filters?.assignedRiderId) params.append('assignedRiderId', filters.assignedRiderId);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    const response = await api.get(`/orders?${params.toString()}`);
    return response.data;
  },

  async getOrder(id: string) {
    const response = await api.get(`/orders/${id}`);
    return response.data;
  },

  async createOrder(data: Partial<Order>) {
    const response = await api.post('/orders', data);
    return response.data;
  },

  async updateOrder(id: string, data: Partial<Order>) {
    const response = await api.put(`/orders/${id}`, data);
    return response.data;
  },

  async approveOrder(id: string, body?: { termsAndConditions?: string; assignedRiderId?: string }) {
    const response = await api.patch(`/orders/${id}/approve`, body ?? {});
    return response.data;
  },

  /** Assign, reassign, or (with `null`) take the order back off a rider. */
  async assignRider(id: string, assignedRiderId: string | null) {
    const response = await api.patch(`/orders/${id}/assign-rider`, { assignedRiderId });
    return response.data;
  },

  async deleteOrder(id: string) {
    const response = await api.delete(`/orders/${id}`);
    return response.data;
  },
};
