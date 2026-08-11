import api from './api';

/**
 * Warehouse master data + the current-stock read model.
 *
 * Everything in the warehouse module is mounted under `/warehouse` on the API, so these paths are
 * relative to that: `/warehouse/warehouses`, `/warehouse/stock`, and so on.
 */

export interface Warehouse {
  _id: string;
  name: string;
  city: string;
  cityKey?: string;
  address?: string;
  /** Populated User when it comes back from the API. */
  managerId?: any;
  /** All Stock In lands here. Exactly one warehouse holds this flag. */
  isMain: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One row per (warehouse, product) with stock on hand split by bucket. */
export interface StockRow {
  warehouseId: string;
  warehouseName: string;
  warehouseCity?: string;
  isMainWarehouse: boolean;
  productId: string;
  productName: string;
  barcode: string;
  categoryId?: string;
  categoryName?: string;
  sellable: number;
  damaged: number;
  inTransit: number;
  totalSellableAllWarehouses: number;
  survivalQuantity: number | null;
  isLow: boolean;
  salePrice: number;
  /** Admin only — absent for every other role. */
  avgCost?: number;
  lastPurchaseRate?: number;
  stockValue?: number;
  potentialSaleValue: number;
  lastMovementAt?: string;
}

export interface StockMovementRow {
  _id: string;
  warehouseId: any;
  productId: any;
  bucket: 'sellable' | 'damaged' | 'in_transit';
  delta: number;
  balanceAfter?: number;
  type: string;
  refType: string;
  refId?: string;
  unitCost?: number;
  reason?: string;
  actorId?: any;
  occurredAt: string;
}

export interface StockFilters {
  warehouseId?: string;
  productId?: string;
  categoryId?: string;
  search?: string;
  lowOnly?: boolean;
  includeEmpty?: boolean;
}

export interface MovementFilters {
  productId?: string;
  warehouseId?: string;
  bucket?: string;
  type?: string;
  refType?: string;
  startDate?: string;
  endDate?: string;
  limit?: number;
}

/** One product's corrected figures. Absolute piece counts, not deltas. */
export interface StockAdjustmentLine {
  productId: string;
  sellable?: number;
  damaged?: number;
}

export interface StockAdjustmentResult {
  warehouseId: string;
  adjustedProducts: number;
  movements: number;
  changes: {
    productId: string;
    productName: string;
    bucket: 'sellable' | 'damaged';
    from: number;
    to: number;
    delta: number;
  }[];
}

export const warehouseService = {
  async getWarehouses(filters?: { search?: string; city?: string; isActive?: boolean }): Promise<Warehouse[]> {
    const params = new URLSearchParams();
    if (filters?.search) params.append('search', filters.search);
    if (filters?.city) params.append('city', filters.city);
    if (filters?.isActive !== undefined) params.append('isActive', String(filters.isActive));
    const response = await api.get(`/warehouse/warehouses?${params.toString()}`);
    return response.data;
  },

  async getWarehouse(id: string): Promise<Warehouse> {
    const response = await api.get(`/warehouse/warehouses/${id}`);
    return response.data;
  },

  /** The warehouse every Stock In lands in. Used to label the read-only destination on that form. */
  async getMainWarehouse(): Promise<Warehouse | null> {
    const response = await api.get('/warehouse/warehouses/main');
    return response.data;
  },

  async createWarehouse(data: Partial<Warehouse>): Promise<Warehouse> {
    const response = await api.post('/warehouse/warehouses', data);
    return response.data;
  },

  async updateWarehouse(id: string, data: Partial<Warehouse>): Promise<Warehouse> {
    const response = await api.put(`/warehouse/warehouses/${id}`, data);
    return response.data;
  },

  async setMainWarehouse(id: string): Promise<Warehouse> {
    const response = await api.patch(`/warehouse/warehouses/${id}/set-main`);
    return response.data;
  },

  async deleteWarehouse(id: string): Promise<{ message: string }> {
    const response = await api.delete(`/warehouse/warehouses/${id}`);
    return response.data;
  },

  async getStock(filters?: StockFilters): Promise<StockRow[]> {
    const params = new URLSearchParams();
    if (filters?.warehouseId) params.append('warehouseId', filters.warehouseId);
    if (filters?.productId) params.append('productId', filters.productId);
    if (filters?.categoryId) params.append('categoryId', filters.categoryId);
    if (filters?.search) params.append('search', filters.search);
    if (filters?.lowOnly) params.append('lowOnly', 'true');
    if (filters?.includeEmpty) params.append('includeEmpty', 'true');
    const response = await api.get(`/warehouse/stock?${params.toString()}`);
    return response.data;
  },

  /**
   * Correct stock in place from the warehouse detail page. Admin only; the reason is recorded on
   * every ledger row the correction writes. In-transit is not adjustable — that bucket belongs to
   * the transfer documents.
   */
  async adjustStock(payload: {
    warehouseId: string;
    reason: string;
    lines: StockAdjustmentLine[];
  }): Promise<StockAdjustmentResult> {
    const response = await api.post('/warehouse/stock/adjust', payload);
    return response.data;
  },

  async getMovements(filters?: MovementFilters): Promise<StockMovementRow[]> {
    const params = new URLSearchParams();
    if (filters?.productId) params.append('productId', filters.productId);
    if (filters?.warehouseId) params.append('warehouseId', filters.warehouseId);
    if (filters?.bucket) params.append('bucket', filters.bucket);
    if (filters?.type) params.append('type', filters.type);
    if (filters?.refType) params.append('refType', filters.refType);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.limit) params.append('limit', String(filters.limit));
    const response = await api.get(`/warehouse/stock/movements?${params.toString()}`);
    return response.data;
  },

