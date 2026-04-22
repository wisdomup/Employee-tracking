import api from './api';

export interface OrderProduct {
  productId: any;
  quantity: number;
  price: number;
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
  createdBy?: any;
  /** Populated user who approved (set when status becomes approved from pending). */
  approvedBy?: any;
  approvedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export const orderService = {
  async getOrders(filters?: {
    clientId?: string;
    routeId?: string;
    status?: string;
    createdBy?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const params = new URLSearchParams();
    if (filters?.clientId) params.append('dealerId', filters.clientId);
    if (filters?.routeId) params.append('routeId', filters.routeId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.createdBy) params.append('createdBy', filters.createdBy);
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

  async approveOrder(id: string, body?: { termsAndConditions?: string }) {
    const response = await api.patch(`/orders/${id}/approve`, body ?? {});
    return response.data;
  },

  async deleteOrder(id: string) {
    const response = await api.delete(`/orders/${id}`);
    return response.data;
  },
};
