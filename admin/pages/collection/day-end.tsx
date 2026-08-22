import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import Table from '../../components/UI/Table';
import StatusBadge from '../../components/UI/StatusBadge';
import SearchableSelect from '../../components/UI/SearchableSelect';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import CollectionModuleNav from '../../components/Collection/CollectionModuleNav';
import CollectionTotalsRow, { splitTiles } from '../../components/Collection/CollectionTotalsRow';
import RiderSelect from '../../components/Collection/RiderSelect';
import {
  collectionService,
  DayEndResponse,
  RiderSummary,
} from '../../services/collectionService';
import { useAuth } from '../../contexts/AuthContext';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatRs } from '../../utils/formatCurrency';
import styles from '../../styles/ListPage.module.scss';

/** Spec §10 — the day-end summary: collection totals, delivered vs pending, order-wise list. */

const DayEndPage: React.FC = () => {
  const { user } = useAuth();
  const isRider = user?.role === 'delivery_man';

  const [data, setData] = useState<DayEndResponse | null>(null);
  const [riders, setRiders] = useState<RiderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [riderFilter, setRiderFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [date, setDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(
        await collectionService.getDayEnd({
          riderId: isRider ? undefined : riderFilter || undefined,
          cityKey: isRider ? undefined : cityFilter || undefined,
          date: date || undefined,
        }),
      );
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to load the day-end summary'));
    } finally {
      setLoading(false);
    }
  }, [isRider, riderFilter, cityFilter, date]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!isRider) collectionService.getRiders().then(setRiders).catch(() => {});
  }, [isRider]);

  const cityOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of riders) if (r.cityKey) seen.set(r.cityKey, r.city);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [riders]);

  const columns = [
    {
      key: 'invoiceNumber',
      title: 'Order #',
      render: (v: number | null, row: DayEndResponse['orders'][number]) =>
        v ? `#${v}` : row.orderId.slice(-8).toUpperCase(),
    },
    { key: 'shop', title: 'Shop' },
    ...(isRider ? [] : [{ key: 'rider', title: 'Rider' }, { key: 'city', title: 'City' }]),
    { key: 'status', title: 'Status', render: (v: string) => <StatusBadge status={v} /> },
    {
      key: 'amount',
      title: 'Amount',
      render: (v: number) => formatRs(v),
      total: 'sum' as const,
      totalRender: (v: number) => formatRs(v),
    },
    {
      key: 'cash',
      title: 'Cash',
      render: (v: number | null) => (v === null ? '-' : formatRs(v)),
      total: 'sum' as const,
      totalValue: (row: DayEndResponse['orders'][number]) => row.cash ?? 0,
      totalRender: (v: number) => formatRs(v),
    },
    {
      key: 'online',
      title: 'Online',
      render: (v: number | null) => (v === null ? '-' : formatRs(v)),
      total: 'sum' as const,
      totalValue: (row: DayEndResponse['orders'][number]) => row.online ?? 0,
      totalRender: (v: number) => formatRs(v),
    },
    {
      key: 'credit',
      title: 'Credit',
      render: (v: number | null) => (v === null ? '-' : formatRs(v)),
      total: 'sum' as const,
      totalValue: (row: DayEndResponse['orders'][number]) => row.credit ?? 0,
      totalRender: (v: number) => formatRs(v),
    },
    {
      key: 'deliveredAt',
      title: 'Delivered',
      render: (v: string | null) => (v ? format(new Date(v), 'HH:mm') : '—'),
    },
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Day-end Summary</h1>
        </div>

        <CollectionModuleNav active="day-end" />

        <div className={styles.listCard} style={{ marginTop: '1rem' }}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar}>
              {!isRider && (
                <>
                  <RiderSelect
                    riders={riders}
                    value={riderFilter}
                    onChange={setRiderFilter}
                    className={styles.searchSelect}
                  />
                  <SearchableSelect
                    name="cityFilter"
                    value={cityFilter}
                    onChange={(e) => setCityFilter(e.target.value)}
                    className={styles.searchSelect}
                    style={{ maxWidth: 190 }}
                    placeholder="All Cities"
                    options={[
                      { value: '', label: 'All Cities' },
                      ...cityOptions.map(([key, label]) => ({ value: key, label })),
                    ]}
                  />
                </>
              )}
              <DatePickerFilter value={date} onChange={setDate} placeholder="Date" title="Date" />
            </div>

            {data && (
              <>
                <CollectionTotalsRow tiles={splitTiles(data.totals)} />
                <CollectionTotalsRow
                  tiles={[
                    { label: 'Delivered', value: String(data.counts.delivered), tone: 'cash' },
                    { label: 'Pending', value: String(data.counts.pending), tone: 'credit' },
                    { label: 'Assigned', value: String(data.counts.assigned) },
                  ]}
                />
              </>
            )}
          </div>
        </div>

        <div className={styles.listCard} style={{ marginTop: '1rem' }}>
          <div className={styles.listCardBody}>
            <h2 style={{ margin: '0 0 0.75rem', fontSize: '1rem', color: '#111827' }}>
              Order-wise status
            </h2>
            {loading ? (
              <Loader />
            ) : (
              <Table
                columns={columns}
                data={data?.orders ?? []}
                showGrandTotal
                exportable
                noDataText="Nothing assigned for this day."
                exportFileName={`day-end-${data?.date ?? date}`}
                exportPdfTitle={`Day-end Summary — ${data?.date ?? date}`}
              />
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function DayEndPageWrapper() {
  return (
    <ProtectedRoute report="collection.day-end">
      <DayEndPage />
    </ProtectedRoute>
  );
}
