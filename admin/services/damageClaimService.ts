import api from './api';

/**
 * Damaged / claimed stock. Raising an entry moves no stock; an admin approval moves the pieces from
 * Sellable to Damaged/Claim, and a rejection changes nothing.
 */

export type DamageSource = 'internal_damage' | 'client_claim';

/** Mirrors `APPROVAL_TYPE_LABELS` in approvalService — filter dropdowns build from the keys. */
export const DAMAGE_SOURCE_LABELS: Record<DamageSource, string> = {
  internal_damage: 'Internal Damage',
  client_claim: 'Client Claim',
};

export type DamageClaimStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface DamageClaimLine {
  /** Populated Product when it comes back from the API. */
  productId: any;
  quantity: number;
}

export interface DamageClaim {
  _id: string;
  documentNo?: number;
  warehouseId: any;
  products: DamageClaimLine[];
  source: DamageSource;
  /** Required when `source === 'client_claim'`. */
  clientName?: string;
  dealerId?: any;
  linkedReturnId?: string;
  reason: string;
  status: DamageClaimStatus;
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

export interface DamageClaimSlip {
  kind: 'damage';
  documentNo: number | null;
  entryDate: string;
  status: string;
  source: string;
  clientName: string | null;
  warehouseName: string;
  reason: string;
  rejectionReason: string | null;
  cancelReason: string | null;
  raisedBy: string;
  approvedByName: string | null;
  approvedAt: string | null;
  totalPieces: number;
  lines: { productName: string; barcode: string; quantity: number }[];
}

export const damageClaimService = {
  async getRecords(filters?: {
    status?: string;
    source?: string;
    warehouseId?: string;
    productId?: string;
    startDate?: string;
    endDate?: string;
    search?: string;
  }): Promise<DamageClaim[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.source) params.append('source', filters.source);
    if (filters?.warehouseId) params.append('warehouseId', filters.warehouseId);
    if (filters?.productId) params.append('productId', filters.productId);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.search) params.append('search', filters.search);
    const response = await api.get(`/warehouse/damage-claims?${params.toString()}`);
    return response.data;
  },

  async getRecord(id: string): Promise<DamageClaim> {
    const response = await api.get(`/warehouse/damage-claims/${id}`);
    return response.data;
  },

  async getRecordSlip(id: string): Promise<DamageClaimSlip> {
    const response = await api.get(`/warehouse/damage-claims/${id}/slip`);
    return response.data;
  },

  async createRecord(data: {
    warehouseId?: string;
    source: DamageSource;
    clientName?: string;
    dealerId?: string;
    reason: string;
    products: { productId: string; quantity: number }[];
  }): Promise<DamageClaim> {
    const response = await api.post('/warehouse/damage-claims', data);
    return response.data;
  },

  async approveRecord(id: string): Promise<DamageClaim> {
    const response = await api.patch(`/warehouse/damage-claims/${id}/approve`);
    return response.data;
  },

  async rejectRecord(id: string, reason: string): Promise<DamageClaim> {
    const response = await api.patch(`/warehouse/damage-claims/${id}/reject`, { reason });
    return response.data;
  },

  async cancelRecord(id: string, reason: string): Promise<DamageClaim> {
    const response = await api.patch(`/warehouse/damage-claims/${id}/cancel`, { reason });
    return response.data;
  },
};
