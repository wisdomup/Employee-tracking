import React, { useEffect, useMemo, useState } from 'react';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import { trashService, TrashItem, TrashModule } from '../../services/trashService';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../styles/ListPage.module.scss';

const TrashPage: React.FC = () => {
  const [items, setItems] = useState<TrashItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [moduleFilter, setModuleFilter] = useState<'all' | TrashModule>('all');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [bulkDeleting, setBulkDeleting] = useState(false);

  const fetchTrash = async () => {
    setLoading(true);
    try {
      const data = await trashService.getTrashItems({
        module: moduleFilter,
        search: search || undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setItems(data);
      setSelected({});
    } catch (error) {
      toast.error('Failed to fetch trash items');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchTrash();
  }, [moduleFilter, startDate, endDate]);

  const selectedKeys = useMemo(() => Object.keys(selected).filter((k) => selected[k]), [selected]);

  const handleRestore = async (item: TrashItem) => {
    try {
      await trashService.restore(item.module, item.entityId);
      toast.success('Restored successfully');
      fetchTrash();
    } catch {
      toast.error('Failed to restore item');
    }
  };

  const handlePermanentDelete = async (item: TrashItem) => {
    if (!window.confirm('Permanently delete this item? This cannot be undone.')) return;
    try {
      await trashService.permanentDelete(item.module, item.entityId);
      toast.success('Permanently deleted');
      fetchTrash();
    } catch {
      toast.error('Failed to permanently delete item');
    }
  };

  const handleBulkPermanentDelete = async () => {
    if (selectedKeys.length === 0) return;
    if (!window.confirm(`Permanently delete ${selectedKeys.length} selected items? This cannot be undone.`)) return;
    setBulkDeleting(true);
    try {
      const selectedItems = items.filter((item) => selected[`${item.module}:${item.entityId}`]);
      await trashService.bulkPermanentDelete(
        selectedItems.map((item) => ({ module: item.module, entityId: item.entityId })),
      );
      toast.success('Selected items permanently deleted');
      fetchTrash();
    } catch {
      toast.error('Failed to delete selected items');
    } finally {
      setBulkDeleting(false);
    }
  };

  const filteredItems = items.filter((item) =>
    search ? item.label.toLowerCase().includes(search.toLowerCase()) : true,
  );

  const columns = [
    {
      key: 'select',
      title: '',
      render: (_: any, row: TrashItem) => {
        const key = `${row.module}:${row.entityId}`;
        return (
          <input
            type="checkbox"
            checked={!!selected[key]}
            onChange={(e) => {
              e.stopPropagation();
              setSelected((prev) => ({ ...prev, [key]: e.target.checked }));
            }}
          />
        );
      },
    },
    {
      key: 'module',
      title: 'Module',
      render: (value: string) => value.charAt(0).toUpperCase() + value.slice(1),
    },
    {
      key: 'label',
      title: 'Entity',
      render: (value: string) => value,
    },
    {
      key: 'trashedBy',
      title: 'Trashed By',
      render: (value: any) => value?.username || value?.userID || '-',
    },
    {
      key: 'trashedAt',
      title: 'Trashed At',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy hh:mm a') : '-'),
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (_: any, row: TrashItem) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              handleRestore(row);
            }}
          >
            Restore
          </button>
          <button
            className={styles.deleteButton}
            onClick={(e) => {
              e.stopPropagation();
              handlePermanentDelete(row);
            }}
          >
            Delete Permanently
          </button>
        </div>
      ),
    },
  ];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Trash</h1>
          <button
            className={styles.deleteButton}
            disabled={selectedKeys.length === 0 || bulkDeleting}
            onClick={handleBulkPermanentDelete}
          >
            {bulkDeleting ? 'Deleting...' : `Delete Selected (${selectedKeys.length})`}
          </button>
        </div>

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar}>
              <select
                className={styles.searchInput}
                style={{ maxWidth: 220 }}
                value={moduleFilter}
                onChange={(e) => setModuleFilter(e.target.value as 'all' | TrashModule)}
              >
                <option value="all">All Modules</option>
                <option value="employee">Employees</option>
                <option value="client">Clients</option>
                <option value="product">Products</option>
                <option value="category">Categories</option>
                <option value="route">Routes</option>
                <option value="order">Orders</option>
                <option value="return">Returns</option>
                <option value="visit">Visits</option>
              </select>

              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search by label..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />

              <DatePickerFilter
                value={startDate}
                onChange={setStartDate}
                placeholder="Start date"
                title="Start date"
              />
              <DatePickerFilter
                value={endDate}
                onChange={setEndDate}
                placeholder="End date"
                title="End date"
              />
              <button className={styles.editButton} onClick={fetchTrash}>
                Apply
              </button>
            </div>

            <Table columns={columns} data={filteredItems} loading={loading} />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function TrashPageWrapper() {
  return (
    <ProtectedRoute>
      <TrashPage />
    </ProtectedRoute>
  );
}
