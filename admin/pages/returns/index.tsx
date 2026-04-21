import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import StatusBadge from '../../components/UI/StatusBadge';
import { returnService, Return } from '../../services/returnService';
import { clientService, Client } from '../../services/clientService';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../styles/ListPage.module.scss';
import SearchableSelect from '../../components/UI/SearchableSelect';

const STATUS_COLORS: Record<string, { bg: string; color: string }> = {
  pending: { bg: '#fef3c7', color: '#92400e' },
  approved: { bg: '#dbeafe', color: '#1e40af' },
  picked: { bg: '#ede9fe', color: '#5b21b6' },
  completed: { bg: '#d1fae5', color: '#065f46' },
};

const ReturnsPage: React.FC = () => {
  const [returns, setReturns] = useState<Return[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const router = useRouter();
  const { user } = useAuth();

  const activeFilterLabels = useMemo(() => {
    const parts: string[] = [];
    if (clientFilter) {
      const client = clients.find((c) => c._id === clientFilter);
      parts.push(`Client: ${client ? client.name : clientFilter}`);
    }
    if (typeFilter) parts.push(`Type: ${typeFilter.charAt(0).toUpperCase() + typeFilter.slice(1)}`);
    if (statusFilter) parts.push(`Status: ${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}`);
    return parts;
  }, [clientFilter, typeFilter, statusFilter, clients]);

  const exportPdfTitle = activeFilterLabels.length
    ? `Returns & Damages — Filtered by: ${activeFilterLabels.join(' · ')}`
    : 'Returns & Damages';

  const exportFileName = activeFilterLabels.length
    ? `returns-${activeFilterLabels.map((l) => l.replace(/[^a-z0-9]+/gi, '-').toLowerCase()).join('_')}`
    : 'returns';

  const returnCreatorId = (ret: Return): string => {
    const c = ret.createdBy;
    if (c == null) return '';
    if (typeof c === 'object' && '_id' in c) return String((c as { _id: string })._id);
    return String(c);
  };
  const canDeleteReturn = (ret: Return) => {
    if (user?.role === 'admin') return true;
    if (user?.role === 'order_taker' && ret.status === 'pending') {
      return !!user.id && returnCreatorId(ret) === user.id;
    }
    return false;
  };

  useEffect(() => {
    clientService.getClients().then(setClients).catch(() => {});
  }, []);

  useEffect(() => {
    if (!user) return;
    if (user.role === 'order_taker' && !user.id) return;
    fetchReturns();
  }, [clientFilter, typeFilter, statusFilter, user?.id, user?.role]);

  const fetchReturns = async () => {
    setLoading(true);
    try {
      const data = await returnService.getReturns({
        clientId: clientFilter || undefined,
        returnType: typeFilter || undefined,
        status: statusFilter || undefined,
        createdBy: user?.role === 'order_taker' && user.id ? user.id : undefined,
      });
      setReturns(data);
    } catch (error) {
      toast.error('Failed to fetch returns');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this return?')) return;
    try {
      await returnService.deleteReturn(id);
      toast.success('Return deleted');
      fetchReturns();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to delete return');
    }
  };

  const columns = [
    {
      key: 'dealerId',
      title: 'Client',
      render: (value: any) => value?.name || '-',
    },
    {
      key: 'returnType',
      title: 'Type',
      render: (value: string) => (
        <span
          style={{
            display: 'inline-block',
            padding: '0.25rem 0.75rem',
            borderRadius: '1rem',
            fontSize: '0.875rem',
            fontWeight: 500,
            background: value === 'return' ? '#dbeafe' : '#fef3c7',
            color: value === 'return' ? '#1e40af' : '#92400e',
          }}
        >
          {value ? value.charAt(0).toUpperCase() + value.slice(1) : '-'}
        </span>
      ),
    },
    {
      key: 'status',
      title: 'Status',
      render: (value: string) => {
        const colors = STATUS_COLORS[value] || { bg: '#f3f4f6', color: '#374151' };
        return (
          <span
            style={{
              display: 'inline-block',
              padding: '0.25rem 0.75rem',
              borderRadius: '1rem',
              fontSize: '0.875rem',
              fontWeight: 500,
              background: colors.bg,
              color: colors.color,
            }}
          >
            {value ? value.charAt(0).toUpperCase() + value.slice(1) : '-'}
          </span>
        );
      },
    },
    {
      key: 'products',
      title: 'Products',
      render: (value: any[]) => {
        if (!value || value.length === 0) return '-';
        const first = value[0]?.productId?.name || 'Product';
        return value.length === 1 ? first : `${first} +${value.length - 1} more`;
      },
    },
    {
      key: 'amount',
      title: 'Amount',
      render: (value: number) => (value != null ? `Rs. ${value.toFixed(2)}` : '-'),
    },
    {
      key: 'returnReason',
      title: 'Reason',
      render: (value: string) => value || '-',
    },
    {
      key: 'createdBy',
      title: 'Created By',
      render: (value: any) =>
        value
          ? `${value.username ?? value.userID ?? '-'}${value.role ? ` (${value.role})` : ''}`
          : '-',
    },
    {
      key: 'createdAt',
      title: 'Date',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '-'),
    },
    {
      key: '_id',
      title: 'Actions',
      render: (_: string, row: Return) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/returns/${row._id}`);
            }}
          >
            View
          </button>
          {canDeleteReturn(row) && (
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
          <h1>Returns &amp; Damages</h1>
          <button className={styles.addButton} onClick={() => router.push('/returns/create')}>
            + New Return
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
                  ...clients.map((d) => ({ value: d._id, label: d.name })),
                ]}
              />
              <SearchableSelect
                name="typeFilter"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
                className={styles.searchSelect}
                style={{ maxWidth: 160 }}
                placeholder="All Types"
                options={[
                  { value: '', label: 'All Types' },
                  { value: 'return', label: 'Return' },
                  { value: 'damage', label: 'Damage' },
                ]}
              />
              <SearchableSelect
                name="statusFilter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={styles.searchSelect}
                style={{ maxWidth: 160 }}
                placeholder="All Statuses"
                options={[
                  { value: '', label: 'All Statuses' },
                  { value: 'pending', label: 'Pending' },
                  { value: 'approved', label: 'Approved' },
                  { value: 'picked', label: 'Picked' },
                  { value: 'completed', label: 'Completed' },
                ]}
              />
            </div>
            {activeFilterLabels.length > 0 && (
              <p className={styles.filterSummary}>
                Showing {returns.length} record{returns.length !== 1 ? 's' : ''} — filtered by:{' '}
                {activeFilterLabels.join(' · ')}
              </p>
            )}
            <Table
              columns={columns}
              data={returns}
              loading={loading}
              onRowClick={(row) => router.push(`/returns/${row._id}`)}
              exportFileName={exportFileName}
              exportPdfTitle={exportPdfTitle}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function ReturnsPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <ReturnsPage />
    </ProtectedRoute>
  );
}
