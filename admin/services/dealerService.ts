import api from './api';

export interface RouteRef {
  _id: string;
  name?: string;
  startingPoint?: string;
  endingPoint?: string;
}

export interface Dealer {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  address?: {
    street?: string;
    city?: string;
    state?: string;
    country?: string;
    postalCode?: string;
  };
  latitude?: number;
  longitude?: number;
  shopImage?: string;
  profilePicture?: string;
  category?: string;
  rating?: number;
  status: 'active' | 'inactive';
  route?: string | RouteRef;
  createdBy?: { _id: string; username?: string; userID?: string; role?: string };
  createdAt: string;
  updatedAt: string;
}

export const dealerService = {
  async getDealers(filters?: { status?: string; search?: string; routeId?: string }) {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.routeId) params.append('routeId', filters.routeId);

    const response = await api.get(`/dealers?${params.toString()}`);
    return response.data;
  },

  async getDealer(id: string) {
    const response = await api.get(`/dealers/${id}`);
    return response.data;
  },

  async createDealer(data: Partial<Dealer>) {
    const response = await api.post('/dealers', data);
    return response.data;
  },

  async updateDealer(id: string, data: Partial<Dealer>) {
    const response = await api.put(`/dealers/${id}`, data);
    return response.data;
  },

  async deleteDealer(id: string) {
    const response = await api.delete(`/dealers/${id}`);
    return response.data;
  },
};
