import api from './api';

export interface Return {
  _id: string;
  productId: any;
  dealerId: any;
  returnType: 'return' | 'claim';
  returnReason?: string;
  createdBy?: any;
  createdAt: string;
  updatedAt: string;
}

export const returnService = {
  async getReturns(filters?: {
    dealerId?: string;
    productId?: string;
    returnType?: string;
    createdBy?: string;
  }) {
    const params = new URLSearchParams();
    if (filters?.dealerId) params.append('dealerId', filters.dealerId);
    if (filters?.productId) params.append('productId', filters.productId);
    if (filters?.returnType) params.append('returnType', filters.returnType);
    if (filters?.createdBy) params.append('createdBy', filters.createdBy);
    const response = await api.get(`/returns?${params.toString()}`);
    return response.data;
  },

  async getReturn(id: string) {
    const response = await api.get(`/returns/${id}`);
    return response.data;
  },

  async createReturn(data: Partial<Return>) {
    const response = await api.post('/returns', data);
    return response.data;
  },

  async updateReturn(id: string, data: Partial<Return>) {
    const response = await api.put(`/returns/${id}`, data);
    return response.data;
  },

  async deleteReturn(id: string) {
    const response = await api.delete(`/returns/${id}`);
    return response.data;
  },
};
