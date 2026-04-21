import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { productService, Product } from '../../services/productService';
import { categoryService, Category } from '../../services/categoryService';
import { useAuth } from '../../contexts/AuthContext';
import { can } from '../../utils/permissions';
import { toast } from 'react-toastify';
import styles from '../../styles/ListPage.module.scss';

const ProductsPage: React.FC = () => {
  const [products, setProducts] = useState<Product[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('');
  const router = useRouter();
  const { user } = useAuth();
  const canManage = can(user?.role, 'products:view') && user?.role === 'admin';

  useEffect(() => {
    fetchCategories();
  }, []);

  useEffect(() => {
    fetchProducts();
  }, [categoryFilter]);

  const fetchProducts = async () => {
    setLoading(true);
    try {
      const data = await productService.getProducts({
        categoryId: categoryFilter || undefined,
      });
      setProducts(data);
    } catch (error) {
      toast.error('Failed to fetch products');
    } finally {
      setLoading(false);
    }
  };

  const fetchCategories = async () => {
    try {
      const data = await categoryService.getCategories();
      setCategories(data);
    } catch (error) {
      // non-critical
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this product?')) return;
    try {
      await productService.deleteProduct(id);
      toast.success('Product deleted successfully');
      fetchProducts();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to delete product');
    }
  };

  const filtered = products.filter(
    (p) =>
      p.name.toLowerCase().includes(search.toLowerCase()) ||
      p.barcode.toLowerCase().includes(search.toLowerCase()),
  );

  const activeFilterLabels = useMemo(() => {
    const parts: string[] = [];
    if (categoryFilter) {
      const cat = categories.find((c) => c._id === categoryFilter);
      parts.push(`Category: ${cat ? cat.name : categoryFilter}`);
    }
    if (search) parts.push(`Search: "${search}"`);
    return parts;
  }, [categoryFilter, search, categories]);

  const exportPdfTitle = activeFilterLabels.length
    ? `Products — Filtered by: ${activeFilterLabels.join(' · ')}`
    : 'Products';

  const exportFileName = activeFilterLabels.length
    ? `products-${activeFilterLabels.map((l) => l.replace(/[^a-z0-9]+/gi, '-').toLowerCase()).join('_')}`
    : 'products';

  const columns = [
    {
      key: 'image',
      title: 'Image',
      render: (value: string) =>
        value ? (
          <img
            src={`${process.env.NEXT_PUBLIC_API_URL}${value}`}
            alt="product"
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
            📦
          </div>
        ),
    },
    { key: 'barcode', title: 'Barcode' },
    { key: 'name', title: 'Name' },
    {
      key: 'categoryId',
      title: 'Category',
      render: (value: any) => value?.name || '-',
    },
    {
      key: 'salePrice',
      title: 'Sale Price',
      render: (value: number) => (value !== undefined ? `Rs. ${value.toFixed(2)}` : '-'),
    },
    {
      key: 'onlinePrice',
      title: 'Online',
      render: (value: number) => (value !== undefined ? `Rs. ${value.toFixed(2)}` : '-'),
    },
    {
      key: 'quantity',
      title: 'Qty',
      render: (value: number) => (value !== undefined ? value : '-'),
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
      render: (_: any, row: Product) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/products/${row._id}`);
            }}
          >
            View
          </button>
          {canManage && (
            <button
              className={styles.editButton}
              onClick={(e) => {
                e.stopPropagation();
                router.push(`/products/${row._id}/edit`);
              }}
            >
              Edit
            </button>
          )}
          {canManage && (
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
          <h1>Products</h1>
          {canManage && (
            <button className={styles.addButton} onClick={() => router.push('/products/create')}>
              + Add Product
            </button>
          )}
        </div>

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar}>
              <input
                type="text"
                placeholder="Search by name or barcode..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className={styles.searchInput}
              />
              <SearchableSelect
                name="categoryFilter"
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className={styles.searchSelect}
                style={{ maxWidth: 200 }}
                placeholder="All Categories"
                options={[
                  { value: '', label: 'All Categories' },
                  ...categories.map((c) => ({ value: c._id, label: c.name })),
                ]}
              />
            </div>
            {activeFilterLabels.length > 0 && (
              <p className={styles.filterSummary}>
                Showing {filtered.length} of {products.length} product{products.length !== 1 ? 's' : ''} — filtered by:{' '}
                {activeFilterLabels.join(' · ')}
              </p>
            )}
            <Table
              columns={columns}
              data={filtered}
              loading={loading}
              onRowClick={(row) => router.push(`/products/${row._id}`)}
              exportFileName={exportFileName}
              exportPdfTitle={exportPdfTitle}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function ProductsPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <ProductsPage />
    </ProtectedRoute>
  );
}
