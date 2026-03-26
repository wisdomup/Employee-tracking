import api from './api';

export type BroadcastTarget = 'all' | 'employees' | 'clients' | 'customers';

export interface BroadcastNotification {
  _id: string;
  title: string;
  description?: string;
  broadcastTo: BroadcastTarget;
  startAt?: string;
  endAt?: string;
  createdBy?: any;
  createdAt: string;
  updatedAt: string;
}

export const broadcastNotificationService = {
  async getNotifications(filters?: { broadcastTo?: string }) {
    const params = new URLSearchParams();
    if (filters?.broadcastTo) params.append('broadcastTo', filters.broadcastTo);
    const response = await api.get(`/broadcast-notifications?${params.toString()}`);
    return response.data;
  },

  async getNotification(id: string) {
    const response = await api.get(`/broadcast-notifications/${id}`);
    return response.data;
  },

  async createNotification(data: Partial<BroadcastNotification>) {
    const response = await api.post('/broadcast-notifications', data);
    return response.data;
  },

  async updateNotification(id: string, data: Partial<BroadcastNotification>) {
    const response = await api.put(`/broadcast-notifications/${id}`, data);
    return response.data;
  },

  async deleteNotification(id: string) {
    const response = await api.delete(`/broadcast-notifications/${id}`);
    return response.data;
  },
};
