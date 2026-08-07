import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import SearchableSelect from '../../../components/UI/SearchableSelect';
import { warehouseService } from '../../../services/warehouseService';
import { employeeService, Employee } from '../../../services/employeeService';
import { getApiErrorMessage } from '../../../utils/apiError';
import { employeeDisplayLabel } from '../../../utils/employeeDisplayLabel';
import { WAREHOUSE_ROLES } from '../../../utils/permissions';
import styles from '../../../styles/FormPage.module.scss';

function CreateWarehousePage() {
  const router = useRouter();
  const [managers, setManagers] = useState<Employee[]>([]);
  const [hasMain, setHasMain] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    city: '',
    address: '',
    managerId: '',
    isMain: false,
  });

  useEffect(() => {
    employeeService
      .getEmployees({ isActive: true })
      .then((list: Employee[]) =>
        setManagers(list.filter((e) => WAREHOUSE_ROLES.includes(e.role as never))),
      )
      .catch(() => {});

    warehouseService
      .getWarehouses()
      .then((list) => setHasMain(list.some((w) => w.isMain)))
      .catch(() => setHasMain(null));
  }, []);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!formData.name.trim()) {
      toast.error('Enter a warehouse name');
      return;
    }
    if (!formData.city.trim()) {
      toast.error('Enter a city — it is what routes a salesman’s orders to this warehouse');
      return;
    }

    setLoading(true);
    try {
      await warehouseService.createWarehouse({
        name: formData.name.trim(),
        city: formData.city.trim(),
        ...(formData.address.trim() ? { address: formData.address.trim() } : {}),
        ...(formData.managerId ? { managerId: formData.managerId } : {}),
        ...(formData.isMain ? { isMain: true } : {}),
      } as never);
      toast.success('Warehouse created');
      router.push('/warehouse/warehouses');
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to create the warehouse'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Add Warehouse</h1>
          <button className={styles.backButton} onClick={() => router.back()}>
            ← Back
          </button>
        </div>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.formGroup}>
            <label htmlFor="name">Name *</label>
            <input
              id="name"
              name="name"
              className={styles.input}
              value={formData.name}
              onChange={handleChange}
              placeholder="e.g. Lahore Warehouse"
            />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="city">City *</label>
              <input
                id="city"
                name="city"
                className={styles.input}
                value={formData.city}
                onChange={handleChange}
                placeholder="e.g. Lahore"
              />
              <span className={styles.hint}>
                Sales are drawn from the warehouse matching the salesman’s city, so this must match
                how the city is spelled on employee records. Capitalisation and spacing don’t matter.
              </span>
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="managerId">Manager</label>
              <SearchableSelect
                id="managerId"
                name="managerId"
                value={formData.managerId}
                onChange={handleChange}
                className={styles.select}
                placeholder="Select manager"
                isClearable
                options={[
                  { value: '', label: 'No manager' },
                  ...managers.map((m) => ({
                    value: m._id,
                    label: `${employeeDisplayLabel(m)} — ${m.role.replace(/_/g, ' ')}`,
                  })),
                ]}
              />
              <span className={styles.hint}>
                Only warehouse managers and warehouse staff appear here.
              </span>
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="address">Address</label>
            <textarea
              id="address"
              name="address"
              className={styles.textarea}
              rows={3}
              value={formData.address}
              onChange={handleChange}
            />
          </div>

          <div className={styles.checkboxGroup}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                checked={formData.isMain}
                onChange={(e) => setFormData((prev) => ({ ...prev, isMain: e.target.checked }))}
              />
              Make this the main warehouse
            </label>
            <span className={styles.hint}>
              {hasMain === false
                ? 'This is the first warehouse, so it becomes the main one automatically — all Stock In lands here.'
                : 'All Stock In lands in the main warehouse. Ticking this clears the flag on the current main warehouse.'}
            </span>
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/warehouse/warehouses')}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Creating…' : 'Create Warehouse'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}

export default function CreateWarehousePageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <CreateWarehousePage />
    </ProtectedRoute>
  );
}
