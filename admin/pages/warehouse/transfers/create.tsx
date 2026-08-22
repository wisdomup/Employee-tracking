import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import SearchableSelect from '../../../components/UI/SearchableSelect';
import WarehouseModuleNav from '../../../components/Warehouse/WarehouseModuleNav';
import StockLineItemsEditor, {
  StockLine,
  emptyStockLine,
  findStockLineExcess,
} from '../../../components/Warehouse/StockLineItemsEditor';
import { stockTransferService } from '../../../services/stockTransferService';
import {
  warehouseService,
  Warehouse,
  warehouseSelectOptions,
} from '../../../services/warehouseService';
import { productService, Product } from '../../../services/productService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useAuth } from '../../../contexts/AuthContext';
import styles from '../../../styles/FormPage.module.scss';

function CreateTransferPage() {
  const router = useRouter();
  const { user } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [availability, setAvailability] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const lockedFromId = user?.role === 'admin' ? '' : user?.warehouseId ?? '';
  const [fromWarehouseId, setFromWarehouseId] = useState(lockedFromId);
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState<StockLine[]>([emptyStockLine()]);

  useEffect(() => {
    Promise.all([warehouseService.getWarehouses({ isActive: true }), productService.getProducts()])
      .then(([w, p]) => {
        setWarehouses(w);
        setProducts(p);
        if (lockedFromId) setFromWarehouseId(lockedFromId);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, 'Failed to load form data')));
  }, [lockedFromId]);

  // Sellable stock at the SOURCE — what can actually be sent.
  useEffect(() => {
    if (!fromWarehouseId) {
      setAvailability({});
      return;
    }
    warehouseService
      .getStock({ warehouseId: fromWarehouseId })
      .then((rows) => {
        const map: Record<string, number> = {};
        for (const row of rows) map[row.productId] = row.sellable;
        setAvailability(map);
      })
      .catch(() => setAvailability({}));
  }, [fromWarehouseId]);

  const productNameById = useMemo(() => {
    const map = new Map(products.map((p) => [p._id, p.name]));
    return (id: string) => map.get(id) ?? 'this product';
  }, [products]);

  const excess = useMemo(
    () => (fromWarehouseId ? findStockLineExcess(lines, availability, productNameById) : null),
    [lines, availability, productNameById, fromWarehouseId],
  );

  // A transfer to itself has no meaning and would put both legs on one balance document.
  const destinationOptions = useMemo(
    () =>
      warehouseSelectOptions(warehouses.filter((w) => w._id !== fromWarehouseId)),
    [warehouses, fromWarehouseId],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!fromWarehouseId) {
      toast.error('Pick the warehouse the stock is coming from');
      return;
    }
    if (!toWarehouseId) {
      toast.error('Pick the destination warehouse');
      return;
    }
    if (fromWarehouseId === toWarehouseId) {
      toast.error('The source and destination must be different');
      return;
    }
    const validLines = lines.filter((l) => l.productId && l.qty > 0);
    if (validLines.length === 0) {
      toast.error('Add at least one product with a quantity');
      return;
    }
    const ids = validLines.map((l) => l.productId);
    if (new Set(ids).size !== ids.length) {
      toast.error('The same product appears on more than one line — combine them into one');
      return;
    }
    if (excess) {
      toast.error(
        `${excess.productName}: only ${excess.available} sellable piece(s) at the source, but ${excess.requested} requested`,
      );
      return;
    }

    setLoading(true);
    try {
      await stockTransferService.createTransfer({
        ...(user?.role === 'admin' ? { fromWarehouseId } : {}),
        toWarehouseId,
        ...(notes.trim() ? { notes: notes.trim() } : {}),
        products: validLines.map((l) => ({ productId: l.productId, sentQty: l.qty })),
      });
      toast.success('Transfer raised and sent for approval — no stock has moved yet');
      router.push('/warehouse/transfers');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to raise the transfer'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>New Transfer</h1>
          <button className={styles.backButton} onClick={() => router.back()}>
            ← Back
          </button>
        </div>

        <WarehouseModuleNav active="transfers" />

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="fromWarehouseId">From *</label>
              <SearchableSelect
                id="fromWarehouseId"
                name="fromWarehouseId"
                value={fromWarehouseId}
                onChange={(e) => {
                  setFromWarehouseId(e.target.value);
                  if (e.target.value === toWarehouseId) setToWarehouseId('');
                }}
                className={styles.select}
                placeholder="Select source"
                disabled={Boolean(lockedFromId)}
                options={[
                  { value: '', label: 'Select source' },
                  ...warehouseSelectOptions(warehouses),
                ]}
              />
              {lockedFromId && (
                <span className={styles.hint}>You can only send from your own warehouse.</span>
              )}
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="toWarehouseId">To *</label>
              <SearchableSelect
                id="toWarehouseId"
                name="toWarehouseId"
                value={toWarehouseId}
                onChange={(e) => setToWarehouseId(e.target.value)}
                className={styles.select}
                placeholder="Select destination"
                disabled={!fromWarehouseId}
                options={[{ value: '', label: 'Select destination' }, ...destinationOptions]}
              />
            </div>
          </div>

          <StockLineItemsEditor
            products={products}
            value={lines}
            onChange={setLines}
            qtyLabel="Pieces to send"
            availableByProduct={fromWarehouseId ? availability : undefined}
            availableLabel="Sellable at source"
            disabled={loading || !fromWarehouseId}
          />

          {excess && (
            <p className={styles.errorText}>
              {excess.productName}: only {excess.available} sellable piece(s) at the source, but{' '}
              {excess.requested} requested.
            </p>
          )}

          <div className={styles.formGroup}>
            <label htmlFor="notes">Notes</label>
            <textarea
              id="notes"
              className={styles.textarea}
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Driver, vehicle, anything the receiving side should know"
            />
          </div>

          <div className={styles.formGroup}>
            <span className={styles.hint}>
              Nothing moves yet. When an admin approves, the pieces leave the source immediately and
              sit in transit — not sellable anywhere — until the destination confirms what arrived.
            </span>
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/warehouse/transfers')}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={loading || !fromWarehouseId || !toWarehouseId || Boolean(excess)}
            >
              {loading ? 'Raising…' : 'Send for approval'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}

export default function CreateTransferPageWrapper() {
  return (
    <ProtectedRoute permission="transfers:add">
      <CreateTransferPage />
    </ProtectedRoute>
  );
}
