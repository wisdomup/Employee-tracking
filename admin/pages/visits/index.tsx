import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import StatusBadge from '../../components/UI/StatusBadge';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import SearchableSelect from '../../components/UI/SearchableSelect';
import VisitsMonthCalendar from '../../components/Visits/VisitsMonthCalendar';
import AssignVisitsModal from '../../components/Visits/AssignVisitsModal';
import VisitsDayView from '../../components/Visits/VisitsDayView';
import {
  visitService,
  Visit,
  formatVisitOrderAmount,
  VISIT_DURATION_LIMIT_MINUTES,
} from '../../services/visitService';
import { clientService, Client } from '../../services/clientService';
import { employeeService, Employee } from '../../services/employeeService';
import { useAuth } from '../../contexts/AuthContext';
import { can, ALL_ROLES } from '../../utils/permissions';
import { toast } from 'react-toastify';
import { endOfMonth, format, startOfMonth } from 'date-fns';
import styles from '../../styles/ListPage.module.scss';
import calendarStyles from '../../styles/VisitsCalendar.module.scss';

type ViewMode = 'calendar' | 'list' | 'day';

const VisitsPage: React.FC = () => {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [overstayOnly, setOverstayOnly] = useState(false);
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const seesOnlyOwnVisits =
    !!user?.role &&
    user.role !== 'admin' &&
    ['order_taker', 'employee', 'warehouse_manager', 'delivery_man'].includes(user.role);
  const [view, setView] = useState<ViewMode>(isAdmin ? 'calendar' : 'day');
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [assignDate, setAssignDate] = useState<Date | null>(null);
  const [assignExistingVisits, setAssignExistingVisits] = useState<Visit[]>([]);
  /**
   * False until the list's default date bound has been decided. The fetch waits on it so
   * the page cannot fire one unbounded request before the default lands and a second one
   * after it — which would cost more than having no default at all.
   */
  const [listBoundsReady, setListBoundsReady] = useState(false);
  /** The default is a starting point, not a rule: once decided, never re-imposed. */
  const listDefaultDecided = useRef(false);

  const activeFilterLabels = useMemo(() => {
    const parts: string[] = [];
    if (clientFilter) {
      const client = clients.find((c) => c._id === clientFilter);
      parts.push(`Client: ${client ? client.name : clientFilter}`);
    }
    if (!seesOnlyOwnVisits && employeeFilter) {
      const emp = employees.find((e) => e._id === employeeFilter);
      parts.push(`Employee: ${emp ? emp.username : employeeFilter}`);
    }
    if (statusFilter) parts.push(`Status: ${statusFilter.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())}`);
    if (startDate) parts.push(`From: ${startDate}`);
    if (endDate) parts.push(`To: ${endDate}`);
    if (overstayOnly) parts.push('Overstay flagged only');
    return parts;
  }, [clientFilter, employeeFilter, statusFilter, startDate, endDate, overstayOnly, clients, employees, seesOnlyOwnVisits]);

  const exportPdfTitle = activeFilterLabels.length
    ? `Visits — Filtered by: ${activeFilterLabels.join(' · ')}`
    : 'Visits';

  const exportFileName = activeFilterLabels.length
    ? `visits-${activeFilterLabels.map((l) => l.replace(/[^a-z0-9]+/gi, '-').toLowerCase()).join('_')}`
    : 'visits';

  useEffect(() => {
    // Both lists only label filter dropdowns, so ask for the picker-sized payload rather
    // than every client record with its route and creator joined in.
    clientService.getClients({ fields: 'options' }).then(setClients).catch(() => {});
    if (isAdmin) {
      employeeService.getEmployees().then(setEmployees).catch(() => {});
    }
  }, [isAdmin]);

  /**
   * Seed the filters from the URL so other pages can link straight into a filtered view —
   * `/visits?status=completed&view=list` is what the dashboard's Completed Visits card opens.
   *
   * Applied once the router has resolved the query, and only from keys that are actually
   * present, so a normal visit to `/visits` still lands on the default calendar.
   */
  useEffect(() => {
    if (!router.isReady) return;
    const { status, view: viewParam, startDate: from, endDate: to, employeeId, clientId, overstay } =
      router.query as Record<string, string | undefined>;

    if (status) setStatusFilter(status);
    if (from) setStartDate(from);
    if (to) setEndDate(to);
    if (employeeId) setEmployeeFilter(employeeId);
    if (clientId) setClientFilter(clientId);
    if (overstay === 'true') setOverstayOnly(true);

    if (viewParam === 'list' || viewParam === 'calendar' || viewParam === 'day') {
      setView(viewParam);
    } else if (status || from || to || employeeId || clientId || overstay) {
      // A filtered link means "show me these rows"; the calendar cannot express a status
      // filter, so anything filtered lands on the list.
      setView('list');
    }
    // Keyed on the URL, not on the filter state: editing a filter in the UI changes state
    // without touching the URL, so this cannot fight the user's input — but arriving from a
    // second dashboard card while already on this page does re-apply, which keying on
    // `isReady` alone would have missed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.asPath]);

  /**
   * The list has no inherent bound: with no date filter it asks the API for every visit
   * ever recorded, which the table then paginates in the browser. Default it to the
   * current month the first time the list is shown.
   *
   * The dates are written into the filter inputs rather than applied invisibly, so the
   * range is visible in the pickers and the filter summary, and the user can widen or
   * clear it like any other filter. The URL query is read directly rather than the filter
   * state so this cannot race the effect above: a link that already carries a range keeps
   * it, and nothing is defaulted over the top.
   */
  useEffect(() => {
    if (view !== 'list' || listDefaultDecided.current || !router.isReady) return;
    listDefaultDecided.current = true;

    const { startDate: from, endDate: to } = router.query as Record<string, string | undefined>;
    if (!from && !to && !startDate && !endDate) {
      const now = new Date();
      setStartDate(format(startOfMonth(now), 'yyyy-MM-dd'));
      setEndDate(format(endOfMonth(now), 'yyyy-MM-dd'));
    }
    setListBoundsReady(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, router.isReady]);

  useEffect(() => {
    if (!user || view !== 'list' || !listBoundsReady) return;
    fetchVisits();
  }, [clientFilter, statusFilter, employeeFilter, startDate, endDate, overstayOnly, user?.id, seesOnlyOwnVisits, view, listBoundsReady]);

  const fetchVisits = async () => {
    setLoading(true);
    try {
      const effectiveEmployeeId = seesOnlyOwnVisits && user?.id ? user.id : (employeeFilter || undefined);
      const data = await visitService.getVisits({
        clientId: clientFilter || undefined,
        status: statusFilter || undefined,
        employeeId: effectiveEmployeeId,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
        overstayFlagged: overstayOnly || undefined,
      });
      setVisits(data);
    } catch (error) {
      toast.error('Failed to fetch visits');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this visit?')) return;
    try {
      await visitService.deleteVisit(id);
      toast.success('Visit deleted');
      fetchVisits();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to delete visit');
    }
  };

  const columns = [
    {
      key: 'dealerId',
      title: 'Client',
      render: (value: any) => value?.name || '-',
    },
    {
      key: 'employeeId',
      title: 'Employee',
      render: (value: any) => value?.username || '-',
    },
    {
      key: 'routeId',
      title: 'Route',
      render: (value: any) => value?.name || '-',
    },
    {
      key: 'visitDate',
      title: 'Visit Date',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '-'),
    },
    {
      key: 'status',
      title: 'Status',
      render: (value: string, row: Visit) => (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', flexWrap: 'wrap' }}>
          <StatusBadge status={value} />
          {row.overstayFlagged && (
            <span
              title={`Rider spent ${row.durationMinutes} min at the store, over the ${VISIT_DURATION_LIMIT_MINUTES} min limit`}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                padding: '0.125rem 0.5rem',
                borderRadius: '9999px',
                background: '#fef2f2',
                color: '#b91c1c',
                border: '1px solid #fecaca',
                fontSize: '0.75rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
              }}
            >
              ⚠️ Overstay
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'durationMinutes',
      title: 'Time At Store',
      render: (value: number | undefined, row: Visit) =>
        value == null ? (
          '-'
        ) : (
          <span style={row.overstayFlagged ? { color: '#b91c1c', fontWeight: 600 } : undefined}>
            {value} min
          </span>
        ),
      // Visits without a recorded duration sit out of the divisor, so they cannot drag it down.
      total: 'avg' as const,
      totalRender: (value: number) => `${Math.round(value * 10) / 10} min avg`,
    },
    {
      key: 'orderSummary',
      title: 'Order',
      // The reporting ask: the order amount against the visit it was taken during, and an
      // explicit "No Order" otherwise — never a blank cell, which reads as missing data.
      render: (_: unknown, row: Visit) => {
        const summary = row.orderSummary;
        if (!summary || summary.orderCount === 0) {
          return <span style={{ color: '#b45309', fontWeight: 600 }}>No Order</span>;
        }
        return (
          <span
            style={{ color: '#047857', fontWeight: 700, whiteSpace: 'nowrap' }}
            title={
              `${summary.orderCount} order(s) taken during this visit` +
              (summary.invoiceNumbers.length ? ` — invoice #${summary.invoiceNumbers.join(', #')}` : '') +
              (summary.cancelledCount > 0
                ? ` · ${summary.cancelledCount} cancelled, excluded from the amount`
                : '')
            }
          >
            {formatVisitOrderAmount(summary)}
            {summary.orderCount > 1 ? ` (${summary.orderCount})` : ''}
          </span>
        );
      },
      // The same text the cell shows, without the styling: an amount, or "No Order".
      exportValue: (row: unknown) => {
        const summary = (row as Visit).orderSummary;
        if (!summary || summary.orderCount === 0) return 'No Order';
        return (
          formatVisitOrderAmount(summary) + (summary.orderCount > 1 ? ` (${summary.orderCount})` : '')
        );
      },
      total: 'sum' as const,
      totalValue: (row: Visit) => row.orderSummary?.totalAmount ?? 0,
      totalRender: (value: number) =>
        `Rs. ${value.toLocaleString('en-PK', { maximumFractionDigits: 2 })}`,
    },
    {
      key: 'createdBy',
      title: 'Created By',
      render: (value: any) =>
        value ? `${value.username ?? value.userID ?? '-'}${value.role ? ` (${value.role})` : ''}` : '-',
    },
    {
      key: '_id',
      title: 'Actions',
      // Auto-omit covers keys named actions/select only, and this column is keyed '_id' —
      // without this the export carries a column of raw ObjectIds titled "Actions".
      omitFromExport: true,
      render: (_: string, row: Visit) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/visits/${row._id}`);
            }}
          >
            View
          </button>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/visits/${row._id}/edit`);
            }}
          >
            Edit
          </button>
          {can(undefined, 'visits:delete') && (
            <button
              className={styles.deleteButton}
              onClick={(e) => {
                e.stopPropagation();
                handleDelete(row._id);
              }}
            >
              Delete
            </button>
          )}
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Visits</h1>
          {can(undefined, 'visits:add') && (
            <button className={styles.addButton} onClick={() => router.push('/visits/create')}>
              + Schedule Visit
            </button>
          )}
        </div>

        <div className={calendarStyles.viewTabs}>
          {(isAdmin ? (['calendar', 'list'] as ViewMode[]) : (['day', 'list'] as ViewMode[])).map((tab) => (
            <button
              key={tab}
              type="button"
              className={`${calendarStyles.viewTabButton} ${
                view === tab ? calendarStyles.viewTabButtonActive : ''
              }`}
              onClick={() => setView(tab)}
            >
              {tab === 'calendar' ? 'Calendar' : tab === 'day' ? 'Day' : 'List'}
            </button>
          ))}
        </div>

        {view === 'calendar' && isAdmin && (
          <>
            <VisitsMonthCalendar
              employeeId={employeeFilter || undefined}
              refreshKey={calendarRefreshKey}
              onDayClick={(day, dayVisits) => {
                setAssignDate(day);
                setAssignExistingVisits(dayVisits);
              }}
            />
            {assignDate && (
              <AssignVisitsModal
                date={assignDate}
                existingVisits={assignExistingVisits}
                onClose={() => setAssignDate(null)}
                onAssigned={() => setCalendarRefreshKey((k) => k + 1)}
              />
            )}
          </>
        )}

        {view === 'day' && user?.id && <VisitsDayView employeeId={user.id} />}

        {view === 'list' && (
        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar}>
              <SearchableSelect
                name="clientFilter"
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className={styles.searchSelect}
                style={{ maxWidth: 220 }}
                placeholder="All Clients"
                options={[
                  { value: '', label: 'All Clients' },
                  ...clients.map((d) => ({ value: d._id, label: d.name })),
                ]}
              />
              {!seesOnlyOwnVisits && (
                <SearchableSelect
                  name="employeeFilter"
                  value={employeeFilter}
                  onChange={(e) => setEmployeeFilter(e.target.value)}
                  className={styles.searchSelect}
                  style={{ maxWidth: 220 }}
                  placeholder="All Employees"
                  options={[
                    { value: '', label: 'All Employees' },
                    ...employees.map((e) => ({ value: e._id, label: e.username })),
                  ]}
                />
              )}
              <SearchableSelect
                name="statusFilter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={styles.searchSelect}
                style={{ maxWidth: 180 }}
                placeholder="All Statuses"
                options={[
                  { value: '', label: 'All Statuses' },
                  { value: 'todo', label: 'To Do' },
                  { value: 'in_progress', label: 'In Progress' },
                  { value: 'checked_in', label: 'Checked In' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'incomplete', label: 'Incomplete' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]}
              />
              <DatePickerFilter
                value={startDate}
                onChange={setStartDate}
                placeholder="Start date"
                title="Start date"
              />
              <DatePickerFilter
                value={endDate}
                onChange={setEndDate}
                placeholder="End date"
                title="End date"
              />
              <label
                title={`Show only visits where the rider stayed longer than ${VISIT_DURATION_LIMIT_MINUTES} minutes`}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '0.375rem',
                  fontSize: '0.875rem',
                  color: overstayOnly ? '#b91c1c' : '#374151',
                  cursor: 'pointer',
                  whiteSpace: 'nowrap',
                }}
              >
                <input
                  type="checkbox"
                  checked={overstayOnly}
                  onChange={(e) => setOverstayOnly(e.target.checked)}
                />
                ⚠️ Overstay flagged only
              </label>
            </div>
            {activeFilterLabels.length > 0 && (
              <p className={styles.filterSummary}>
                Showing {visits.length} record{visits.length !== 1 ? 's' : ''} — filtered by:{' '}
                {activeFilterLabels.join(' · ')}
              </p>
            )}
            <Table
              columns={columns}
              data={visits}
              loading={loading}
              onRowClick={(row) => router.push(`/visits/${row._id}`)}
              exportFileName={exportFileName}
              exportPdfTitle={exportPdfTitle}
            />
          </div>
        </div>
        )}
      </div>
    </Layout>
  );
};

export default function VisitsPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={ALL_ROLES}>
      <VisitsPage />
    </ProtectedRoute>
  );
}
