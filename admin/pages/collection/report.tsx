import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Loader from '../../components/UI/Loader';
import Table from '../../components/UI/Table';
import SearchableSelect from '../../components/UI/SearchableSelect';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import CollectionModuleNav from '../../components/Collection/CollectionModuleNav';
import CollectionTotalsRow, { splitTiles } from '../../components/Collection/CollectionTotalsRow';
import RiderSelect from '../../components/Collection/RiderSelect';
import CorrectCollectionModal from '../../components/Collection/CorrectCollectionModal';
import {
  collectionService,
  CollectionReport,
  ReportRow,
  RiderSummary,
} from '../../services/collectionService';
import { getApiErrorMessage } from '../../utils/apiError';
import { formatRs } from '../../utils/formatCurrency';
import styles from '../../styles/ListPage.module.scss';

/**
 * Spec §8 — the entry-wise collection report.
 *
 * Two things here are load-bearing:
 *
 * 1. STRICT CITY GROUPING. The API returns rows sorted by city plus a `cities[]` array of
 *    subtotals, and this page renders ONE table per city. That is unambiguously "city-wise
 *    strict grouping, no mixing" and it sidesteps a footer that would otherwise interleave.
 * 2. THE GRAND TOTAL. `Table`'s footer sums the rows handed to it, so a per-city table's footer
 *    is a per-city subtotal — correct, and labelled as such. The overall figure comes from the
 *    API's `totals`, which covers the whole filtered set rather than the current page.
 */

/** Named ranges, resolved at click time so "today" means today. */
const RANGE_PRESETS: { label: string; resolve: () => { from: string; to: string } }[] = [
  {
    label: 'Today',
    resolve: () => {
      const d = format(new Date(), 'yyyy-MM-dd');
      return { from: d, to: d };
    },
  },
  {
    label: 'Yesterday',
    resolve: () => {
      const d = new Date();
      d.setDate(d.getDate() - 1);
      const s = format(d, 'yyyy-MM-dd');
      return { from: s, to: s };
    },
  },
  {
    label: 'Last 7 days',
    resolve: () => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - 6);
      return { from: format(from, 'yyyy-MM-dd'), to: format(to, 'yyyy-MM-dd') };
    },
  },
  {
    label: 'This month',
    resolve: () => {
      const now = new Date();
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: format(from, 'yyyy-MM-dd'), to: format(now, 'yyyy-MM-dd') };
    },
  },
];

