import api from './api';

const apiBase =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/api\/?$/, '') || 'http://localhost:8001'
    : '';

export function getVisitCompletionImageUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return `${apiBase}/api${url.startsWith('/') ? '' : '/'}${url}`;
}

export interface VisitCompletionImage {
  type: 'shop' | 'selfie';
  url: string;
}

export interface Visit {
  _id: string;
  dealerId: any;
  employeeId: any;
  routeId?: any;
  visitDate?: string;
  status: 'todo' | 'in_progress' | 'completed' | 'incomplete' | 'cancelled';
  completedAt?: string;
  latitude?: number;
  longitude?: number;
  completionImages?: VisitCompletionImage[];
  createdBy?: { _id: string; username?: string; userID?: string; role?: string };
  createdAt: string;
  updatedAt: string;
}

export const visitService = {
  async getVisits(filters?: {
    clientId?: string;
    employeeId?: string;
    routeId?: string;
    status?: string;
    startDate?: string;
    endDate?: string;
  }) {
    const params = new URLSearchParams();
    if (filters?.clientId) params.append('dealerId', filters.clientId);
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.routeId) params.append('routeId', filters.routeId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    const response = await api.get(`/visits?${params.toString()}`);
    return response.data;
  },

  async getVisit(id: string) {
    const response = await api.get(`/visits/${id}`);
    return response.data;
  },

  async createVisit(data: Partial<Visit>) {
    const response = await api.post('/visits', data);
    return response.data;
  },

  async createVisitsForRoute(routeId: string): Promise<{ created: number; skipped: number; markedIncomplete: number }> {
    const response = await api.post('/visits/create-for-route', { routeId });
    return response.data;
  },

  async updateVisit(id: string, data: Partial<Visit>) {
    const response = await api.put(`/visits/${id}`, data);
    return response.data;
  },

  async deleteVisit(id: string) {
    const response = await api.delete(`/visits/${id}`);
    return response.data;
  },

  async completeVisit(
    visitId: string,
    data: { latitude: number; longitude: number; completionImages: VisitCompletionImage[] },
  ) {
    const response = await api.patch(`/visits/${visitId}/complete`, data);
    return response.data;
  },
};
