import api from './api';

export interface Route {
  _id: string;
  name: string;
  startingPoint: string;
  endingPoint: string;
  /** Present on GET /routes/:id — clients linked via client.route */
  clientCount?: number;
  createdBy?: { _id: string; username?: string; userID?: string; role?: string };
  assignedEmployee?: { username?: string; userID?: string } | null;
  createdAt: string;
  updatedAt: string;
}

export const routeService = {
  async getRoutes(search?: string) {
    const params = new URLSearchParams();
    if (search) params.append('search', search);
    const response = await api.get(`/routes?${params.toString()}`);
    return response.data;
  },

  async getRoute(id: string) {
    const response = await api.get(`/routes/${id}`);
    return response.data;
  },

  async createRoute(data: Omit<Route, '_id' | 'createdAt' | 'updatedAt'>) {
    const response = await api.post('/routes', data);
    return response.data;
  },

  async updateRoute(id: string, data: Partial<Omit<Route, '_id' | 'createdAt' | 'updatedAt'>>) {
    const response = await api.put(`/routes/${id}`, data);
    return response.data;
  },

  async deleteRoute(id: string) {
    const response = await api.delete(`/routes/${id}`);
    return response.data;
  },
};
