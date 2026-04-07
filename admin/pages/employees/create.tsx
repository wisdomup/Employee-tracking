import React, { useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import { employeeService, Employee } from '../../services/employeeService';
import { PasswordInput } from '../../components/UI/PasswordInput';
import { ImageUpload } from '../../components/UI/ImageUpload';
import { toast } from 'react-toastify';
import styles from '../../styles/FormPage.module.scss';
import SearchableSelect from '../../components/UI/SearchableSelect';

const EMPLOYEE_ROLES = [
  // { value: 'admin', label: 'Admin' },
  // { value: 'employee', label: 'Employee' },
  { value: 'warehouse_manager', label: 'Warehouse Manager' },
  { value: 'order_taker', label: 'Order Taker' },
  { value: 'delivery_man', label: 'Delivery Man' },
];

const CreateEmployeePage: React.FC = () => {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    userID: '',
    username: '',
    phone: '',
    email: '',
    password: '',
    role: 'employee',
    profileImage: '',
    designation: '',
    perks: { salary: '' as number | '', bonus: '' as number | '', allowance: '' as number | '' },
    target: '',
    achivedTarget: '',
    address: {
      street: '',
      city: '',
      state: '',
      country: '',
    },
    isActive: true,
  });

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;
    
    if (name.startsWith('address.')) {
      const addressField = name.split('.')[1];
      setFormData((prev) => ({
        ...prev,
        address: {
          ...prev.address,
          [addressField]: value,
        },
      }));
    } else if (name.startsWith('perks.')) {
      const perkField = name.split('.')[1] as 'salary' | 'bonus' | 'allowance';
      const numValue = value === '' ? '' : Number(value);
      setFormData((prev) => ({
        ...prev,
        perks: {
          ...prev.perks,
          [perkField]: numValue,
        },
      }));
    } else {
      setFormData((prev) => ({
        ...prev,
        [name]: type === 'checkbox' ? checked : value,
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.userID?.trim()) {
      toast.error('Please enter Employee ID');
      return;
    }
    if (!formData.username?.trim()) {
      toast.error('Please enter Username');
      return;
    }
    if (!formData.phone?.trim()) {
      toast.error('Please enter Phone');
      return;
    }
    if (!formData.password) {
      toast.error('Please enter Password (min 6 characters)');
      return;
    }
    if (formData.password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    if (!formData.role) {
      toast.error('Please select a Role');
      return;
    }
    setLoading(true);

    try {
      const payload: Record<string, unknown> = {
        userID: formData.userID,
        username: formData.username,
        phone: formData.phone,
        password: formData.password,
        role: formData.role,
        isActive: formData.isActive,
        ...(formData.email         && { email: formData.email }),
        ...(formData.designation   && { designation: formData.designation }),
        ...(formData.profileImage  && { profileImage: formData.profileImage }),
        ...(formData.target        && { target: formData.target }),
        ...(formData.achivedTarget && { achivedTarget: formData.achivedTarget }),
      };

      const addressEntries = Object.entries(formData.address).filter(([, v]) => v);
      if (addressEntries.length > 0) {
        payload.address = Object.fromEntries(addressEntries);
      }

      if (formData.perks.salary !== '' || formData.perks.bonus !== '' || formData.perks.allowance !== '') {
        payload.perks = {
          ...(formData.perks.salary !== ''    && { salary: Number(formData.perks.salary) }),
          ...(formData.perks.bonus !== ''     && { bonus: Number(formData.perks.bonus) }),
          ...(formData.perks.allowance !== '' && { allowance: Number(formData.perks.allowance) }),
        };
      }

      await employeeService.createEmployee(payload as Partial<Employee> & { password: string });
      toast.success('Employee created successfully');
      router.push('/employees');
    } catch (error: any) {
      toast.error(
        error.response?.data?.message || 'Failed to create employee'
      );
    } finally {
      setLoading(false);
    }
  };

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Create Employee</h1>
          <button
            className={styles.backButton}
            onClick={() => router.push('/employees')}
          >
            ← Back
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="userID">Employee ID *</label>
            <input
              type="text"
              id="userID"
              name="userID"
              value={formData.userID}
              onChange={handleChange}
              required
              className={styles.input}
              placeholder="e.g. EMP001"
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="username">Username *</label>
            <input
              type="text"
              id="username"
              name="username"
              value={formData.username}
              onChange={handleChange}
              required
              className={styles.input}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="phone">Phone *</label>
            <input
              type="tel"
              id="phone"
              name="phone"
              value={formData.phone}
              onChange={handleChange}
              required
              className={styles.input}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="email">Email</label>
            <input
              type="email"
              id="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              className={styles.input}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="password">Password *</label>
            <PasswordInput
              id="password"
              name="password"
              value={formData.password}
              onChange={handleChange}
              required
              minLength={6}
              className={styles.input}
              placeholder="Enter password (min 6 characters)"
              autoComplete="new-password"
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="role">Role *</label>
            <SearchableSelect
              id="role"
              name="role"
              value={formData.role}
              onChange={handleChange}
              className={styles.select}
              placeholder="Role"
              options={EMPLOYEE_ROLES}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="designation">Designation</label>
            <input
              type="text"
              id="designation"
              name="designation"
              value={formData.designation}
              onChange={handleChange}
              className={styles.input}
            />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="perks.salary">Salary</label>
              <input
                type="number"
                id="perks.salary"
                name="perks.salary"
                value={formData.perks.salary === '' ? '' : formData.perks.salary}
                onChange={handleChange}
                min={0}
                step={1}
                className={styles.input}
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="perks.bonus">Bonus</label>
              <input
                type="number"
                id="perks.bonus"
                name="perks.bonus"
                value={formData.perks.bonus === '' ? '' : formData.perks.bonus}
                onChange={handleChange}
                min={0}
                step={1}
                className={styles.input}
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="perks.allowance">Allowance</label>
              <input
                type="number"
                id="perks.allowance"
                name="perks.allowance"
                value={formData.perks.allowance === '' ? '' : formData.perks.allowance}
                onChange={handleChange}
                min={0}
                step={1}
                className={styles.input}
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="target">Target</label>
            <input
              type="text"
              id="target"
              name="target"
              value={formData.target}
              onChange={handleChange}
              className={styles.input}
            />
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="achivedTarget">Target Achieved</label>
            <input
              type="text"
              id="achivedTarget"
              name="achivedTarget"
              value={formData.achivedTarget}
              onChange={handleChange}
              className={styles.input}
            />
          </div>

          <ImageUpload
            value={formData.profileImage}
            onChange={(url) => setFormData((prev) => ({ ...prev, profileImage: url }))}
            category="profiles"
            label="Profile image"
          />

          <div className={styles.formGroup}>
            <label htmlFor="address.street">Street</label>
            <input
              type="text"
              id="address.street"
              name="address.street"
              value={formData.address.street}
              onChange={handleChange}
              className={styles.input}
            />
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="address.city">City</label>
              <input
                type="text"
                id="address.city"
                name="address.city"
                value={formData.address.city}
                onChange={handleChange}
                className={styles.input}
              />
            </div>

            <div className={styles.formGroup}>
              <label htmlFor="address.state">State</label>
              <input
                type="text"
                id="address.state"
                name="address.state"
                value={formData.address.state}
                onChange={handleChange}
                className={styles.input}
              />
            </div>
          </div>

          <div className={styles.formGroup}>
            <label htmlFor="address.country">Country</label>
            <input
              type="text"
              id="address.country"
              name="address.country"
              value={formData.address.country}
              onChange={handleChange}
              className={styles.input}
            />
          </div>

          <div className={styles.formGroup}>
            <label className={styles.checkboxLabel}>
              <input
                type="checkbox"
                name="isActive"
                checked={formData.isActive}
                onChange={handleChange}
              />
              <span>Active</span>
            </label>
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push('/employees')}
            >
              Cancel
            </button>
            <button
              type="submit"
              className={styles.submitButton}
              disabled={loading}
            >
              {loading ? 'Creating...' : 'Create Employee'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function CreateEmployeePageWrapper() {
  return (
    <ProtectedRoute>
      <CreateEmployeePage />
    </ProtectedRoute>
  );
}
