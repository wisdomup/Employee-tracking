import api from './api';

export interface Category {
  _id: string;
  name: string;
  description?: string;
  image?: string;
  createdBy?: any;
  createdAt: string;
  updatedAt: string;
}

export const categoryService = {
  async getCategories(filters?: { search?: string }) {
    const params = new URLSearchParams();
    if (filters?.search) params.append('search', filters.search);
    const response = await api.get(`/categories?${params.toString()}`);
    return response.data;
  },

  async getCategory(id: string) {
    const response = await api.get(`/categories/${id}`);
    return response.data;
  },

  async createCategory(data: Partial<Category>) {
    const response = await api.post('/categories', data);
    return response.data;
  },

  async updateCategory(id: string, data: Partial<Category>) {
    const response = await api.put(`/categories/${id}`, data);
    return response.data;
  },

  async deleteCategory(id: string) {
    const response = await api.delete(`/categories/${id}`);
    return response.data;
  },
};
