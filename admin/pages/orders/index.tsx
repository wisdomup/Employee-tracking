import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import StatusBadge from '../../components/UI/StatusBadge';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { orderService, Order } from '../../services/orderService';
import { clientService, Client, formatClientSelectLabel } from '../../services/clientService';
import { employeeService, Employee } from '../../services/employeeService';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../utils/permissions';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import ApproveOrderTermsModal from '../../components/ApproveOrderTermsModal';
import AssignRiderModal, { riderOptionLabel } from '../../components/Collection/AssignRiderModal';
import styles from '../../styles/ListPage.module.scss';
import { withDefaultInvoiceTerms } from '../../utils/defaultInvoiceTerms';

/** Populated user refs come back as objects; fall back gracefully when only an id is present. */
function riderName(value: any): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value.fullName || value.username || value.userID || '';
}

const OrdersPage: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [riders, setRiders] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [riderFilter, setRiderFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [approveModalId, setApproveModalId] = useState<string | null>(null);
  const [approveTermsDraft, setApproveTermsDraft] = useState('');
  const [approveRiderDraft, setApproveRiderDraft] = useState('');
  const [approveBusy, setApproveBusy] = useState(false);
  const [assignOrder, setAssignOrder] = useState<Order | null>(null);
  const [assignBusy, setAssignBusy] = useState(false);
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOrderTaker = user?.role === 'order_taker';
  const canEditOrder = (order: Order) =>
    isAdmin || (user?.role === 'order_taker' && order.status === 'pending');

  const activeFilterLabels = useMemo(() => {
    const parts: string[] = [];
    if (clientFilter) {
      const client = clients.find((c) => c._id === clientFilter);
      parts.push(`Client: ${client ? client.name : clientFilter}`);
    }
    if (statusFilter) parts.push(`Status: ${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}`);
    if (!isOrderTaker && employeeFilter) {
      const emp = employees.find((e) => e._id === employeeFilter);
      parts.push(`Employee: ${emp ? emp.username : employeeFilter}`);
    }
    if (isAdmin && riderFilter) {
      if (riderFilter === 'unassigned') parts.push('Rider: Unassigned');
      else {
        const rider = riders.find((r) => r._id === riderFilter);
        parts.push(`Rider: ${rider ? rider.fullName || rider.username : riderFilter}`);
      }
    }
    if (startDate) parts.push(`From: ${startDate}`);
    if (endDate) parts.push(`To: ${endDate}`);
    return parts;
  }, [
    clientFilter,
    statusFilter,
    employeeFilter,
    riderFilter,
    startDate,
    endDate,
    clients,
    employees,
    riders,
    isOrderTaker,
    isAdmin,
  ]);

  const exportPdfTitle = activeFilterLabels.length
    ? `Orders — Filtered by: ${activeFilterLabels.join(' · ')}`
    : 'Orders';

  const exportFileName = activeFilterLabels.length
    ? `orders-${activeFilterLabels.map((l) => l.replace(/[^a-z0-9]+/gi, '-').toLowerCase()).join('_')}`
    : 'orders';

  useEffect(() => {
    clientService.getClients().then(setClients).catch(() => {});
    if (!isOrderTaker) {
      employeeService.getEmployees().then(setEmployees).catch(() => {});
    }
    // Only an admin can assign, so only an admin needs the rider roster.
    if (isAdmin) {
      employeeService.getRiders().then(setRiders).catch(() => {});
    }
  }, [isOrderTaker, isAdmin]);

  /**
   * Seed the filters from the URL so other pages can link straight into a filtered view —
   * `/orders?status=delivered&startDate=…&endDate=…` is what the dashboard's sales and order
   * cards open. Same pattern as `/visits`.
   *
   * Only keys actually present are applied, so a plain `/orders` still lands on the full list.
   * Keyed on `router.asPath` rather than on the filter state: editing a filter in the UI does
   * not touch the URL, so this cannot fight the user's input, but arriving from a second
   * dashboard card while already on this page does re-apply.
   */
  useEffect(() => {
    if (!router.isReady) return;
    const {
      status,
      startDate: from,
      endDate: to,
      clientId,
      employeeId,
      riderId,
    } = router.query as Record<string, string | undefined>;

    if (status) setStatusFilter(status);
    if (from) setStartDate(from);
    if (to) setEndDate(to);
    if (clientId) setClientFilter(clientId);
    if (employeeId) setEmployeeFilter(employeeId);
    if (riderId) setRiderFilter(riderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, router.asPath]);

  useEffect(() => {
    if (!user) return;
    if (user.role === 'order_taker' && !user.id) return;
    fetchOrders();
  }, [clientFilter, statusFilter, employeeFilter, riderFilter, startDate, endDate, user?.id, user?.role]);

  const fetchOrders = async () => {
    setLoading(true);
    try {
      const data = await orderService.getOrders({
        clientId: clientFilter || undefined,
        status: statusFilter || undefined,
        createdBy:
          user?.role === 'order_taker' && user.id
            ? user.id
            : employeeFilter || undefined,
        assignedRiderId: isAdmin ? riderFilter || undefined : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setOrders(data);
    } catch (error) {
      toast.error('Failed to fetch orders');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this order?')) return;
    try {
      await orderService.deleteOrder(id);
      toast.success('Order deleted');
      fetchOrders();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to delete order');
    }
  };

  const openApproveModal = (row: Order) => {
    setApproveModalId(row._id);
    setApproveTermsDraft(withDefaultInvoiceTerms(row.termsAndConditions));
    setApproveRiderDraft(row.assignedRiderId?._id ?? '');
  };

  const closeApproveModal = () => {
    if (approveBusy) return;
    setApproveModalId(null);
    setApproveTermsDraft('');
    setApproveRiderDraft('');
  };

  const handleApproveConfirm = async () => {
    if (!approveModalId) return;
    setApproveBusy(true);
    try {
      await orderService.approveOrder(approveModalId, {
        termsAndConditions: approveTermsDraft,
        // Omitted rather than sent empty when nobody was picked, so "assign later" stays a
        // distinct choice from "unassign".
        ...(approveRiderDraft ? { assignedRiderId: approveRiderDraft } : {}),
      });
      toast.success(approveRiderDraft ? 'Order approved and assigned' : 'Order approved');
      setApproveModalId(null);
      setApproveTermsDraft('');
      setApproveRiderDraft('');
      fetchOrders();
    } catch (error: any) {
      // The modal deliberately stays open: the rider choice and the terms draft are worth
      // keeping when the server rejects (usually a rider with no city).
      toast.error(error.response?.data?.message || 'Failed to approve order');
    } finally {
      setApproveBusy(false);
    }
  };

  const handleAssignRider = async (riderId: string) => {
    if (!assignOrder) return;
    setAssignBusy(true);
    try {
      await orderService.assignRider(assignOrder._id, riderId || null);
      toast.success(riderId ? 'Rider assigned' : 'Rider removed');
      setAssignOrder(null);
      fetchOrders();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to assign rider');
    } finally {
      setAssignBusy(false);
    }
  };

  /** Assignment is meaningless before approval and frozen once delivered. */
  const canAssignRider = (row: Order) =>
    isAdmin && !['pending', 'delivered', 'cancelled'].includes(row.status);

  /** Order value, falling back to line totals less discount when `grandTotal` was never stored. */
  const orderTotal = (row: Order, value?: number | null): number | null => {
    const stored = value ?? row.grandTotal ?? row.totalPrice;
    if (stored !== undefined && stored !== null) return Number(stored);
    const fromProducts = row.products?.reduce(
      (sum, p) =>
        sum +
        (p.quantity ?? 0) * (typeof p.price === 'number' ? p.price : 0) -
        (typeof p.discount === 'number' ? p.discount : 0),
      0,
    );
    return fromProducts == null ? null : fromProducts - (row.discount ?? 0);
  };

  const columns = [
    {
      key: '_id',
      title: 'Order ID',
      render: (value: string) => value.slice(-8).toUpperCase(),
    },
    {
      key: 'dealerId',
      title: 'Client',
      render: (value: any) =>
        value?._id ? (
          <Link
            href={`/clients/${value._id}`}
            onClick={(e) => e.stopPropagation()}
            style={{ color: 'var(--admin-primary)', textDecoration: 'underline' }}
          >
            {value.name || '-'}
          </Link>
        ) : (
          value?.name || '-'
        ),
    },
    {
      key: 'grandTotal',
      title: 'Grand Total',
      render: (value: number, row: Order) => {
        const total = orderTotal(row, value);
        return total == null ? '-' : `Rs. ${total.toFixed(2)}`;
      },
      total: 'sum' as const,
      // Same fallback chain the cell uses, so the footer cannot disagree with the column above it.
      totalValue: (row: Order) => orderTotal(row, row.grandTotal) ?? 0,
      totalRender: (value: number) => `Rs. ${value.toFixed(2)}`,
    },
    {
      key: 'paymentType',
      title: 'Payment Type',
      render: (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : '-'),
    },
    {
      key: 'warehouseId',
      title: 'Source Warehouse',
      render: (value: any) => value?.name ?? '-',
      exportValue: (row: Order) => row.warehouseId?.name ?? '',
    },
    {
      key: 'status',
      title: 'Status',
      render: (value: string) => <StatusBadge status={value} />,
    },
    {
      key: 'createdBy',
      title: 'Created By',
      render: (value: any) =>
        value ? `${value.username ?? value.userID ?? '-'}${value.role ? ` (${value.role})` : ''}` : '-',
    },
    {
      key: 'assignedRiderId',
      title: 'Rider',
      render: (value: any, row: Order) => {
        const name = riderName(value);
        if (name) return name;
        // An approved order nobody is carrying is the actionable state worth highlighting.
        return row.status === 'approved' ? (
          <span style={{ color: '#b45309' }}>Unassigned</span>
        ) : (
          '-'
        );
      },
      exportValue: (row: Order) => riderName(row.assignedRiderId),
    },
    {
      key: 'createdAt',
      title: 'Order Date',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '-'),
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (_: any, row: Order) => (
        <div className={styles.actions}>
          {isAdmin && row.status === 'pending' && (
            <button
              className={styles.approveButton}
              onClick={(e) => {
                e.stopPropagation();
                openApproveModal(row);
              }}
            >
              Approve
            </button>
          )}
          {canAssignRider(row) && (
            <button
              className={styles.editButton}
              onClick={(e) => {
                e.stopPropagation();
                setAssignOrder(row);
              }}
            >
              {row.assignedRiderId ? 'Reassign' : 'Assign'}
            </button>
          )}
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/orders/${row._id}`);
            }}
          >
            View
          </button>
          {canEditOrder(row) && (
            <button
              className={styles.editButton}
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/orders/${row._id}/edit`);
              }}
            >
              Edit
            </button>
          )}
          {can(undefined, 'orders:delete') && (
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
          <h1>Orders</h1>
          {can(undefined, 'orders:add') && (
          <button className={styles.addButton} onClick={() => router.push('/orders/create')}>
            + Create Order
          </button>
          )}
        </div>

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
                  ...clients.map((d) => ({ value: d._id, label: formatClientSelectLabel(d) })),
                ]}
              />
              <SearchableSelect
                name="statusFilter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={styles.searchSelect}
                style={{ maxWidth: 180 }}
                placeholder="All Statuses"
                options={[
                  { value: '', label: 'All Statuses' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'approved', label: 'Approved' },
                  { value: 'packed', label: 'Packed' },
                  { value: 'dispatched', label: 'Dispatched' },
                  { value: 'delivered', label: 'Delivered' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]}
              />
              {!isOrderTaker && (
                <SearchableSelect
                  name="employeeFilter"
                  value={employeeFilter}
                  onChange={(e) => setEmployeeFilter(e.target.value)}
                  className={styles.searchSelect}
                  style={{ maxWidth: 200 }}
                  placeholder="All Employees"
                  options={[
                    { value: '', label: 'All Employees' },
                    ...employees.map((e) => ({ value: e._id, label: e.username })),
                  ]}
                />
              )}
              {isAdmin && (
                <SearchableSelect
                  name="riderFilter"
                  value={riderFilter}
                  onChange={(e) => setRiderFilter(e.target.value)}
                  className={styles.searchSelect}
                  style={{ maxWidth: 200 }}
                  placeholder="All Riders"
                  options={[
                    { value: '', label: 'All Riders' },
                    { value: 'unassigned', label: 'Unassigned' },
                    ...riders.map((r) => ({ value: r._id, label: riderOptionLabel(r) })),
                  ]}
                />
              )}
              <DatePickerFilter
                value={startDate}
                onChange={setStartDate}
                placeholder="Start date"
                title="Order date from"
              />
              <DatePickerFilter
                value={endDate}
                onChange={setEndDate}
                placeholder="End date"
                title="Order date to"
              />
            </div>
            {activeFilterLabels.length > 0 && (
              <p className={styles.filterSummary}>
                Showing {orders.length} record{orders.length !== 1 ? 's' : ''} — filtered by:{' '}
                {activeFilterLabels.join(' · ')}
              </p>
            )}
            <Table
              columns={columns}
              data={orders}
              loading={loading}
              onRowClick={(row) => router.push(`/orders/${row._id}`)}
              exportFileName={exportFileName}
              exportPdfTitle={exportPdfTitle}
            />
          </div>
        </div>
      </div>
      <ApproveOrderTermsModal
        open={!!approveModalId}
        editorKey={approveModalId ?? undefined}
        value={approveTermsDraft}
        onChange={setApproveTermsDraft}
        onClose={closeApproveModal}
        onApprove={handleApproveConfirm}
        busy={approveBusy}
        riders={
          isAdmin
            ? riders.map((r) => ({
                _id: r._id,
                label: riderOptionLabel(r),
                city: r.address?.city?.trim() ?? '',
              }))
            : undefined
        }
        assignedRiderId={approveRiderDraft}
        onRiderChange={isAdmin ? setApproveRiderDraft : undefined}
      />
      <AssignRiderModal
        open={!!assignOrder}
        orderLabel={
          assignOrder
            ? `${assignOrder.invoiceNumber ? `#${assignOrder.invoiceNumber}` : assignOrder._id.slice(-8).toUpperCase()} — ${
                assignOrder.dealerId?.name ?? 'Client'
              }`
            : ''
        }
        riders={riders}
        currentRiderId={assignOrder?.assignedRiderId?._id ?? ''}
        busy={assignBusy}
        onClose={() => {
          if (!assignBusy) setAssignOrder(null);
        }}
        onSubmit={handleAssignRider}
      />
    </Layout>
  );
};

export default function OrdersPageWrapper() {
  return (
    <ProtectedRoute permission="orders:view">
      <OrdersPage />
    </ProtectedRoute>
  );
}
