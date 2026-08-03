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

/** Mirrors VISIT_DURATION_LIMIT_MINUTES on the backend. */
export const VISIT_DURATION_LIMIT_MINUTES = 30;

/** Mirrors VISIT_COMPLETION_THRESHOLD_PERCENT on the backend. */
export const VISIT_COMPLETION_THRESHOLD_PERCENT = 75;

export interface SkipPreview {
  threshold: number;
  currentRate: number;
  projectedRate: number;
  wouldDropBelowThreshold: boolean;
  assigned: number;
  completed: number;
  skipped: number;
  stillOpen: number;
  /** Non-null when the visit cannot be skipped in its current status. */
  blockedReason: string | null;
}

export interface SkipResult {
  skipped: boolean;
  requiresConfirmation: boolean;
  flagged?: boolean;
  threshold: number;
  currentRate: number;
  projectedRate: number;
  message?: string;
  visit?: Visit;
}

/** Mirrors CHECK_IN_RADIUS_METRES on the backend. */
export const CHECK_IN_RADIUS_METRES = 150;

export interface VisitCompletionImage {
  type: 'shop' | 'selfie';
  url: string;
}

/** Optional extra shop photo added by a rider after checkout. */
export interface VisitGalleryImage {
  url: string;
  caption?: string;
}

/** One shop-gallery entry: photos/notes plus the rider and visit they came from. */
export interface DealerGalleryEntry {
  _id: string;
  dealerId: any;
  employeeId: any;
  visitDate?: string;
  completedAt?: string;
  galleryImages?: VisitGalleryImage[];
  visitNotes?: string;
  galleryUpdatedAt?: string;
}

export interface Visit {
  _id: string;
  dealerId: any;
  employeeId: any;
  routeId?: any;
  visitDate?: string;
  status: 'todo' | 'in_progress' | 'checked_in' | 'completed' | 'skipped' | 'incomplete' | 'cancelled';
  skippedAt?: string;
  skipReason?: string;
  /** True when the rider started this visit themselves rather than it being assigned. */
  isSelfInitiated?: boolean;
  checkedInAt?: string;
  checkedInLatitude?: number;
  checkedInLongitude?: number;
  /** Checkout time. */
  completedAt?: string;
  /** Minutes between check-in and checkout. */
  durationMinutes?: number;
  /** True when the stay exceeded VISIT_DURATION_LIMIT_MINUTES. */
  overstayFlagged?: boolean;
  latitude?: number;
  longitude?: number;
  completionImages?: VisitCompletionImage[];
  galleryImages?: VisitGalleryImage[];
  visitNotes?: string;
  galleryUpdatedAt?: string;
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
    overstayFlagged?: boolean;
  }) {
    const params = new URLSearchParams();
    if (filters?.clientId) params.append('dealerId', filters.clientId);
    if (filters?.employeeId) params.append('employeeId', filters.employeeId);
    if (filters?.routeId) params.append('routeId', filters.routeId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.overstayFlagged) params.append('overstayFlagged', 'true');
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

  async bulkCreateVisits(data: {
    employeeId: string;
    visitDate: string;
    dealerIds: string[];
    routeId?: string;
  }): Promise<Visit[]> {
    const response = await api.post('/visits/bulk', data);
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

  async checkInVisit(
    visitId: string,
    data: { latitude: number; longitude: number },
  ) {
    const response = await api.patch(`/visits/${visitId}/check-in`, data);
    return response.data;
  },

  /**
   * Start a visit for any client the rider can see, without a route assignment.
   * If a visit for this client already exists today it is returned instead of a
   * duplicate (`created: false`).
   */
  async startSelfVisit(dealerId: string): Promise<{ visit: Visit; created: boolean }> {
    const response = await api.post('/visits/self', { dealerId });
    return response.data;
  },

  /** What skipping this visit would do to today's completion rate. Read-only. */
  async previewSkip(visitId: string): Promise<SkipPreview> {
    const response = await api.get(`/visits/${visitId}/skip-preview`);
    return response.data;
  },

  /**
   * Skip a visit. Without `confirm`, a skip that would drop the day below the required
   * completion rate returns `requiresConfirmation` and changes nothing.
   */
  async skipVisit(
    visitId: string,
    data: { reason?: string; confirm?: boolean },
  ): Promise<SkipResult> {
    const response = await api.patch(`/visits/${visitId}/skip`, data);
    return response.data;
  },

  /** Attach optional shop photos / notes to an already completed visit. */
  async updateVisitGallery(
    visitId: string,
    data: { galleryImages?: VisitGalleryImage[]; visitNotes?: string },
  ): Promise<Visit> {
    const response = await api.patch(`/visits/${visitId}/gallery`, data);
    return response.data;
  },

  /** All shop photos / notes recorded for a client, with the rider who added them. */
  async getDealerGallery(dealerId: string): Promise<DealerGalleryEntry[]> {
    const response = await api.get(`/visits/gallery?dealerId=${encodeURIComponent(dealerId)}`);
    return response.data;
  },
};
