import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import { returnService, Return } from '../../services/returnService';
import { dealerService, Dealer } from '../../services/dealerService';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../styles/ListPage.module.scss';

const ReturnsPage: React.FC = () => {
  const [returns, setReturns] = useState<Return[]>([]);
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [loading, setLoading] = useState(true);
  const [dealerFilter, setDealerFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const router = useRouter();

  useEffect(() => {
    dealerService.getDealers().then(setDealers).catch(() => {});
  }, []);

  useEffect(() => {
    fetchReturns();
  }, [dealerFilter, typeFilter]);

  const fetchReturns = async () => {
    setLoading(true);
    try {
      const data = await returnService.getReturns({
        dealerId: dealerFilter || undefined,
        returnType: typeFilter || undefined,
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
      key: 'productId',
      title: 'Product',
      render: (value: any) => value?.name || '-',
    },
    {
      key: 'dealerId',
      title: 'Dealer',
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
          {value.charAt(0).toUpperCase() + value.slice(1)}
        </span>
      ),
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
        value ? `${value.username ?? value.userID ?? '-'}${value.role ? ` (${value.role})` : ''}` : '-',
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
          <h1>Returns &amp; Claims</h1>
          <button className={styles.addButton} onClick={() => router.push('/returns/create')}>
            + New Return
          </button>
        </div>
        <div className={styles.searchBar}>
          <select
            value={dealerFilter}
            onChange={(e) => setDealerFilter(e.target.value)}
            className={styles.searchInput}
            style={{ maxWidth: 220 }}
          >
            <option value="">All Dealers</option>
            {dealers.map((d) => (
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
            <option value="claim">Claim</option>
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
