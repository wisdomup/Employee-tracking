import api from './api';

/**
 * Stock transfers between warehouses.
 *
 * Status flow: `pending` → (admin) `approved` → (destination confirms) `completed` | `mismatch`.
 * `approved` means the goods are in transit and no longer sellable anywhere.
 */

export interface TransferLine {
  /** Populated Product when it comes back from the API. */
  productId: any;
  sentQty: number;
  /** Unset until the destination confirms. */
  receivedQty?: number;
  receiveNote?: string;
}

export type StockTransferStatus =
  | 'pending'
  | 'approved'
  | 'completed'
  | 'mismatch'
  | 'rejected'
  | 'cancelled';

export interface StockTransfer {
  _id: string;
  documentNo?: number;
  fromWarehouseId: any;
  toWarehouseId: any;
  products: TransferLine[];
  status: StockTransferStatus;
  notes?: string;
  approvedBy?: any;
  approvedAt?: string;
  rejectedBy?: any;
  rejectedAt?: string;
  rejectionReason?: string;
  receivedBy?: any;
  receivedAt?: string;
  mismatchResolvedBy?: any;
  mismatchResolvedAt?: string;
  mismatchResolution?: 'write_off' | 'return_to_source';
  mismatchResolutionNote?: string;
  cancelledBy?: any;
  cancelledAt?: string;
  cancelReason?: string;
  createdBy?: any;
  createdAt: string;
  updatedAt: string;
}

export interface TransferSlip {
  kind: 'transfer';
  documentNo: number | null;
  transferDate: string;
  status: string;
  fromWarehouseName: string;
  toWarehouseName: string;
  preparedBy: string;
  approvedByName: string | null;
  receivedByName: string | null;
  notes: string | null;
  cancelReason: string | null;
  rejectionReason: string | null;
  mismatchResolutionNote: string | null;
  totalSent: number;
  totalReceived: number;
  lines: {
    productName: string;
    barcode: string;
    sentQty: number;
    receivedQty: number | null;
    difference: number | null;
  }[];
}

/** Human labels, so the filter dropdown and the column renderer stay in step. */
export const TRANSFER_STATUS_LABELS: Record<StockTransferStatus, string> = {
  pending: 'Pending approval',
  approved: 'In transit',
  completed: 'Completed',
  mismatch: 'Qty mismatch',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export const stockTransferService = {
  async getTransfers(filters?: {
    status?: string;
    fromWarehouseId?: string;
    toWarehouseId?: string;
    startDate?: string;
    endDate?: string;
    hasMismatch?: boolean;
  }): Promise<StockTransfer[]> {
    const params = new URLSearchParams();
    if (filters?.status) params.append('status', filters.status);
    if (filters?.fromWarehouseId) params.append('fromWarehouseId', filters.fromWarehouseId);
    if (filters?.toWarehouseId) params.append('toWarehouseId', filters.toWarehouseId);
    if (filters?.startDate) params.append('startDate', filters.startDate);
    if (filters?.endDate) params.append('endDate', filters.endDate);
    if (filters?.hasMismatch) params.append('hasMismatch', 'true');
    const response = await api.get(`/warehouse/transfers?${params.toString()}`);
    return response.data;
  },

  async getTransfer(id: string): Promise<StockTransfer> {
    const response = await api.get(`/warehouse/transfers/${id}`);
    return response.data;
  },

  async getTransferSlip(id: string): Promise<TransferSlip> {
    const response = await api.get(`/warehouse/transfers/${id}/slip`);
    return response.data;
  },

  async createTransfer(data: {
    fromWarehouseId?: string;
    toWarehouseId: string;
    notes?: string;
    products: { productId: string; sentQty: number }[];
  }): Promise<StockTransfer> {
    const response = await api.post('/warehouse/transfers', data);
    return response.data;
  },

  async approveTransfer(id: string): Promise<StockTransfer> {
    const response = await api.patch(`/warehouse/transfers/${id}/approve`);
    return response.data;
  },

  async rejectTransfer(id: string, reason: string): Promise<StockTransfer> {
    const response = await api.patch(`/warehouse/transfers/${id}/reject`, { reason });
    return response.data;
  },

  async receiveTransfer(
    id: string,
    lines: { productId: string; receivedQty: number; receiveNote?: string }[],
  ): Promise<StockTransfer> {
    const response = await api.patch(`/warehouse/transfers/${id}/receive`, { lines });
    return response.data;
  },

  async resolveMismatch(
    id: string,
    resolution: 'write_off' | 'return_to_source',
    reason: string,
  ): Promise<StockTransfer> {
    const response = await api.patch(`/warehouse/transfers/${id}/resolve-mismatch`, {
      resolution,
      reason,
    });
    return response.data;
  },

  async cancelTransfer(id: string, reason: string): Promise<StockTransfer> {
    const response = await api.patch(`/warehouse/transfers/${id}/cancel`, { reason });
    return response.data;
  },
};
