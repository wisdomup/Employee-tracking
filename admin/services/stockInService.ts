import api from './api';

/**
 * Stock In receipts and one-time opening stock — the two ways stock enters the system.
 *
 * Stock In always lands in the Main warehouse, so there is no destination to choose. A wrong
 * receipt has three admin-only exits: cancel (keeps the row), edit (rewrites the lines, keeps the
 * document number) and delete (reverses and hides it). All three refuse if the pieces have
 * already left Main.
 */

export interface StockReceiptLine {
  /** Populated Product when it comes back from the API. */
  productId: any;
  quantity: number;
  rate: number;
}

export interface StockReceipt {
  _id: string;
  documentNo?: number;
  receiptDate: string;
  supplierName?: string;
  warehouseId: any;
  products: StockReceiptLine[];
  totalPieces: number;
  totalAmount: number;
  status: 'posted' | 'cancelled';
  notes?: string;
  cancelledBy?: any;
  cancelledAt?: string;
  cancelReason?: string;
  /** Correction trail — set once an admin has edited the receipt. */
  lastEditedBy?: any;
  lastEditedAt?: string;
  editReason?: string;
  editCount?: number;
  createdBy?: any;
  createdAt: string;
  updatedAt: string;
}

export interface StockReceiptSlip {
  kind: 'stock-in';
  documentNo: number | null;
  receiptDate: string;
  supplierName: string | null;
  notes: string | null;
  status: string;
  cancelReason: string | null;
  warehouseName: string;
  warehouseCity: string;
  warehouseAddress: string;
  preparedBy: string;
  cancelledByName: string | null;
  totalPieces: number;
  /** Null for non-admins — the total value is cost data. */
  totalAmount: number | null;
  lines: {
    productName: string;
    barcode: string;
    quantity: number;
    rate: number;
    amount: number;
  }[];
}

export interface LastPurchaseRateInfo {
  productId: string;
  productName: string;
  lastPurchaseRate: number | null;
  lastReceiptDate: string | null;
  lastSupplierName: string | null;
  /** Admin only. */
  avgCost?: number;
}

export interface OpeningStockEntry {
  _id: string;
  warehouseId: any;
  productId: any;
  sellableQty: number;
  damagedQty: number;
  rate: number;
  effectiveAt: string;
  status: 'posted' | 'cancelled';
  cancelReason?: string;
  createdBy?: any;
  createdAt: string;
}

export interface OpeningStockStatus {
  warehouseId: string;
  locked: boolean;
  productCount: number;
  submittedAt: string | null;
  submittedBy: any;
  /** Products already covered — the setup screen greys these rows out. */
  postedProductIds: string[];
}

/** One posted (warehouse, product) figure, as the all-warehouse grid needs it. */
export interface OpeningStockCell {
  _id: string;
  warehouseId: string;
  productId: string;
  sellableQty: number;
  damagedQty: number;
  rate: number;
  effectiveAt?: string;
}

export interface OpeningStockMatrixResult {
  message: string;
  created: number;
  updated: number;
  skipped: number;
  /** Cells whose stock could not move. The rest of the save still landed. */
  failed: { warehouseId: string; productId?: string; message: string }[];
}

