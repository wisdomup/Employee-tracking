import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { toast } from 'react-toastify';
import Layout from '../../../../components/Layout/Layout';
import ProtectedRoute from '../../../../components/Auth/ProtectedRoute';
import Loader from '../../../../components/UI/Loader';
import SearchableSelect from '../../../../components/UI/SearchableSelect';
import { warehouseService, Warehouse } from '../../../../services/warehouseService';
import { employeeService, Employee } from '../../../../services/employeeService';
import { getApiErrorMessage } from '../../../../utils/apiError';
import { employeeDisplayLabel } from '../../../../utils/employeeDisplayLabel';
import { WAREHOUSE_ROLES } from '../../../../utils/permissions';
import styles from '../../../../styles/FormPage.module.scss';

function EditWarehousePage() {
  const router = useRouter();
  const { id } = router.query;
  const [managers, setManagers] = useState<Employee[]>([]);
  const [warehouse, setWarehouse] = useState<Warehouse | null>(null);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [loading, setLoading] = useState(false);

  const [formData, setFormData] = useState({
    name: '',
    city: '',
    address: '',
    managerId: '',
    isActive: true,
  });

  useEffect(() => {
    employeeService
      .getEmployees({ isActive: true })
      .then((list: Employee[]) =>
        setManagers(list.filter((e) => WAREHOUSE_ROLES.includes(e.role as never))),
      )
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!id || typeof id !== 'string') return;
    warehouseService
      .getWarehouse(id)
      .then((data) => {
        setWarehouse(data);
        setFormData({
          name: data.name ?? '',
          city: data.city ?? '',
          address: data.address ?? '',
          // Populated refs come back as objects; the form needs the id.
          managerId: data.managerId
            ? typeof data.managerId === 'object'
              ? String(data.managerId._id)
              : String(data.managerId)
            : '',
          isActive: data.isActive !== false,
        });
      })
      .catch((err) => toast.error(getApiErrorMessage(err, 'Failed to load the warehouse')))
      .finally(() => setFetchLoading(false));
  }, [id]);

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>,
  ) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || typeof id !== 'string') return;

    if (!formData.name.trim()) {
      toast.error('Enter a warehouse name');
      return;
    }
    if (!formData.city.trim()) {
      toast.error('Enter a city');
      return;
    }

    setLoading(true);
    try {
      await warehouseService.updateWarehouse(id, {
        name: formData.name.trim(),
        city: formData.city.trim(),
        address: formData.address.trim(),
        // '' clears the assignment — the API treats empty as "no manager".
        managerId: formData.managerId,
        isActive: formData.isActive,
      } as never);
      toast.success('Warehouse updated');
      router.push(`/warehouse/warehouses/${id}`);
    } catch (err) {
      toast.error(getApiErrorMessage(err, 'Failed to update the warehouse'));
    } finally {
      setLoading(false);
    }
  };

  if (fetchLoading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Edit Warehouse</h1>
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
              />
              <span className={styles.hint}>
                Changing the city changes which salesmen’s orders draw stock from here.
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
                checked={formData.isActive}
                disabled={warehouse?.isMain}
                onChange={(e) => setFormData((prev) => ({ ...prev, isActive: e.target.checked }))}
              />
              Active
            </label>
            <span className={styles.hint}>
              {warehouse?.isMain
                ? 'The main warehouse cannot be deactivated — make another warehouse Main first.'
                : 'An inactive warehouse cannot receive stock or be picked as a transfer destination.'}
            </span>
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push(`/warehouse/warehouses/${id}`)}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={loading}>
              {loading ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
}

export default function EditWarehousePageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <EditWarehousePage />
    </ProtectedRoute>
  );
}