const CollectionReportPage: React.FC = () => {
  const [report, setReport] = useState<CollectionReport | null>(null);
  const [riders, setRiders] = useState<RiderSummary[]>([]);
  const [loading, setLoading] = useState(true);

  const [riderFilter, setRiderFilter] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [fromDate, setFromDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));
  const [toDate, setToDate] = useState(() => format(new Date(), 'yyyy-MM-dd'));

  const [correcting, setCorrecting] = useState<ReportRow | null>(null);
  const [correctBusy, setCorrectBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await collectionService.getReport({
        riderId: riderFilter || undefined,
        cityKey: cityFilter || undefined,
        from: fromDate || undefined,
        to: toDate || undefined,
        // One page big enough that the per-city tables are complete; the API caps at 2000.
        limit: 2000,
      });
      setReport(data);
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to load the collection report'));
    } finally {
      setLoading(false);
    }
  }, [riderFilter, cityFilter, fromDate, toDate]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    collectionService.getRiders().then(setRiders).catch(() => {});
  }, []);

  /** City options come from the rider roster, so a city with no entries yet is still selectable. */
  const cityOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of riders) if (r.cityKey) seen.set(r.cityKey, r.city);
    for (const c of report?.cities ?? []) if (c.cityKey) seen.set(c.cityKey, c.city);
    return [...seen.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [riders, report]);

  const activeFilterLabels = useMemo(() => {
    const parts: string[] = [];
    if (riderFilter) {
      const rider = riders.find((r) => r._id === riderFilter);
      parts.push(`Rider: ${rider ? rider.fullName || rider.username : riderFilter}`);
    }
    if (cityFilter) {
      parts.push(`City: ${cityOptions.find(([key]) => key === cityFilter)?.[1] ?? cityFilter}`);
    }
    if (fromDate) parts.push(`From: ${fromDate}`);
    if (toDate) parts.push(`To: ${toDate}`);
    return parts;
  }, [riderFilter, cityFilter, fromDate, toDate, riders, cityOptions]);

  const exportPdfTitle = activeFilterLabels.length
    ? `Collection Report — ${activeFilterLabels.join(' · ')}`
    : 'Collection Report';
  const exportFileName = activeFilterLabels.length
    ? `collection-report-${activeFilterLabels
        .map((l) => l.replace(/[^a-z0-9]+/gi, '-').toLowerCase())
        .join('_')}`
    : 'collection-report';

  const handleCorrect = async (split: { cash: number; online: number; credit: number; reason?: string }) => {
    if (!correcting) return;
    setCorrectBusy(true);
    try {
      await collectionService.correctCollection(correcting.collectionId, split);
      toast.success('Entry corrected');
      setCorrecting(null);
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to correct the entry'));
    } finally {
      setCorrectBusy(false);
    }
  };

  const handleVoid = async (row: ReportRow) => {
    const reason = window.prompt(
      `Void the collection for ${row.shop} (${formatRs(row.amount)})?\n\nThis removes it from every total. Give a reason:`,
    );
    if (!reason || reason.trim().length < 3) {
      if (reason !== null) toast.error('A reason of at least 3 characters is required.');
      return;
    }
    try {
      await collectionService.voidCollection(row.collectionId, reason.trim());
      toast.success('Entry voided');
      await load();
    } catch (error) {
      toast.error(getApiErrorMessage(error, 'Failed to void the entry'));
    }
  };

  // Columns exactly as the spec lists them: Order # | Shop | Rider | City | Amount | Cash |
  // Online | Credit | Date/Time.
  const columns = [
    {
      key: 'invoiceNumber',
      title: 'Order #',
      render: (v: number | null, row: ReportRow) =>
        v ? `#${v}` : row.orderId.slice(-8).toUpperCase(),
    },
    { key: 'shop', title: 'Shop' },
    { key: 'rider', title: 'Rider' },
    { key: 'city', title: 'City' },
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
      render: (v: number) => formatRs(v),
      total: 'sum' as const,
      totalRender: (v: number) => formatRs(v),
    },
    {
      key: 'online',
      title: 'Online',
      render: (v: number) => formatRs(v),
      total: 'sum' as const,
      totalRender: (v: number) => formatRs(v),
    },
    {
      key: 'credit',
      title: 'Credit',
      render: (v: number) => formatRs(v),
      total: 'sum' as const,
      totalRender: (v: number) => formatRs(v),
    },
    {
      key: 'deliveredAt',
      title: 'Date/Time',
      render: (v: string) => (v ? format(new Date(v), 'dd MMM yyyy, HH:mm') : '-'),
    },
    {
      key: 'actions',
      title: 'Actions',
      omitFromExport: true,
      render: (_: unknown, row: ReportRow) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              setCorrecting(row);
            }}
          >
            {row.corrected ? `Corrected ×${row.correctionCount}` : 'Correct'}
          </button>
          <button
            className={styles.deleteButton}
            onClick={(e) => {
              e.stopPropagation();
              handleVoid(row);
            }}
          >
            Void
          </button>
        </div>
      ),
    },
  ];

  const applyPreset = (preset: (typeof RANGE_PRESETS)[number]) => {
    const { from, to } = preset.resolve();
    setFromDate(from);
    setToDate(to);
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Collection Report</h1>
        </div>

        <CollectionModuleNav active="report" />

        <div className={styles.listCard} style={{ marginTop: '1rem' }}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar}>
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
              <DatePickerFilter value={fromDate} onChange={setFromDate} placeholder="From" title="From" />
              <DatePickerFilter value={toDate} onChange={setToDate} placeholder="To" title="To" />
            </div>

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
              {RANGE_PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => applyPreset(preset)}
                  style={{
                    border: '1px solid #d1d5db',
                    background: '#f9fafb',
                    borderRadius: 999,
                    padding: '0.25rem 0.85rem',
                    fontSize: '0.8125rem',
                    color: '#374151',
                    cursor: 'pointer',
                  }}
                >
                  {preset.label}
                </button>
              ))}
            </div>

            {activeFilterLabels.length > 0 && (
              <p className={styles.filterSummary}>
                Showing {report?.totals.count ?? 0} entr
                {report?.totals.count === 1 ? 'y' : 'ies'} — filtered by:{' '}
                {activeFilterLabels.join(' · ')}
              </p>
            )}

            {report && (
              <CollectionTotalsRow
                tiles={splitTiles({ ...report.totals, count: report.totals.count })}
              />
            )}
          </div>
        </div>

        {loading ? (
          <Loader />
        ) : !report || report.rows.length === 0 ? (
          <div className={styles.listCard}>
            <div className={styles.listCardBody}>
              <p style={{ color: '#6b7280', margin: 0 }}>
                No collection entries for this filter.
              </p>
              <p style={{ color: '#9ca3af', margin: '0.5rem 0 0', fontSize: '0.8125rem' }}>
                This report only covers deliveries a rider recorded through the app. Orders marked
                delivered before the collection module went live have no cash/online/credit split
                and never appear here.
              </p>
            </div>
          </div>
        ) : (
          report.cities.map((city) => {
            const cityRows = report.rows.filter((r) => r.cityKey === city.cityKey);
            return (
              <div key={city.cityKey || 'unassigned'} className={styles.listCard} style={{ marginBottom: '1rem' }}>
                <div className={styles.listCardBody}>
                  <div
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'baseline',
                      flexWrap: 'wrap',
                      gap: '0.5rem',
                      marginBottom: '0.75rem',
                    }}
                  >
                    <h2 style={{ margin: 0, fontSize: '1.0625rem', color: '#111827' }}>{city.city}</h2>
                    <span style={{ fontSize: '0.875rem', color: '#6b7280' }}>
                      {city.count} entr{city.count === 1 ? 'y' : 'ies'} · Total{' '}
                      <strong style={{ color: '#111827' }}>{formatRs(city.amount)}</strong> · Cash{' '}
                      {formatRs(city.cash)} · Online {formatRs(city.online)} · Credit{' '}
                      {formatRs(city.credit)}
                    </span>
                  </div>
                  <Table
                    columns={columns}
                    data={cityRows}
                    showGrandTotal
                    exportable
                    exportFileName={`${exportFileName}-${city.cityKey || 'unassigned'}`}
                    exportPdfTitle={`${exportPdfTitle} — ${city.city}`}
                  />
                </div>
              </div>
            );
          })
        )}

        {report && report.cities.length > 1 && (
          <div className={styles.listCard}>
            <div className={styles.listCardBody}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                }}
              >
                <strong style={{ fontSize: '1rem', color: '#111827' }}>
                  Grand total — all {report.cities.length} cities
                </strong>
                <span style={{ fontSize: '0.9375rem', color: '#111827' }}>
                  {formatRs(report.totals.amount)} · Cash {formatRs(report.totals.cash)} · Online{' '}
                  {formatRs(report.totals.online)} · Credit {formatRs(report.totals.credit)}
                </span>
              </div>
            </div>
          </div>
        )}
      </div>

      <CorrectCollectionModal
        open={!!correcting}
        row={correcting}
        busy={correctBusy}
        onClose={() => {
          if (!correctBusy) setCorrecting(null);
        }}
        onSubmit={handleCorrect}
      />
    </Layout>
  );
};

export default function CollectionReportPageWrapper() {
  return (
    <ProtectedRoute report="collection.report">
      <CollectionReportPage />
    </ProtectedRoute>
  );
}
