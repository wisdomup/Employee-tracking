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
import {
  damageClaimService,
  DamageSource,
  DAMAGE_SOURCE_LABELS,
} from '../../../services/damageClaimService';
import {
  warehouseService,
  Warehouse,
  warehouseSelectOptions,
} from '../../../services/warehouseService';
import { productService, Product } from '../../../services/productService';
import { clientService } from '../../../services/clientService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { useAuth } from '../../../contexts/AuthContext';
import styles from '../../../styles/FormPage.module.scss';

/**
 * Record damaged or claimed stock. Nothing moves until an admin approves, which the form says
 * explicitly — a storekeeper should not be surprised that their stock figure has not changed.
 */
function CreateDamagePage() {
  const router = useRouter();
  const { user } = useAuth();
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<any[]>([]);
  const [availability, setAvailability] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(false);

  const [warehouseId, setWarehouseId] = useState('');
  const [source, setSource] = useState<DamageSource>('internal_damage');
  const [clientName, setClientName] = useState('');
  const [dealerId, setDealerId] = useState('');
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<StockLine[]>([emptyStockLine()]);

  // Warehouse roles are locked to their own warehouse; an admin picks. This is UX only — the API
  // rejects a mismatched warehouse regardless of what the form sends.
  const lockedWarehouseId = user?.role === 'admin' ? '' : user?.warehouseId ?? '';

  useEffect(() => {
    Promise.all([
      warehouseService.getWarehouses({ isActive: true }),
      productService.getProducts(),
      clientService.getClients().catch(() => []),
    ])
      .then(([w, p, c]) => {
        setWarehouses(w);
        setProducts(p);
        setClients(Array.isArray(c) ? c : []);
        if (lockedWarehouseId) setWarehouseId(lockedWarehouseId);
        else if (w.length === 1) setWarehouseId(w[0]._id);
      })
      .catch((err) => toast.error(getApiErrorMessage(err, 'Failed to load form data')));
  }, [lockedWarehouseId]);

  // Sellable stock at the chosen warehouse — a write-off can only come out of what is there.
  useEffect(() => {
    if (!warehouseId) {
      setAvailability({});
      return;
    }
    warehouseService
      .getStock({ warehouseId })
      .then((rows) => {
        const map: Record<string, number> = {};
        for (const row of rows) map[row.productId] = row.sellable;
        setAvailability(map);
      })
      .catch(() => setAvailability({}));
  }, [warehouseId]);

  const productNameById = useMemo(() => {
    const map = new Map(products.map((p) => [p._id, p.name]));
    return (id: string) => map.get(id) ?? 'this product';
  }, [products]);

  const excess = useMemo(
    () => (warehouseId ? findStockLineExcess(lines, availability, productNameById) : null),
    [lines, availability, productNameById, warehouseId],
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!warehouseId) {
      toast.error('Pick the warehouse the stock is at');
      return;
    }
    if (source === 'client_claim' && !clientName.trim()) {
      toast.error('Enter the client name — a claim without it cannot be reported on');
      return;
    }
    if (reason.trim().length < 3) {
      toast.error('Give a reason of at least 3 characters');
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
        `${excess.productName}: only ${excess.available} sellable piece(s) at this warehouse, but ${excess.requested} requested`,
      );
      return;
    }

    setLoading(true);
    try {
      await damageClaimService.createRecord({
        ...(user?.role === 'admin' ? { warehouseId } : {}),
        source,
        ...(source === 'client_claim' ? { clientName: clientName.trim() } : {}),
        ...(dealerId ? { dealerId } : {}),
        reason: reason.trim(),
        products: validLines.map((l) => ({ productId: l.productId, quantity: l.qty })),
      });
      toast.success('Entry recorded and sent for approval — no stock has moved yet');
      router.push('/warehouse/damage');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to record the entry'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Record Damage / Claim</h1>
          <button className={styles.backButton} onClick={() => router.back()}>
            ← Back
          </button>
        </div>

        <WarehouseModuleNav active="damage" />

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="warehouseId">Warehouse *</label>
              <SearchableSelect
                id="warehouseId"
                name="warehouseId"
                value={warehouseId}
                onChange={(e) => setWarehouseId(e.target.value)}
                className={styles.select}
                placeholder="Select warehouse"
                disabled={Boolean(lockedWarehouseId)}
                options={[
                  { value: '', label: 'Select warehouse' },
                  ...warehouseSelectOptions(warehouses),
                ]}
              />
              {lockedWarehouseId && (
                <span className={styles.hint}>
                  You can only raise entries for your own warehouse.
                </span>
              )}
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="source">Type *</label>
              <SearchableSelect
                id="source"
                name="source"
                value={source}
                onChange={(e) => setSource(e.target.value as DamageSource)}
                className={styles.select}
                options={Object.entries(DAMAGE_SOURCE_LABELS).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
              <span className={styles.hint}>
                {source === 'client_claim'
                  ? 'A customer returned a damaged or faulty item — record who.'
                  : 'Damage that happened inside the warehouse. No client involved.'}
              </span>
            </div>
          </div>

          {source === 'client_claim' && (
            <div className={styles.formRow}>
              <div className={styles.formGroup}>
                <label htmlFor="clientName">Client name *</label>
                <input
                  id="clientName"
                  className={styles.input}
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  placeholder="Who returned the goods?"
                />
              </div>
              <div className={styles.formGroup}>
                <label htmlFor="dealerId">Link to a client record</label>
                <SearchableSelect
                  id="dealerId"
                  name="dealerId"
                  value={dealerId}
                  onChange={(e) => {
                    setDealerId(e.target.value);
                    const client = clients.find((c: any) => c._id === e.target.value);
                    // Filling the free-text name from the record saves retyping it.
                    if (client && !clientName.trim()) {
                      setClientName(client.shopName || client.name || '');
                    }
                  }}
                  className={styles.select}
                  placeholder="Optional"
                  isClearable
                  options={[
                    { value: '', label: 'Not linked' },
                    ...clients.map((c: any) => ({
                      value: c._id,
                      label: `${c.shopName || c.name}${c.phone ? ` (${c.phone})` : ''}`,
                    })),
                  ]}
                />
              </div>
            </div>
          )}

          <StockLineItemsEditor
            products={products}
            value={lines}
            onChange={setLines}
            qtyLabel="Pieces"
            availableByProduct={warehouseId ? availability : undefined}
            availableLabel="Sellable here"
            disabled={loading || !warehouseId}
          />

          {excess && (
            <p className={styles.errorText}>
              {excess.productName}: only {excess.available} sellable piece(s) at this warehouse, but{' '}
              {excess.requested} requested.
            </p>
          )}

          <div className={styles.formGroup}>
            <label htmlFor="reason">Reason *</label>
            <textarea
              id="reason"
              className={styles.textarea}
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="What happened?"
            />
          </div>

          <div className={styles.formGroup}>
            <span className={styles.hint}>
              Nothing moves yet. An admin has to approve this before the pieces leave sellable stock.
            </span>
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/warehouse/damage')}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={loading || !warehouseId || Boolean(excess)}
            >
              {loading ? 'Recording…' : 'Send for approval'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}

export default function CreateDamagePageWrapper() {
  return (
    <ProtectedRoute permission="damage:add">
      <CreateDamagePage />
    </ProtectedRoute>
  );
}
