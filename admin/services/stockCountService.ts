import api from './api';

/**
 * Monthly stock count.
 *
 * The rule to remember when reading these numbers: approval applies
 * `counted − systemAtSubmission` as a delta, not an absolute overwrite, so a sale that happens while
 * the sheet is awaiting approval is not erased. The API reports any such drift back on approval.
 */

export interface StockCountLine {
  /** Populated Product when it comes back from the API. */
  productId: any;
  /** System figures as at SUBMISSION — the numbers the counter was looking at. */
  systemSellable: number;
  systemDamaged: number;
  countedSellable: number;
  countedDamaged: number;
  note?: string;
}

export type StockCountStatus = 'draft' | 'submitted' | 'approved' | 'rejected' | 'cancelled';

export const STOCK_COUNT_STATUS_LABELS: Record<StockCountStatus, string> = {
  draft: 'Draft',
  submitted: 'Awaiting approval',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export interface StockCount {
  _id: string;
  documentNo?: number;
  warehouseId: any;
  periodMonth: string;
  lines: StockCountLine[];
  status: StockCountStatus;
  submittedBy?: any;
  submittedAt?: string;
  approvedBy?: any;
  approvedAt?: string;
  rejectedBy?: any;
  rejectedAt?: string;
  rejectionReason?: string;
  cancelledBy?: any;
  cancelledAt?: string;
  cancelReason?: string;
  createdBy?: any;
  createdAt: string;
  updatedAt: string;
}

export interface CountSheetRow {
  productId: string;
  productName: string;
  barcode: string;
  systemSellable: number;
  systemDamaged: number;
}

export interface CountSheet {
  warehouseId: string;
  periodMonth: string;
  rows: CountSheetRow[];
}

/** Lines whose live figure moved between submission and approval. */
export interface StockCountDrift {
  productId: string;
  bucket: 'sellable' | 'damaged';
  systemAtSubmission: number;
  systemNow: number;
}

export interface CountReportRow {
  countId: string;
  documentNo: number | null;
  periodMonth: string;
  warehouseName: string;
  productName: string;
  barcode: string;
  systemSellable: number;
  countedSellable: number;
  diffSellable: number;
  systemDamaged: number;
  countedDamaged: number;
  diffDamaged: number;
  note: string;
  status: string;
  approvedByName: string;
}

export const stockCountService = {
  async getCounts(filters?: {
    warehouseId?: string;
    status?: string;
    periodMonth?: string;
  }): Promise<StockCount[]> {
    const params = new URLSearchParams();
    if (filters?.warehouseId) params.append('warehouseId', filters.warehouseId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.periodMonth) params.append('periodMonth', filters.periodMonth);
    const response = await api.get(`/warehouse/stock-counts?${params.toString()}`);
    return response.data;
  },

  async getCount(id: string): Promise<StockCount> {
    const response = await api.get(`/warehouse/stock-counts/${id}`);
    return response.data;
  },

  /** Blank sheet: every product the warehouse holds, with the system figures to count against. */
  async getCountSheet(warehouseId: string): Promise<CountSheet> {
    const response = await api.get(`/warehouse/stock-counts/sheet/${warehouseId}`);
    return response.data;
  },

  async openCount(warehouseId: string, periodMonth?: string): Promise<StockCount> {
    const response = await api.post('/warehouse/stock-counts', {
      warehouseId,
      ...(periodMonth ? { periodMonth } : {}),
    });
    return response.data;
  },

  async saveCount(
    id: string,
    lines: { productId: string; countedSellable: number; countedDamaged: number; note?: string }[],
  ): Promise<StockCount> {
    const response = await api.put(`/warehouse/stock-counts/${id}`, { lines });
    return response.data;
  },

  async submitCount(id: string): Promise<StockCount> {
    const response = await api.patch(`/warehouse/stock-counts/${id}/submit`);
    return response.data;
  },

  async approveCount(id: string): Promise<{ count: StockCount; drift: StockCountDrift[] }> {
    const response = await api.patch(`/warehouse/stock-counts/${id}/approve`);
    return response.data;
  },

  async rejectCount(id: string, reason: string): Promise<StockCount> {
    const response = await api.patch(`/warehouse/stock-counts/${id}/reject`, { reason });
    return response.data;
  },

  async cancelCount(id: string, reason: string): Promise<StockCount> {
    const response = await api.patch(`/warehouse/stock-counts/${id}/cancel`, { reason });
    return response.data;
  },

  async getReport(filters?: {
    warehouseId?: string;
    status?: string;
    periodMonth?: string;
  }): Promise<CountReportRow[]> {
    const params = new URLSearchParams();
    if (filters?.warehouseId) params.append('warehouseId', filters.warehouseId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.periodMonth) params.append('periodMonth', filters.periodMonth);
    const response = await api.get(`/warehouse/stock-counts/report?${params.toString()}`);
    return response.data;
  },
};

export interface ValuationReport {
  period: { startDate: string | null; endDate: string | null };
  summary: {
    totalSellablePieces: number;
    totalDamagedPieces: number;
    totalInTransitPieces: number;
    lowStockProductCount: number;
    /** Admin only — absent, not zero, for other roles. */
    currentStockValue?: number;
    damagedStockValue?: number;
    grossProfitInPeriod?: number;
    potentialSaleValue: number;
    unitsSoldInPeriod: number;
    salesRevenueInPeriod: number;
  };
  bestSellers: {
    productId: string;
    productName: string;
    barcode: string;
    qtySold: number;
    revenue: number;
    currentSellableQty: number;
  }[];
}

export const warehouseReportService = {
  async getValuation(filters?: {
    startDate?: string;
    endDate?: string;
    warehouseId?: string;
    categoryId?: string;
  }): Promise<ValuationReport> {
    const params = new URLSearchParams();
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.warehouseId) params.append('warehouseId', filters.warehouseId);
    if (filters?.categoryId) params.append('categoryId', filters.categoryId);
    const response = await api.get(`/warehouse/reports/valuation?${params.toString()}`);
    return response.data;
  },
};
