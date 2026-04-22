import api from './api';

export interface StockReportFilters {
  startDate?: string;
  endDate?: string;
  categoryId?: string;
  search?: string;
}

export interface CurrentStockRow {
  productId: string;
  name: string;
  barcode: string;
  categoryName: string;
  availableQty: number;
  onHoldQty: number;
  soldQtyInPeriod: number;
  salePrice: number;
  purchasePrice: number;
  survivalQuantity: number | null;
}

export interface HoldStockRow {
  orderId: string;
  productId: string;
  productName: string;
  barcode: string;
  categoryName: string;
  dealerName: string;
  qtyOnHold: number;
  unitPrice: number;
  orderStatus: string;
  orderDate: string;
}

export interface DamageStockRow {
  returnId: string;
  productId: string;
  productName: string;
  barcode: string;
  categoryName: string;
  dealerName: string;
  damagedQty: number;
  unitPrice: number;
  returnReason: string;
  returnStatus: string;
  returnDate: string;
}

export interface ProfitLossReport {
  period: { startDate: string; endDate: string };
  summary: {
    revenue: number;
    cogs: number;
    grossProfit: number;
    totalReturnPayout: number;
    damageValue: number;
    netProfitLoss: number;
    orderCount: number;
    soldQty: number;
    returnCount: number;
    damagedQty: number;
  };
}

export interface LowStockRow {
  productId: string;
  name: string;
  barcode: string;
  categoryName: string;
  currentStock: number;
  survivalQuantity: number;
  deficit: number;
}

function buildParams(filters: StockReportFilters): string {
  const params = new URLSearchParams();
  if (filters.startDate) params.append('startDate', filters.startDate);
  if (filters.endDate) params.append('endDate', filters.endDate);
  if (filters.categoryId) params.append('categoryId', filters.categoryId);
  if (filters.search) params.append('search', filters.search);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

export const stockReportService = {
  async getCurrentStock(filters: StockReportFilters = {}): Promise<CurrentStockRow[]> {
    const response = await api.get(`/stock-reports/current${buildParams(filters)}`);
    return response.data;
  },

  async getHoldStock(filters: StockReportFilters = {}): Promise<HoldStockRow[]> {
    const response = await api.get(`/stock-reports/hold${buildParams(filters)}`);
    return response.data;
  },

  async getDamageStock(filters: StockReportFilters = {}): Promise<DamageStockRow[]> {
    const response = await api.get(`/stock-reports/damage${buildParams(filters)}`);
    return response.data;
  },

  async getProfitLoss(filters: StockReportFilters = {}): Promise<ProfitLossReport> {
    const response = await api.get(`/stock-reports/profit-loss${buildParams(filters)}`);
    return response.data;
  },

  async getLowStock(filters: StockReportFilters = {}): Promise<LowStockRow[]> {
    const response = await api.get(`/stock-reports/low-stock${buildParams(filters)}`);
    return response.data;
  },
};
