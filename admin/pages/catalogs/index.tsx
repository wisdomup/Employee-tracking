import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import { catalogService, Catalog, getCatalogDownloadUrl } from '../../services/catalogService';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../styles/ListPage.module.scss';

const CatalogsPage: React.FC = () => {
  const [catalogs, setCatalogs] = useState<Catalog[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    fetchCatalogs();
  }, []);

  const fetchCatalogs = async () => {
    setLoading(true);
    try {
      const data = await catalogService.getCatalogs();
      setCatalogs(data);
    } catch {
      toast.error('Failed to fetch catalogs');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (catalogId: string) => {
    if (!window.confirm('Are you sure you want to delete this catalog?')) return;
    try {
      await catalogService.deleteCatalog(catalogId);
      toast.success('Catalog deleted');
      fetchCatalogs();
    } catch (error: unknown) {
      const err = error as { response?: { data?: { message?: string } } };
      toast.error(err.response?.data?.message || 'Failed to delete catalog');
    }
  };

  const filtered = catalogs.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );

  const createdByLabel = (value: Catalog['createdBy']) => {
    if (!value) return '-';
    const u = value.username ?? value.userID ?? '-';
    return value.role ? `${u} (${value.role})` : u;
  };

  const columns = [
    { key: 'name', title: 'Name' },
    {
      key: 'createdAt',
      title: 'Added',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '-'),
    },
    { key: 'createdBy', title: 'Created By', render: createdByLabel },
    {
      key: 'actions',
      title: 'Actions',
      render: (_: unknown, row: Catalog) => (
        <div className={styles.actions}>
          <button type="button" className={styles.editButton} onClick={(e) => { e.stopPropagation(); router.push('/catalogs/' + row._id); }}>View</button>
          <button type="button" className={styles.editButton} onClick={(e) => { e.stopPropagation(); window.open(getCatalogDownloadUrl(row.fileUrl), '_blank', 'noopener'); }}>Download</button>
          {isAdmin && <button type="button" className={styles.editButton} onClick={(e) => { e.stopPropagation(); router.push('/catalogs/' + row._id + '/edit'); }}>Edit</button>}
          {isAdmin && <button type="button" className={styles.deleteButton} onClick={(e) => { e.stopPropagation(); handleDelete(row._id); }}>Delete</button>}
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Catalogs</h1>
          {isAdmin && (
            <button className={styles.addButton} onClick={() => router.push('/catalogs/create')}>
              + Add Catalog
            </button>
          )}
        </div>

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar}>
              <input
                type="text"
                placeholder="Search catalogs..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={styles.searchInput}
              />
            </div>
            <Table
              columns={columns}
              data={filtered}
              loading={loading}
              onRowClick={(row) => router.push('/catalogs/' + row._id)}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function CatalogsPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <CatalogsPage />
    </ProtectedRoute>
  );
}
