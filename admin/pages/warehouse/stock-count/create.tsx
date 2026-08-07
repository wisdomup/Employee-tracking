import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import SearchableSelect from '../../../components/UI/SearchableSelect';
import WarehouseModuleNav from '../../../components/Warehouse/WarehouseModuleNav';
import { stockCountService, CountSheet } from '../../../services/stockCountService';
import {
  warehouseService,
  Warehouse,
  warehouseSelectOptions,
} from '../../../services/warehouseService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { formatPieces } from '../../../utils/formatCurrency';
import { useAuth } from '../../../contexts/AuthContext';
import formStyles from '../../../styles/FormPage.module.scss';
import reportStyles from '../../../styles/StockReports.module.scss';

/**
 * Start a monthly count: pick a warehouse, preview what will be on the sheet, then open the draft.
 * The counting itself happens on the detail page, which is where the numbers get entered.
 */
function StartStockCountPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [sheet, setSheet] = useState<CountSheet | null>(null);
  const [loadingSheet, setLoadingSheet] = useState(false);
  const [starting, setStarting] = useState(false);

  const lockedWarehouseId = user?.role === 'admin' ? '' : user?.warehouseId ?? '';
  const [warehouseId, setWarehouseId] = useState(lockedWarehouseId);

  useEffect(() => {
    warehouseService
      .getWarehouses({ isActive: true })
      .then((list) => {
        setWarehouses(list);
        if (lockedWarehouseId) setWarehouseId(lockedWarehouseId);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, 'Failed to load warehouses')));
  }, [lockedWarehouseId]);

  useEffect(() => {
    if (!warehouseId) {
      setSheet(null);
      return;
    }
    setLoadingSheet(true);
    stockCountService
      .getCountSheet(warehouseId)
      .then(setSheet)
      .catch((err) => {
        setSheet(null);
        toast.error(getApiErrorMessage(err, 'Failed to load the count sheet'));
      })
      .finally(() => setLoadingSheet(false));
  }, [warehouseId]);

  const handleStart = async () => {
    if (!warehouseId) {
      toast.error('Pick a warehouse to count');
      return;
    }
    setStarting(true);
    try {
      const count = await stockCountService.openCount(warehouseId);
      toast.success('Count sheet opened — enter what you physically counted');
      router.push(`/warehouse/stock-count/${count._id}`);
    } catch (err) {
      // The API refuses a second open count for the same warehouse, and says which one is open.
      toast.error(getApiErrorMessage(err, 'Failed to start the count'));
    } finally {
      setStarting(false);
    }
  };

  return (
    <Layout>
      <div className={formStyles.container}>
        <div className={formStyles.header}>
          <h1>Start a Stock Count</h1>
          <button className={formStyles.backButton} onClick={() => router.back()}>
            ← Back
          </button>
        </div>

        <WarehouseModuleNav active="stock-count" />

        <form className={formStyles.form} onSubmit={(e) => e.preventDefault()}>
          <div className={formStyles.formGroup}>
            <label htmlFor="warehouseId">Warehouse *</label>
            <SearchableSelect
              id="warehouseId"
              name="warehouseId"
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className={formStyles.select}
              placeholder="Select warehouse"
              disabled={Boolean(lockedWarehouseId)}
              options={[
                { value: '', label: 'Select warehouse' },
                ...warehouseSelectOptions(warehouses),
              ]}
            />
            <span className={formStyles.hint}>
              One warehouse at a time. Count sellable and damaged / claim pieces separately.
            </span>
          </div>

          {loadingSheet && <p>Preparing the sheet…</p>}

          {sheet && !loadingSheet && (
            <>
              <div className={reportStyles.plGrid}>
                <div className={reportStyles.plCard}>
                  <span>Products on the sheet</span>
                  <strong>{sheet.rows.length}</strong>
                </div>
                <div className={reportStyles.plCard}>
                  <span>System sellable pieces</span>
                  <strong>
                    {formatPieces(sheet.rows.reduce((sum, r) => sum + r.systemSellable, 0))}
                  </strong>
                </div>
                <div className={reportStyles.plCard}>
                  <span>System damaged pieces</span>
                  <strong>
                    {formatPieces(sheet.rows.reduce((sum, r) => sum + r.systemDamaged, 0))}
                  </strong>
                </div>
                <div className={reportStyles.plCard}>
                  <span>Month</span>
                  <strong>{sheet.periodMonth}</strong>
                </div>
              </div>

              {sheet.rows.length === 0 && (
                <div className={reportStyles.lowStockCallout}>
                  This warehouse holds no stock, so there is nothing to count. Receive or transfer
                  stock in first.
                </div>
              )}

              <div className={formStyles.formGroup}>
                <span className={formStyles.hint}>
                  The sheet opens prefilled with the system figures, so you only change the rows where
                  the physical count differs. Nothing is corrected until an admin approves it.
                </span>
              </div>
            </>
          )}

          <div className={formStyles.formActions}>
            <button
              type="button"
              className={formStyles.cancelButton}
              onClick={() => router.push('/warehouse/stock-count')}
            >
              Cancel
            </button>
            <button
              type="button"
              className={formStyles.submitButton}
              onClick={handleStart}
              disabled={starting || !warehouseId || (sheet?.rows.length ?? 0) === 0}
            >
              {starting ? 'Opening…' : 'Open count sheet'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}

export default function StartStockCountPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'warehouse_manager', 'warehouse_staff']}>
      <StartStockCountPage />
    </ProtectedRoute>
  );
}
