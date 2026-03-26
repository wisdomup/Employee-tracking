import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import StatusBadge from '../../components/UI/StatusBadge';
import { returnService, Return } from '../../services/returnService';
import { clientService, Client } from '../../services/clientService';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../styles/ListPage.module.scss';

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

  useEffect(() => {
    clientService.getClients().then(setClients).catch(() => {});
  }, []);

  useEffect(() => {
    fetchReturns();
  }, [clientFilter, typeFilter, statusFilter]);

  const fetchReturns = async () => {
    setLoading(true);
    try {
      const data = await returnService.getReturns({
        clientId: clientFilter || undefined,
        returnType: typeFilter || undefined,
        status: statusFilter || undefined,
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
          <button
            className={styles.deleteButton}
            onClick={(e) => {
              e.stopPropagation();
              handleDelete(row._id);
            }}
          >
            Delete
          </button>
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
        <div className={styles.searchBar}>
          <select
            value={clientFilter}
            onChange={(e) => setClientFilter(e.target.value)}
            className={styles.searchInput}
            style={{ maxWidth: 220 }}
          >
            <option value="">All Clients</option>
            {clients.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value)}
            className={styles.searchInput}
            style={{ maxWidth: 160 }}
          >
            <option value="">All Types</option>
            <option value="return">Return</option>
            <option value="damage">Damage</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={styles.searchInput}
            style={{ maxWidth: 160 }}
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="picked">Picked</option>
            <option value="completed">Completed</option>
          </select>
        </div>
        <Table
          columns={columns}
          data={returns}
          loading={loading}
          onRowClick={(row) => router.push(`/returns/${row._id}`)}
        />
      </div>
    </Layout>
  );
};

export default function ReturnsPageWrapper() {
  return (
    <ProtectedRoute>
      <ReturnsPage />
    </ProtectedRoute>
  );
}