  async getIntegrity(): Promise<{ clean: boolean; driftCount: number; rows: unknown[] }> {
    const response = await api.get('/warehouse/maintenance/integrity');
    return response.data;
  },
};

/** Options for a `SearchableSelect`. Main first, then alphabetical — Main is the common answer. */
export function warehouseSelectOptions(
  list: Warehouse[],
  opts?: { includeAll?: boolean; allLabel?: string },
): { value: string; label: string }[] {
  const options = [...list]
    .sort((a, b) => Number(b.isMain) - Number(a.isMain) || a.name.localeCompare(b.name))
    .map((w) => ({ value: w._id, label: formatWarehouseLabel(w) }));

  return opts?.includeAll
    ? [{ value: '', label: opts.allLabel ?? 'All Warehouses' }, ...options]
    : options;
}

/** Mirrors `formatClientSelectLabel` in clientService — name plus the disambiguating detail. */
export function formatWarehouseLabel(w: Warehouse): string {
  const parts = [w.name];
  if (w.city) parts.push(w.city);
  const label = parts.join(' — ');
  if (w.isMain) return `${label} (Main)`;
  if (!w.isActive) return `${label} (Inactive)`;
  return label;
}

/** Human labels for the ledger's movement types, used in the movement-history report. */
export const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  opening_stock: 'Opening Stock',
  stock_in: 'Stock In',
  stock_in_reversal: 'Stock In Cancelled',
  sale_out: 'Sale',
  sale_return_in: 'Sale Reversed',
  customer_return_in: 'Customer Return',
  customer_return_reversal: 'Customer Return Reversed',
  damage_marked: 'Damage / Claim',
  damage_reversal: 'Damage Reversed',
  transfer_out: 'Transfer Out',
  transfer_out_reversal: 'Transfer Out Reversed',
  transfer_in: 'Transfer In',
  transfer_in_reversal: 'Transfer In Reversed',
  transfer_shrinkage: 'Transfer Shortfall Written Off',
  count_adjustment: 'Stock Count Adjustment',
  manual_adjustment: 'Manual Adjustment',
};

export const BUCKET_LABELS: Record<string, string> = {
  sellable: 'Sellable',
  damaged: 'Damaged / Claim',
  in_transit: 'In Transit',
};
