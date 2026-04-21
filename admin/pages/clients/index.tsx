import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import StatusBadge from '../../components/UI/StatusBadge';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { clientService, Client, RouteRef } from '../../services/clientService';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'react-toastify';
import styles from '../../styles/ListPage.module.scss';

const ClientsPage: React.FC = () => {
  const [clients, setClients] = useState<Client[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [cityFilter, setCityFilter] = useState('');
  const [routeFilter, setRouteFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
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
    if (!window.confirm('Are you sure you want to delete this client?')) return;
    try {
      await clientService.deleteClient(id);
      toast.success('Client deleted successfully');
      fetchClients();
    } catch (error) {
      toast.error('Failed to delete client');
    }
  };

  // Derive unique filter options from the loaded dataset
  const cityOptions = useMemo(() => {
    const cities = Array.from(
      new Set(clients.map((c) => c.address?.city).filter(Boolean) as string[]),
    ).sort();
    return cities.map((c) => ({ value: c, label: c }));
  }, [clients]);

  const routeOptions = useMemo(() => {
    const seen = new Set<string>();
    const routes: { value: string; label: string }[] = [];
    for (const c of clients) {
      if (c.route && typeof c.route === 'object') {
        const r = c.route as RouteRef;
        if (r._id && !seen.has(r._id)) {
          seen.add(r._id);
          routes.push({ value: r._id, label: r.name || r._id });
        }
      }
    }
    return routes.sort((a, b) => a.label.localeCompare(b.label));
  }, [clients]);

  const categoryOptions = useMemo(() => {
    const cats = Array.from(
      new Set(clients.map((c) => c.category).filter(Boolean) as string[]),
    ).sort();
    return cats.map((c) => ({ value: c, label: c }));
  }, [clients]);

  const statusOptions = [
    { value: 'active', label: 'Active' },
    { value: 'inactive', label: 'Inactive' },
  ];

  const filteredClients = useMemo(() => {
    return clients.filter((client) => {
      if (search) {
        const q = search.toLowerCase();
        const hit =
          client.name.toLowerCase().includes(q) ||
          (client.shopName && client.shopName.toLowerCase().includes(q)) ||
          client.phone.includes(q) ||
          (client.email && client.email.toLowerCase().includes(q));
        if (!hit) return false;
      }
      if (cityFilter && client.address?.city !== cityFilter) return false;
      if (routeFilter) {
        const routeId =
          client.route && typeof client.route === 'object'
            ? (client.route as RouteRef)._id
            : (client.route as string | undefined);
        if (routeId !== routeFilter) return false;
      }
      if (statusFilter && client.status !== statusFilter) return false;
      if (categoryFilter && client.category !== categoryFilter) return false;
      return true;
    });
  }, [clients, search, cityFilter, routeFilter, statusFilter, categoryFilter]);

  // Human-readable label for each active filter (used in export title + summary bar)
  const activeFilterLabels = useMemo(() => {
    const parts: string[] = [];
    if (cityFilter) parts.push(`City: ${cityFilter}`);
    if (routeFilter) {
      const r = routeOptions.find((o) => o.value === routeFilter);
      parts.push(`Route: ${r?.label ?? routeFilter}`);
    }
    if (statusFilter)
      parts.push(
        `Status: ${statusFilter.charAt(0).toUpperCase() + statusFilter.slice(1)}`,
      );
    if (categoryFilter) parts.push(`Category: ${categoryFilter}`);
    return parts;
  }, [cityFilter, routeFilter, statusFilter, categoryFilter, routeOptions]);

  const exportPdfTitle = activeFilterLabels.length
    ? `Clients — Filtered by: ${activeFilterLabels.join(' · ')}`
    : 'Clients';

  const exportFileName = activeFilterLabels.length
    ? `clients-${activeFilterLabels
        .map((l) => l.replace(/[^a-z0-9]+/gi, '-').toLowerCase())
        .join('_')}`
    : 'clients';

  const columns = [
    { key: 'name', title: 'Client Name' },
    {
      key: 'shopName',
      title: 'Shop Name',
      render: (value: string) => value || '-',
    },
    { key: 'phone', title: 'Phone' },
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
      exportValue: (row: Client) => row.address?.city || '',
    },
    {
      key: 'route',
      title: 'Route',
      render: (value: unknown) =>
        value && typeof value === 'object'
          ? (value as RouteRef).name || '-'
          : '-',
      exportValue: (row: Client) =>
        row.route && typeof row.route === 'object'
          ? (row.route as RouteRef).name || ''
          : '',
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
        value
          ? `${value.username ?? value.userID ?? '-'}${value.role ? ` (${value.role})` : ''}`
          : '-',
    },
    {
      key: 'actions',
      title: 'Actions',
      omitFromExport: true,
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
              <SearchableSelect
                name="cityFilter"
                options={cityOptions}
                value={cityFilter}
                onChange={(e) => setCityFilter(e.target.value)}
                placeholder="All Cities"
                isClearable
                className={styles.searchSelect}
              />
              <SearchableSelect
                name="routeFilter"
                options={routeOptions}
                value={routeFilter}
                onChange={(e) => setRouteFilter(e.target.value)}
                placeholder="All Routes"
                isClearable
                className={styles.searchSelect}
              />
              <SearchableSelect
                name="statusFilter"
                options={statusOptions}
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                placeholder="All Statuses"
                isClearable
                className={styles.searchSelect}
              />
              <SearchableSelect
                name="categoryFilter"
                options={categoryOptions}
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                placeholder="All Categories"
                isClearable
                className={styles.searchSelect}
              />
            </div>

            {activeFilterLabels.length > 0 && (
              <p className={styles.filterSummary}>
                Showing {filteredClients.length} of {clients.length} client
                {clients.length !== 1 ? 's' : ''} — filtered by:{' '}
                <strong>{activeFilterLabels.join(' · ')}</strong>
              </p>
            )}

            <Table
              columns={columns}
              data={filteredClients}
              loading={loading}
              onRowClick={(row) => router.push(`/clients/${row._id}`)}
              exportFileName={exportFileName}
              exportPdfTitle={exportPdfTitle}
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
