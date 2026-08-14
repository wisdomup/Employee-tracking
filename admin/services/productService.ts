import api from './api';

export interface Product {
  _id: string;
  barcode: string;
  name: string;
  description?: string;
  image?: string;
  salePrice?: number;
  purchasePrice?: number;
  onlinePrice?: number;
  /**
   * Read-only. Total SELLABLE stock across every warehouse, derived from the warehouse ledger.
   * Sending it is ignored by the API — starting stock goes through Warehouse → Opening Stock, and
   * everything after that through Stock In, transfers, sales and counts.
   */
  quantity?: number;
  /**
   * Read-only. Total DAMAGED / claim stock across every warehouse. Separate from `quantity`
   * because damaged pieces are not for sale — never add the two together for an availability
   * check. "On hand" (quantity + damagedQuantity) is a display figure only.
   */
  damagedQuantity?: number;
  /** Admin-set low-stock level, compared against the all-warehouse total. */
  survivalQuantity?: number;
  /** Read-only. Rate on the most recent Stock In — shown as a reference when entering a new one. */
  lastPurchaseRate?: number;
  categoryId: any;
  createdBy?: any;
  extras?: Record<string, string>;
  createdAt: string;
  updatedAt: string;
}

export const productService = {
  async getProducts(filters?: { categoryId?: string; search?: string }) {
    const params = new URLSearchParams();
    if (filters?.categoryId) params.append('categoryId', filters.categoryId);
    if (filters?.search) params.append('search', filters.search);
    const response = await api.get(`/products?${params.toString()}`);
    return response.data;
  },

  async getProduct(id: string) {
    const response = await api.get(`/products/${id}`);
    return response.data;
  },

  async createProduct(data: Partial<Product>) {
    const response = await api.post('/products', data);
    return response.data;
  },

  async updateProduct(id: string, data: Partial<Product>) {
    const response = await api.put(`/products/${id}`, data);
    return response.data;
  },

  async deleteProduct(id: string) {
    const response = await api.delete(`/products/${id}`);
    return response.data;
  },
};
