import React, { useCallback, useEffect, useState } from 'react';
import { toast } from 'react-toastify';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import FinanceNav from '../../components/Finance/FinanceNav';
import { can } from '../../utils/permissions';
import {
  taxRateService,
  TaxRate,
  TaxRateKind,
  TAX_RATE_KIND_LABELS,
} from '../../services/financeService';
import listStyles from '../../styles/ListPage.module.scss';
import formStyles from '../../styles/FormPage.module.scss';
import styles from '../../styles/Finance.module.scss';

/**
 * The tax rates the business is registered for.
 *
 * The two kinds are explained on the page rather than assumed, because getting them the wrong way
 * round is the expensive mistake here: a sales rate used on a supplier payment would deduct money
 * from somebody who was owed it, and nothing downstream would know it was the wrong sort of tax.
 */

const EMPTY = { name: '', kind: 'withholding' as TaxRateKind, percentage: '', notes: '' };

const TaxRatesPage: React.FC = () => {
  const [rates, setRates] = useState<TaxRate[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('active');
  const [form, setForm] = useState(EMPTY);
  const [editingId, setEditingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setRates(await taxRateService.list({ status }));
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not load the tax rates');
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const save = async () => {
    if (!form.name.trim() || form.percentage === '') {
      toast.error('Give the rate a name and a percentage.');
      return;
    }

    setBusy(true);
    try {
      if (editingId) {
        // The kind is not sent on an edit: it can never change, and the server refuses it.
        await taxRateService.update(editingId, {
          name: form.name.trim(),
          percentage: Number(form.percentage),
          notes: form.notes.trim() || undefined,
        });
        toast.success('Rate updated. Anything already posted keeps the figure it was posted with.');
      } else {
        await taxRateService.create({
          name: form.name.trim(),
          kind: form.kind,
          percentage: Number(form.percentage),
          notes: form.notes.trim() || undefined,
        });
        toast.success('Rate added');
      }
      setForm(EMPTY);
      setEditingId(null);
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not save the rate');
    } finally {
      setBusy(false);
    }
  };

  const toggle = async (rate: TaxRate) => {
    try {
      await taxRateService.setStatus(rate.id, !rate.isActive);
      toast.success(rate.isActive ? `${rate.name} retired` : `${rate.name} brought back`);
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not change the status');
    }
  };

  const remove = async (rate: TaxRate) => {
    if (!window.confirm(`Delete "${rate.name}"? Nothing has used it.`)) return;
    try {
      await taxRateService.remove(rate.id);
      toast.success('Deleted');
      load();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Could not delete this rate');
    }
  };

  const columns = [
    { key: 'name', title: 'Name' },
    {
      key: 'kind',
      title: 'Kind',
      render: (value: TaxRateKind) => (
        <span className={styles.flag}>{TAX_RATE_KIND_LABELS[value]}</span>
      ),
    },
    {
      key: 'percentage',
      title: 'Rate',
      render: (value: number) => <span className={styles.amount}>{value}%</span>,
    },
    {
      key: 'usageCount',
      title: 'Used on',
      render: (value: number) =>
        value > 0 ? `${value} payment${value === 1 ? '' : 's'}` : <span className={styles.muted}>—</span>,
    },
    {
      key: 'isActive',
      title: 'Status',
      render: (value: boolean) => (
        <span
          className={`${styles.status} ${value ? styles.status_posted : styles.status_draft}`}
        >
          {value ? 'In use' : 'Retired'}
        </span>
      ),
    },
    {
      key: 'actions',
      title: '',
      render: (_: unknown, row: TaxRate) => (
        <div className={listStyles.actions}>
          {can(undefined, 'finance-tax-rates:edit') && (
            <button
              className={listStyles.editButton}
              onClick={() => {
                setEditingId(row.id);
                setForm({
                  name: row.name,
                  kind: row.kind,
                  percentage: String(row.percentage),
                  notes: row.notes ?? '',
                });
              }}
            >
              Edit
            </button>
          )}
          {can(undefined, 'finance-tax-rates:change') && (
            <button className={listStyles.approveButton} onClick={() => toggle(row)}>
              {row.isActive ? 'Retire' : 'Bring back'}
            </button>
          )}
          {can(undefined, 'finance-tax-rates:delete') && row.usageCount === 0 && (
            <button className={listStyles.deleteButton} onClick={() => remove(row)}>
              Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className={listStyles.container}>
        <div className={listStyles.header}>
          <h1>Tax Rates</h1>
        </div>

        <FinanceNav />

        <div className={`${styles.banner} ${styles.bannerInfo}`}>
          <span className={styles.bannerTitle}>The two kinds are opposites</span>
          <strong>Charged on sales</strong> is tax you add to a customer&apos;s invoice and hold
          until you hand it over. <strong>Withheld from suppliers</strong> is tax you keep back
          when you pay a supplier — their invoice is settled in full, less money leaves your bank,
          and the difference is owed to the tax office instead.
          <p className={styles.readonlyNote} style={{ marginBottom: 0 }}>
            A rate can never change from one kind to the other. Every document that already used
            it has to keep meaning what it meant.
          </p>
        </div>

        {can(undefined, 'finance-tax-rates:add') && (
          <div className={styles.panel}>
            <h2 className={styles.panelTitle}>{editingId ? 'Edit rate' : 'Add a rate'}</h2>

            <div className={formStyles.formRow}>
              <div className={formStyles.formGroup}>
                <label htmlFor="name">Name</label>
                <input
                  id="name"
                  type="text"
                  className={formStyles.input}
                  value={form.name}
                  disabled={busy}
                  placeholder="e.g. Goods — filer"
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
              </div>

              <div className={formStyles.formGroup}>
                <label htmlFor="kind">Kind</label>
                <select
                  id="kind"
                  className={formStyles.select}
                  value={form.kind}
                  disabled={busy || Boolean(editingId)}
                  onChange={(e) => setForm({ ...form, kind: e.target.value as TaxRateKind })}
                >
                  <option value="withholding">{TAX_RATE_KIND_LABELS.withholding}</option>
                  <option value="sales">{TAX_RATE_KIND_LABELS.sales}</option>
                </select>
                {editingId && <p className={formStyles.hint}>Fixed once the rate exists.</p>}
              </div>

              <div className={formStyles.formGroup}>
                <label htmlFor="percentage">Percentage</label>
                <input
                  id="percentage"
                  type="number"
                  step="0.01"
                  min="0"
                  max="100"
                  className={formStyles.input}
                  value={form.percentage}
                  disabled={busy}
                  placeholder="4.5"
                  onChange={(e) => setForm({ ...form, percentage: e.target.value })}
                />
                <p className={formStyles.hint}>
                  A percentage, not a multiplier. Changing it later only affects new documents.
                </p>
              </div>
            </div>

            <div className={formStyles.formGroup}>
              <label htmlFor="notes">Note</label>
              <input
                id="notes"
                type="text"
                className={formStyles.input}
                value={form.notes}
                disabled={busy}
                placeholder="When this one applies"
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
              />
            </div>

            <div className={formStyles.formActions}>
              <button className={formStyles.submitButton} disabled={busy} onClick={save}>
                {editingId ? 'Save changes' : 'Add rate'}
              </button>
              {editingId && (
                <button
                  className={formStyles.cancelButton}
                  disabled={busy}
                  onClick={() => {
                    setEditingId(null);
                    setForm(EMPTY);
                  }}
                >
                  Cancel
                </button>
              )}
            </div>
          </div>
        )}

        <div className={listStyles.listCard}>
          <div className={listStyles.listCardBody}>
            <div className={styles.filterRow}>
              <select
                className={listStyles.searchSelect}
                value={status}
                onChange={(e) => setStatus(e.target.value)}
              >
                <option value="active">In use</option>
                <option value="inactive">Retired</option>
                <option value="all">All</option>
              </select>
            </div>

            <Table columns={columns} data={rates} loading={loading} />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function TaxRatesPageWrapper() {
  return (
    <ProtectedRoute permission="finance-tax-rates:view">
      <TaxRatesPage />
    </ProtectedRoute>
  );
}