export const stockInService = {
  async getReceipts(filters?: {
    startDate?: string;
    endDate?: string;
    supplierName?: string;
    productId?: string;
    status?: string;
  }): Promise<StockReceipt[]> {
    const params = new URLSearchParams();
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.supplierName) params.append('supplierName', filters.supplierName);
    if (filters?.productId) params.append('productId', filters.productId);
    if (filters?.status) params.append('status', filters.status);
    const response = await api.get(`/warehouse/stock-receipts?${params.toString()}`);
    return response.data;
  },

  async getReceipt(id: string): Promise<StockReceipt> {
    const response = await api.get(`/warehouse/stock-receipts/${id}`);
    return response.data;
  },

  async getReceiptSlip(id: string): Promise<StockReceiptSlip> {
    const response = await api.get(`/warehouse/stock-receipts/${id}/slip`);
    return response.data;
  },

  async createReceipt(data: {
    receiptDate: string;
    supplierName?: string;
    notes?: string;
    products: { productId: string; quantity: number; rate: number }[];
  }): Promise<StockReceipt> {
    const response = await api.post('/warehouse/stock-receipts', data);
    return response.data;
  },

  /**
   * Correct a posted receipt. The whole line set is replaced and the ledger is reversed and
   * re-posted underneath, so a corrected rate leaves the product's average cost. Admin only,
   * and `reason` is mandatory — the old figures were already printed on a slip.
   */
  async updateReceipt(
    id: string,
    data: {
      receiptDate: string;
      supplierName?: string;
      notes?: string;
      reason: string;
      products: { productId: string; quantity: number; rate: number }[];
    },
  ): Promise<StockReceipt> {
    const response = await api.put(`/warehouse/stock-receipts/${id}`, data);
    return response.data;
  },

  /** Reverse a wrong receipt and hide it. Admin only. */
  async deleteReceipt(id: string, reason?: string): Promise<{ message: string }> {
    const response = await api.delete(`/warehouse/stock-receipts/${id}`, {
      data: reason ? { reason } : {},
    });
    return response.data;
  },

  async cancelReceipt(id: string, reason: string): Promise<StockReceipt> {
    const response = await api.patch(`/warehouse/stock-receipts/${id}/cancel`, { reason });
    return response.data;
  },

  async getLastPurchaseRate(productId: string): Promise<LastPurchaseRateInfo> {
    const response = await api.get(`/warehouse/products/${productId}/last-purchase-rate`);
    return response.data;
  },

  async getOpeningStockStatus(warehouseId: string): Promise<OpeningStockStatus> {
    const response = await api.get(`/warehouse/opening-stock/status/${warehouseId}`);
    return response.data;
  },

  async getOpeningStock(filters?: { warehouseId?: string; status?: string }): Promise<OpeningStockEntry[]> {
    const params = new URLSearchParams();
    if (filters?.warehouseId) params.append('warehouseId', filters.warehouseId);
    if (filters?.status) params.append('status', filters.status);
    const response = await api.get(`/warehouse/opening-stock?${params.toString()}`);
    return response.data;
  },

  async postOpeningStock(data: {
    warehouseId: string;
    effectiveAt?: string;
    lines: { productId: string; sellableQty: number; damagedQty?: number; rate?: number }[];
  }): Promise<{ message: string; count: number }> {
    const response = await api.post('/warehouse/opening-stock', data);
    return response.data;
  },

  /** Every posted cell, for the product × warehouse grid. */
  async getOpeningStockMatrix(): Promise<OpeningStockCell[]> {
    const response = await api.get('/warehouse/opening-stock/matrix');
    return response.data;
  },

  /**
   * Save the grid. Send only the cells that were touched — the API decides per cell whether that
   * means a first entry or a correction, and reports anything it could not apply in `failed`.
   */
  async saveOpeningStockMatrix(data: {
    effectiveAt?: string;
    reason?: string;
    cells: {
      warehouseId: string;
      productId: string;
      sellableQty: number;
      damagedQty: number;
      rate?: number;
    }[];
  }): Promise<OpeningStockMatrixResult> {
    const response = await api.post('/warehouse/opening-stock/matrix', data);
    return response.data;
  },

  /**
   * Correct one entry's figures. The old movement is reversed and the new one posted, so a
   * corrected rate carries through to the product's average cost.
   */
  async updateOpeningStock(
    id: string,
    data: { sellableQty: number; damagedQty: number; rate?: number; reason?: string },
  ): Promise<OpeningStockEntry> {
    const response = await api.put(`/warehouse/opening-stock/${id}`, data);
    return response.data;
  },

  async cancelOpeningStock(id: string, reason: string): Promise<OpeningStockEntry> {
    const response = await api.patch(`/warehouse/opening-stock/${id}/cancel`, { reason });
    return response.data;
  },
};
