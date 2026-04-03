import api from './api';

export interface RouteRef {
  _id: string;
  name?: string;
  startingPoint?: string;
  endingPoint?: string;
}

export interface Client {
  _id: string;
  name: string; // client/person name
  shopName?: string; // shop/business name
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

/** Route assigned to the dealer on the dealer record (`/dealers` populates `route`). */
export function getClientAssignedRouteId(client: Client | undefined | null): string {
  if (!client?.route) return '';
  if (typeof client.route === 'string') return client.route;
  return client.route._id ?? '';
}

export const clientService = {
  async getClients(filters?: { status?: string; search?: string; routeId?: string }) {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.routeId) params.append('routeId', filters.routeId);

    const response = await api.get(`/dealers?${params.toString()}`);
    return response.data;
  },

  async getClient(id: string) {
    const response = await api.get(`/dealers/${id}`);
    return response.data;
  },

  async createClient(data: Partial<Client>) {
    const response = await api.post('/dealers', data);
    return response.data;
  },

  async updateClient(id: string, data: Partial<Client>) {
    const response = await api.put(`/dealers/${id}`, data);
    return response.data;
  },

  async deleteClient(id: string) {
    const response = await api.delete(`/dealers/${id}`);
    return response.data;
  },
};
