import api from './api';

const apiBase =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/api\/?$/, '') || 'http://localhost:8001'
    : '';

export function getReturnImageUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return `${apiBase}/api${url.startsWith('/') ? '' : '/'}${url}`;
}

export interface ReturnProduct {
  productId: any;
  quantity: number;
  price: number;
}

export interface Return {
  _id: string;
  dealerId: any;
  returnType: 'return' | 'damage';
  products: ReturnProduct[];
  invoiceImage?: string;
  amount?: number;
  status: 'pending' | 'approved' | 'picked' | 'completed';
  returnReason?: string;
  createdBy?: any;
  createdAt: string;
  updatedAt: string;
}

export interface CreateReturnPayload {
  dealerId: string;
  returnType: 'return' | 'damage';
  products: { productId: string; quantity: number; price: number }[];
  invoiceImage?: File;
  amount?: number;
  returnReason?: string;
}

export interface UpdateReturnPayload {
  dealerId?: string;
  returnType?: 'return' | 'damage';
  products?: { productId: string; quantity: number; price: number }[];
  invoiceImage?: File;
  amount?: number;
  returnReason?: string;
  status?: 'pending' | 'approved' | 'picked' | 'completed';
}

function buildReturnFormData(data: CreateReturnPayload | UpdateReturnPayload): FormData {
  const form = new FormData();
  if ('dealerId' in data && data.dealerId) form.append('dealerId', data.dealerId);
  if (data.returnType) form.append('returnType', data.returnType);
  if (data.products) form.append('products', JSON.stringify(data.products));
  if (data.amount !== undefined) form.append('amount', String(data.amount));
  if (data.returnReason !== undefined) form.append('returnReason', data.returnReason);
  if (data.invoiceImage instanceof File) form.append('invoiceImage', data.invoiceImage);
  if ('status' in data && data.status) form.append('status', data.status);
  return form;
}

export const returnService = {
  async getReturns(filters?: {
    clientId?: string;
    returnType?: string;
    status?: string;
    createdBy?: string;
  }) {
    const params = new URLSearchParams();
    if (filters?.clientId) params.append('dealerId', filters.clientId);
    if (filters?.returnType) params.append('returnType', filters.returnType);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.createdBy) params.append('createdBy', filters.createdBy);
    const response = await api.get(`/returns?${params.toString()}`);
    return response.data;
  },

  async getReturn(id: string) {
    const response = await api.get(`/returns/${id}`);
    return response.data;
  },

  async createReturn(data: CreateReturnPayload) {
    const form = buildReturnFormData(data);
    const response = await api.post('/returns', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async updateReturn(id: string, data: UpdateReturnPayload) {
    const form = buildReturnFormData(data);
    const response = await api.put(`/returns/${id}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async deleteReturn(id: string) {
    const response = await api.delete(`/returns/${id}`);
    return response.data;
  },
};
