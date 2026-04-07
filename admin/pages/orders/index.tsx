import React, { useEffect, useState } from 'react';
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
import styles from '../../styles/ListPage.module.scss';

const OrdersPage: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOrderTaker = user?.role === 'order_taker';
  const canEditOrder = (order: Order) =>
    isAdmin || (user?.role === 'order_taker' && order.status === 'pending');

  useEffect(() => {
    clientService.getClients().then(setClients).catch(() => {});
    if (!isOrderTaker) {
      employeeService.getEmployees().then(setEmployees).catch(() => {});
    }
  }, [isOrderTaker]);

  useEffect(() => {
    if (!user) return;
    if (user.role === 'order_taker' && !user.id) return;
    fetchOrders();
  }, [clientFilter, statusFilter, employeeFilter, startDate, endDate, user?.id, user?.role]);

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

  const handleApprove = async (id: string) => {
    try {
      await orderService.approveOrder(id);
      toast.success('Order approved');
      fetchOrders();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to approve order');
    }
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
      render: (value: any) => value?.name || '-',
    },
    {
      key: 'grandTotal',
      title: 'Grand Total',
      render: (value: number, row: Order) => {
        const total = value ?? row.grandTotal ?? row.totalPrice;
        if (total !== undefined && total !== null) return `Rs. ${Number(total).toFixed(2)}`;
        const fromProducts = row.products?.reduce(
          (sum, p) => sum + (p.quantity ?? 0) * (typeof p.price === 'number' ? p.price : 0),
          0
        );
        if (fromProducts != null) {
          const discount = row.discount ?? 0;
          return `Rs. ${(fromProducts - discount).toFixed(2)}`;
        }
        return '-';
      },
    },
    {
      key: 'paymentType',
      title: 'Payment Type',
      render: (value: string) => (value ? value.charAt(0).toUpperCase() + value.slice(1) : '-'),
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
                handleApprove(row._id);
              }}
            >
              Approve
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
          {isAdmin && (
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
          <button className={styles.addButton} onClick={() => router.push('/orders/create')}>
            + Create Order
          </button>
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
            <Table
              columns={columns}
              data={orders}
              loading={loading}
              onRowClick={(row) => router.push(`/orders/${row._id}`)}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function OrdersPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <OrdersPage />
    </ProtectedRoute>
  );
}
