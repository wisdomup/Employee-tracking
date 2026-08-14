import api from './api';

/** Cash / online / credit, the shape used everywhere in this module. */
export interface Split {
  cash: number;
  online: number;
  credit: number;
}

export interface RiderBalance {
  cash: {
    collected: number;
    settled: number;
    pendingSettlement: number;
    inHand: number;
    availableToSettle: number;
  };
  online: {
    collected: number;
    settled: number;
    pendingSettlement: number;
    outstanding: number;
    availableToSettle: number;
  };
  creditIssuedOutstanding: number;
}

export interface RiderOrder {
  _id: string;
  invoiceNumber: number | null;
  status: 'approved' | 'packed' | 'dispatched' | 'delivered';
  grandTotal: number;
  paidAmount: number;
  productCount: number;
  orderDate: string | null;
  deliveryDate: string | null;
  assignedAt: string | null;
  packedAt: string | null;
  deliveredAt: string | null;
  collection: Split | null;
}

export interface RiderOrderGroup {
  dealer: {
    _id: string;
    name: string;
    shopName: string;
    phone: string;
    address: { street?: string; city?: string; state?: string; country?: string };
    latitude: number | null;
    longitude: number | null;
    hasLocation: boolean;
  };
  orders: RiderOrder[];
  totalAmount: number;
}

export interface RiderOrdersResponse {
  date: string;
  timezone: string;
  rider: { id: string; name: string; city: string; cityKey: string };
  counts: { assigned: number; packed: number; delivered: number; pending: number };
  groups: RiderOrderGroup[];
}

export interface DealerOutstanding {
  dealerId: string;
  creditTotal: number;
  recoveredTotal: number;
  outstanding: number;
}

export interface ReportRow {
  collectionId: string;
  orderId: string;
  invoiceNumber: number | null;
  dealerId: string;
  shop: string;
  riderId: string;
  rider: string;
  city: string;
  cityKey: string;
  amount: number;
  cash: number;
  online: number;
  credit: number;
  deliveredAt: string;
  note?: string | null;
  corrected: boolean;
  correctionCount: number;
}

export interface CollectionReport {
  from: string;
  to: string;
  timezone: string;
  filters: { riderId: string | null; cityKey: string | null };
  rows: ReportRow[];
  totals: { amount: number; cash: number; online: number; credit: number; count: number };
  cities: {
    cityKey: string;
    city: string;
    amount: number;
    cash: number;
    online: number;
    credit: number;
    count: number;
  }[];
  page: { page: number; limit: number; total: number; pages: number };
}

export interface ActivityRiderBlock {
  rider: { id: string; name: string; city: string; cityKey: string; isActive: boolean };
  counts: { assigned: number; packed: number; delivered: number; pending: number };
  collection: Split & { total: number };
  cashInHand: number;
  timeline: {
    orderId: string;
    invoiceNumber: number | null;
    shop: string;
    status: string;
    amount: number;
    assignedAt: string | null;
    packedAt: string | null;
    deliveredAt: string | null;
    cash: number | null;
    online: number | null;
    credit: number | null;
  }[];
  recoveries: {
    _id: string;
    dealerId: string;
    shop: string;
    amount: number;
    mode: 'cash' | 'online';
    note: string | null;
    collectedAt: string;
  }[];
}

export interface ActivityResponse {
  date: string;
  timezone: string;
  riders: ActivityRiderBlock[];
  totals: {
    assigned: number;
    packed: number;
    delivered: number;
    pending: number;
    cash: number;
    online: number;
    credit: number;
    total: number;
    cashInHand: number;
  };
}

export interface DayEndResponse {
  date: string;
  timezone: string;
  totals: { cash: number; online: number; credit: number; amount: number };
  counts: { delivered: number; pending: number; assigned: number };
  orders: {
    orderId: string;
    invoiceNumber: number | null;
    shop: string;
    rider: string;
    city: string;
    status: string;
    amount: number;
    cash: number | null;
    online: number | null;
    credit: number | null;
    packedAt: string | null;
    deliveredAt: string | null;
  }[];
}

export interface RecoveryRow {
  _id: string;
  dealerId: string;
  shop: string;
  riderId: string;
  rider: string;
  city: string;
  cityKey: string;
  amount: number;
  mode: 'cash' | 'online';
  note: string | null;
  collectedAt: string;
  corrected: boolean;
}

export interface SettlementRow {
  _id: string;
  riderId: string;
  rider: string;
  city: string;
  cityKey: string;
  mode: 'cash' | 'online';
  amount: number;
  status: 'pending' | 'received';
  screenshotUrl?: string;
  note?: string;
  submittedAt: string;
  receivedAt?: string;
  receivedBy?: string | null;
  autoReceived: boolean;
  corrected: boolean;
}

