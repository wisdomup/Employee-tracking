import api from './api';

export type BroadcastAudienceType =
  | 'all'
  | 'all_employees'
  | 'role_order_taker'
  | 'role_delivery_man'
  | 'role_warehouse_manager'
  | 'specific_users';

export const BROADCAST_AUDIENCE_LABELS: Record<BroadcastAudienceType, string> = {
  all: 'Everyone (incl. admins)',
  all_employees: 'All employees (non-admin)',
  role_order_taker: 'Order takers',
  role_delivery_man: 'Delivery staff',
  role_warehouse_manager: 'Warehouse managers',
  specific_users: 'Specific users',
};

export interface BroadcastNotification {
  _id: string;
  title: string;
  description?: string;
  audienceType: BroadcastAudienceType;
  targetUserIds?: string[];
  /** @deprecated legacy API field */
  broadcastTo?: string;
  startAt?: string;
  endAt?: string;
  createdBy?: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface InboxBroadcastItem extends BroadcastNotification {
  read: boolean;
  readAt?: string;
}

export interface BroadcastInboxResponse {
  items: InboxBroadcastItem[];
  unreadCount: number;
}

/** Map API payload when older documents only had `broadcastTo`. */
export function audienceTypeFromApi(data: Pick<BroadcastNotification, 'audienceType' | 'broadcastTo'>): BroadcastAudienceType {
  if (data.audienceType) return data.audienceType;
  if (data.broadcastTo === 'all') return 'all';
  if (data.broadcastTo === 'employees') return 'all_employees';
  return 'all_employees';
}

export const broadcastNotificationService = {
  async getNotifications(filters?: { audienceType?: string }) {
    const params = new URLSearchParams();
    if (filters?.audienceType) params.append('audienceType', filters.audienceType);
    const q = params.toString();
    const response = await api.get(`/broadcast-notifications${q ? `?${q}` : ''}`);
    return response.data as BroadcastNotification[];
  },

  async getInbox(): Promise<BroadcastInboxResponse> {
    const response = await api.get('/broadcast-notifications/inbox');
    return response.data;
  },

  async markAsRead(id: string) {
    const response = await api.patch(`/broadcast-notifications/${id}/read`);
    return response.data;
  },

  async getNotification(id: string) {
    const response = await api.get(`/broadcast-notifications/${id}`);
    return response.data as BroadcastNotification;
  },

  async createNotification(data: {
    title: string;
    description?: string;
    audienceType: BroadcastAudienceType;
    targetUserIds?: string[];
    startAt?: string;
    endAt?: string;
  }) {
    const response = await api.post('/broadcast-notifications', data);
    return response.data;
  },

  async updateNotification(
    id: string,
    data: {
      title: string;
      description?: string;
      audienceType: BroadcastAudienceType;
      targetUserIds?: string[];
      startAt?: string;
      endAt?: string;
    },
  ) {
    const response = await api.put(`/broadcast-notifications/${id}`, data);
    return response.data;
  },

  async deleteNotification(id: string) {
    const response = await api.delete(`/broadcast-notifications/${id}`);
    return response.data;
  },
};
