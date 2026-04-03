import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import { categoryService, Category } from '../../services/categoryService';
import { toast } from 'react-toastify';
import styles from '../../styles/ListPage.module.scss';

const CategoriesPage: React.FC = () => {
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetchCategories();
  }, []);

  const fetchCategories = async () => {
    setLoading(true);
    try {
      const data = await categoryService.getCategories();
      setCategories(data);
    } catch (error) {
      toast.error('Failed to fetch categories');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this category?')) return;
    try {
      await categoryService.deleteCategory(id);
      toast.success('Category deleted successfully');
      fetchCategories();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to delete category');
    }
  };

  const filtered = categories.filter((c) =>
    c.name.toLowerCase().includes(search.toLowerCase()),
  );

  const columns = [
    {
      key: 'image',
      title: 'Image',
      render: (value: string) =>
        value ? (
          <img
            src={`${process.env.NEXT_PUBLIC_API_URL}${value}`}
            alt="category"
            style={{ width: 48, height: 48, objectFit: 'cover', borderRadius: '0.375rem' }}
          />
        ) : (
          <div
            style={{
              width: 48,
              height: 48,
              background: '#f3f4f6',
              borderRadius: '0.375rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#9ca3af',
              fontSize: '1.25rem',
            }}
          >
            🏷️
          </div>
        ),
    },
    { key: 'name', title: 'Name' },
    {
      key: 'description',
      title: 'Description',
      render: (value: string) => value || '-',
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
      render: (_: any, row: Category) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/categories/${row._id}/edit`);
            }}
          >
            Edit
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
          <h1>Categories</h1>
          <button className={styles.addButton} onClick={() => router.push('/categories/create')}>
            + Add Category
          </button>
        </div>

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar}>
              <input
                type="text"
                placeholder="Search categories..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={styles.searchInput}
              />
            </div>
            <Table columns={columns} data={filtered} loading={loading} />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function CategoriesPageWrapper() {
  return (
    <ProtectedRoute>
      <CategoriesPage />
    </ProtectedRoute>
  );
}