export interface RiderSummary {
  _id: string;
  username: string;
  fullName: string | null;
  userID: string | null;
  isActive: boolean;
  city: string;
  cityKey: string;
  cashInHand: number;
}

function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.append(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

export const collectionService = {
  // --- Rider ---------------------------------------------------------------

  async getMyOrders(params?: { date?: string; status?: string }): Promise<RiderOrdersResponse> {
    const response = await api.get(`/collections/my/orders${qs({ ...params })}`);
    return response.data;
  },

  async getMyBalance(): Promise<RiderBalance> {
    const response = await api.get('/collections/my/balance');
    return response.data;
  },

  async markPacked(orderId: string) {
    const response = await api.patch(`/collections/orders/${orderId}/packed`);
    return response.data;
  },

  async deliver(orderId: string, split: Split & { note?: string }) {
    const response = await api.post(`/collections/orders/${orderId}/deliver`, split);
    return response.data as { order: any; collection: any; balance: RiderBalance };
  },

  // --- Credit recovery -----------------------------------------------------

  async getDealerOutstanding(dealerId: string): Promise<DealerOutstanding> {
    const response = await api.get(`/collections/dealers/${dealerId}/outstanding`);
    return response.data;
  },

  async createRecovery(body: {
    dealerId: string;
    amount: number;
    mode: 'cash' | 'online';
    note?: string;
  }) {
    const response = await api.post('/collections/recoveries', body);
    return response.data as {
      recovery: RecoveryRow;
      dealerOutstanding: DealerOutstanding;
      balance: RiderBalance;
    };
  },

  async getRecoveries(params?: {
    riderId?: string;
    dealerId?: string;
    cityKey?: string;
    from?: string;
    to?: string;
  }) {
    const response = await api.get(`/collections/recoveries${qs({ ...params })}`);
    return response.data as {
      from: string;
      to: string;
      timezone: string;
      rows: RecoveryRow[];
      totals: { cash: number; online: number; total: number; count: number };
    };
  },

  // --- Settlement ----------------------------------------------------------

  async submitSettlement(body: {
    mode: 'cash' | 'online';
    amount: number;
    note?: string;
    screenshotUrl?: string;
  }) {
    const response = await api.post('/collections/settlements', body);
    return response.data as { settlement: SettlementRow; balance: RiderBalance };
  },

  async getSettlements(params?: {
    riderId?: string;
    status?: 'pending' | 'received';
    mode?: 'cash' | 'online';
    cityKey?: string;
    from?: string;
    to?: string;
  }) {
    const response = await api.get(`/collections/settlements${qs({ ...params })}`);
    return response.data as {
      from: string;
      to: string;
      timezone: string;
      rows: SettlementRow[];
      totals: {
        pendingCash: number;
        pendingOnline: number;
        receivedCash: number;
        receivedOnline: number;
      };
    };
  },

  async receiveSettlement(id: string, note?: string) {
    const response = await api.patch(`/collections/settlements/${id}/receive`, note ? { note } : {});
    return response.data as { settlement: SettlementRow; riderBalance: RiderBalance };
  },

  // --- Admin corrections ---------------------------------------------------

  async correctCollection(id: string, body: Split & { reason?: string }) {
    const response = await api.patch(`/collections/${id}`, body);
    return response.data;
  },

  async voidCollection(id: string, reason: string) {
    const response = await api.post(`/collections/${id}/void`, { reason });
    return response.data;
  },

  async voidRecovery(id: string, reason: string) {
    const response = await api.post(`/collections/recoveries/${id}/void`, { reason });
    return response.data;
  },

  async voidSettlement(id: string, reason: string) {
    const response = await api.post(`/collections/settlements/${id}/void`, { reason });
    return response.data;
  },

  // --- Reports -------------------------------------------------------------

  async getReport(params?: {
    riderId?: string;
    cityKey?: string;
    from?: string;
    to?: string;
    page?: number;
    limit?: number;
  }): Promise<CollectionReport> {
    const response = await api.get(`/collections/report${qs({ ...params })}`);
    return response.data;
  },

  async getActivity(params?: { riderId?: string; date?: string }): Promise<ActivityResponse> {
    const response = await api.get(`/collections/activity${qs({ ...params })}`);
    return response.data;
  },

  async getDayEnd(params?: {
    riderId?: string;
    cityKey?: string;
    date?: string;
  }): Promise<DayEndResponse> {
    const response = await api.get(`/collections/day-end${qs({ ...params })}`);
    return response.data;
  },

  async getRiders(): Promise<RiderSummary[]> {
    const response = await api.get('/collections/riders');
    return response.data;
  },
};
