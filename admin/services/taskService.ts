import api from './api';

const apiBase =
  typeof window !== 'undefined'
    ? (process.env.NEXT_PUBLIC_API_URL || '').replace(/\/api\/?$/, '') || 'http://localhost:8001'
    : '';

export function getTaskDocumentUrl(documentUrl: string): string {
  if (documentUrl.startsWith('http')) return documentUrl;
  return `${apiBase}/api${documentUrl.startsWith('/') ? '' : '/'}${documentUrl}`;
}

export function getTaskCompletionImageUrl(url: string): string {
  if (!url) return '';
  if (url.startsWith('http')) return url;
  return `${apiBase}/api${url.startsWith('/') ? '' : '/'}${url}`;
}

export interface CompletionImage {
  type: 'shop' | 'selfie';
  url: string;
}

export interface Task {
  _id: string;
  taskName: string;
  description?: string;
  referenceImage?: string;
  document?: string;
  employeeNotes?: string;
  quantity?: number;
  dealerId?: any;
  routeId?: any;
  assignedTo?: any;
  assignedBy?: any;
  status: 'pending' | 'in_progress' | 'completed';
  startedAt?: string;
  completedAt?: string;
  completionImages?: CompletionImage[];
  latitude?: number;
  longitude?: number;
  distanceFromClient?: number;
  createdBy: any;
  createdAt: string;
  updatedAt: string;
}

export type TaskCreateUpdate = Partial<Omit<Task, '_id' | 'createdAt' | 'updatedAt' | 'document'>> & {
  document?: File;
};

function toId(value: string | { _id?: string } | null | undefined): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  return (value as { _id?: string })._id ?? '';
}

function appendTaskFormData(form: FormData, data: TaskCreateUpdate): void {
  if (data.taskName != null) form.append('taskName', String(data.taskName));
  if (data.description != null) form.append('description', String(data.description));
  if (data.referenceImage != null) form.append('referenceImage', String(data.referenceImage));
  if (data.employeeNotes != null) form.append('employeeNotes', String(data.employeeNotes));
  if (data.quantity != null) form.append('quantity', String(data.quantity));
  const clientId = toId(data.dealerId as string | { _id?: string } | undefined);
  if (clientId) form.append('dealerId', clientId);
  const routeId = toId(data.routeId as string | { _id?: string } | undefined);
  if (routeId) form.append('routeId', routeId);
  if (data.document instanceof File) form.append('document', data.document);
}

export const taskService = {
  async getTasks(filters?: {
    clientId?: string;
    routeId?: string;
    status?: string;
    assignedTo?: string;
  }) {
    const params = new URLSearchParams();
    if (filters?.clientId) params.append('dealerId', filters.clientId);
    if (filters?.routeId) params.append('routeId', filters.routeId);
    if (filters?.status) params.append('status', filters.status);
    if (filters?.assignedTo) params.append('assignedTo', filters.assignedTo);

    const response = await api.get(`/tasks?${params.toString()}`);
    return response.data;
  },

  async getTask(id: string) {
    const response = await api.get(`/tasks/${id}`);
    return response.data;
  },

  async createTask(data: TaskCreateUpdate) {
    if (data.document instanceof File) {
      const form = new FormData();
      appendTaskFormData(form, data);
      const response = await api.post('/tasks', form);
      return response.data;
    }
    const { document: _d, ...json } = data;
    const response = await api.post('/tasks', json);
    return response.data;
  },

  async updateTask(id: string, data: TaskCreateUpdate) {
    if (data.document instanceof File) {
      const form = new FormData();
      appendTaskFormData(form, data);
      const response = await api.put(`/tasks/${id}`, form);
      return response.data;
    }
    const { document: _d, ...json } = data;
    const response = await api.put(`/tasks/${id}`, json);
    return response.data;
  },

  async deleteTask(id: string) {
    const response = await api.delete(`/tasks/${id}`);
    return response.data;
  },

  async assignTask(taskId: string, assignedTo: string) {
    const response = await api.patch(`/tasks/${taskId}/assign`, { assignedTo });
    return response.data;
  },

  async startTask(taskId: string, data: { latitude: number; longitude: number }) {
    const response = await api.patch(`/tasks/${taskId}/start`, data);
    return response.data;
  },

  async completeTask(
    taskId: string,
    data: { latitude: number; longitude: number; completionImages: CompletionImage[] },
  ) {
    const response = await api.patch(`/tasks/${taskId}/complete`, data);
    return response.data;
  },
};
