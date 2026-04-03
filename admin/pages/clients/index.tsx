import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import StatusBadge from '../../components/UI/StatusBadge';
import { clientService, Client } from '../../services/clientService';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'react-toastify';
import styles from '../../styles/ListPage.module.scss';

const ClientsPage: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    fetchClients();
  }, []);

  const fetchClients = async () => {
    try {
      const data = await clientService.getClients();
      setClients(data);
    } catch (error) {
      toast.error('Failed to fetch clients');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this client?')) {
      return;
    }

    try {
      await clientService.deleteClient(id);
      toast.success('Client deleted successfully');
      fetchClients();
    } catch (error) {
      toast.error('Failed to delete client');
    }
  };

  const filteredClients = clients.filter(
    (client) =>
      client.name.toLowerCase().includes(search.toLowerCase()) ||
      (client.shopName && client.shopName.toLowerCase().includes(search.toLowerCase())) ||
      client.phone.includes(search) ||
      (client.email && client.email.toLowerCase().includes(search.toLowerCase()))
  );

  const columns = [
    {
      key: 'name',
      title: 'Client Name',
    },
    {
      key: 'shopName',
      title: 'Shop Name',
      render: (value: string) => value || '-',
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
      render: (_: any, row: Client) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/clients/${row._id}`);
            }}
          >
            View
          </button>
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
          <h1>Clients</h1>
          <button
            className={styles.addButton}
            onClick={() => router.push('/clients/create')}
          >
            + Add Client
          </button>
        </div>

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
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
              data={filteredClients}
              loading={loading}
              onRowClick={(row) => router.push(`/clients/${row._id}`)}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function ClientsPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <ClientsPage />
    </ProtectedRoute>
  );
}
