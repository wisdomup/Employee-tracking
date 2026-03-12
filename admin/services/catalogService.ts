import api from './api';

export interface Catalog {
  _id: string;
  name: string;
  fileUrl: string;
  createdBy?: { _id: string; username?: string; userID?: string; role?: string };
  createdAt: string;
  updatedAt: string;
}

const apiBase = typeof window !== 'undefined'
  ? (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/api\/?$/, '') || 'http://localhost:8001'
  : '';

export function getCatalogDownloadUrl(fileUrl: string): string {
  if (fileUrl.startsWith('http')) return fileUrl;
  return `${apiBase}/api${fileUrl.startsWith('/') ? '' : '/'}${fileUrl}`;
}

export const catalogService = {
  async getCatalogs(filters?: { search?: string }) {
    const params = new URLSearchParams();
    if (filters?.search) params.append('search', filters.search);
    const response = await api.get(`/catalogs?${params.toString()}`);
    return response.data;
  },

  async getCatalog(id: string) {
    const response = await api.get(`/catalogs/${id}`);
    return response.data;
  },

  async createCatalog(name: string, file: File) {
    const form = new FormData();
    form.append('name', name);
    form.append('file', file);
    const response = await api.post('/catalogs', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async updateCatalog(id: string, data: { name?: string; file?: File }) {
    const form = new FormData();
    if (data.name !== undefined) form.append('name', data.name);
    if (data.file) form.append('file', data.file);
    const response = await api.put(`/catalogs/${id}`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return response.data;
  },

  async deleteCatalog(id: string) {
    const response = await api.delete(`/catalogs/${id}`);
    return response.data;
  },
};
