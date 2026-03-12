import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import StatusBadge from '../../components/UI/StatusBadge';
import { dealerService, Dealer } from '../../services/dealerService';
import { toast } from 'react-toastify';
import styles from '../../styles/ListPage.module.scss';

const DealersPage: React.FC = () => {
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetchDealers();
  }, []);

  const fetchDealers = async () => {
    try {
      const data = await dealerService.getDealers();
      setDealers(data);
    } catch (error) {
      toast.error('Failed to fetch dealers');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this dealer?')) {
      return;
    }

    try {
      await dealerService.deleteDealer(id);
      toast.success('Dealer deleted successfully');
      fetchDealers();
    } catch (error) {
      toast.error('Failed to delete dealer');
    }
  };

  const filteredDealers = dealers.filter(
    (dealer) =>
      dealer.name.toLowerCase().includes(search.toLowerCase()) ||
      dealer.phone.includes(search) ||
      (dealer.email && dealer.email.toLowerCase().includes(search.toLowerCase()))
  );

  const columns = [
    {
      key: 'name',
      title: 'Name',
    },
    {
      key: 'phone',
      title: 'Phone',
    },
    {
      key: 'email',
      title: 'Email',
      render: (value: string) => value || '-',
    },
    {
      key: 'category',
      title: 'Category',
      render: (value: string) => value || '-',
    },
    {
      key: 'rating',
      title: 'Rating',
      render: (value: number) => (value != null ? String(value) : '-'),
    },
    {
      key: 'address',
      title: 'City',
      render: (value: unknown) => (value as { city?: string })?.city || '-',
    },
    {
      key: 'status',
      title: 'Status',
      render: (value: string) => (
        <StatusBadge status={value as 'active' | 'inactive'} />
      ),
    },
    {
      key: 'createdBy',
      title: 'Created By',
      render: (value: any) =>
        value ? `${value.username ?? value.userID ?? '-'}${value.role ? ` (${value.role})` : ''}` : '-',
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (_: any, row: Dealer) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/dealers/${row._id}`);
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
          <h1>Dealers</h1>
          <button
            className={styles.addButton}
            onClick={() => router.push('/dealers/create')}
          >
            + Add Dealer
          </button>
        </div>

        <div className={styles.searchBar}>
          <input
            type="text"
            placeholder="Search by name, phone, or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className={styles.searchInput}
          />
        </div>

        <Table
          columns={columns}
          data={filteredDealers}
          loading={loading}
          onRowClick={(row) => router.push(`/dealers/${row._id}`)}
        />
      </div>
    </Layout>
  );
};

export default function DealersPageWrapper() {
  return (
    <ProtectedRoute>
      <DealersPage />
    </ProtectedRoute>
  );
}
