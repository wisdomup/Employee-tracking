import api from './api';

export type TrashModule =
  | 'employee'
  | 'client'
  | 'product'
  | 'category'
  | 'route'
  | 'order'
  | 'return'
  | 'visit';

export interface TrashItem {
  module: TrashModule;
  entityId: string;
  label: string;
  trashedAt?: string;
  trashedBy?: { username?: string; userID?: string; phone?: string };
  meta?: Record<string, unknown>;
}

const MODULE_API_MAP: Record<TrashModule, string> = {
  employee: 'users',
  client: 'clients',
  product: 'products',
  category: 'categories',
  route: 'routes',
  order: 'orders',
  return: 'returns',
  visit: 'visits',
};

export const trashService = {
  async getTrashItems(filters?: {
    module?: TrashModule | 'all';
    startDate?: string;
    endDate?: string;
    search?: string;
  }) {
    const params = new URLSearchParams();
    if (filters?.module && filters.module !== 'all') params.append('module', filters.module);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.search) params.append('search', filters.search);
    const response = await api.get(`/trash?${params.toString()}`);
    return response.data as TrashItem[];
  },

  async restore(module: TrashModule, id: string) {
    const apiModule = MODULE_API_MAP[module];
    const response = await api.patch(`/${apiModule}/${id}/restore`);
    return response.data;
  },

  async permanentDelete(module: TrashModule, id: string) {
    const apiModule = MODULE_API_MAP[module];
    const response = await api.delete(`/${apiModule}/${id}/permanent`);
    return response.data;
  },

  async bulkPermanentDelete(items: { module: TrashModule; entityId: string }[]) {
    const response = await api.post('/trash/bulk-delete', { items });
    return response.data;
  },
};
