import React, { useEffect, useMemo, useState } from 'react';
import { can } from '../../utils/permissions';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import StatusBadge from '../../components/UI/StatusBadge';
import { useAuth } from '../../contexts/AuthContext';
import { employeeService, Employee } from '../../services/employeeService';
import { employeeDisplayLabel } from '../../utils/employeeDisplayLabel';
import { toast } from 'react-toastify';
import styles from '../../styles/ListPage.module.scss';

const EmployeesPage: React.FC = () => {
  const { user: currentUser } = useAuth();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const router = useRouter();

  useEffect(() => {
    fetchEmployees();
  }, []);

  const fetchEmployees = async () => {
    try {
      const data = await employeeService.getEmployees();
      setEmployees(data);
    } catch (error) {
      toast.error('Failed to fetch employees');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this employee?')) {
      return;
    }

    try {
      await employeeService.deleteEmployee(id);
      toast.success('Employee deleted successfully');
      fetchEmployees();
    } catch (error) {
      toast.error('Failed to delete employee');
    }
  };

  const currentUserId = (currentUser as { id?: string; _id?: string } | null)?.id ?? (currentUser as { id?: string; _id?: string } | null)?._id;
  const filteredEmployees = employees
    .filter((emp) => !currentUserId || emp._id !== currentUserId)
    .filter(
      (emp) =>
        emp.username.toLowerCase().includes(search.toLowerCase()) ||
        (emp.fullName && emp.fullName.toLowerCase().includes(search.toLowerCase())) ||
        emp.phone.includes(search) ||
        (emp.email && emp.email.toLowerCase().includes(search.toLowerCase()))
    );

  const activeFilterLabels = useMemo(() => {
    const parts: string[] = [];
    if (search) parts.push(`Search: "${search}"`);
    return parts;
  }, [search]);

  const exportPdfTitle = activeFilterLabels.length
    ? `Employees — Filtered by: ${activeFilterLabels.join(' · ')}`
    : 'Employees';

  const exportFileName = activeFilterLabels.length
    ? `employees-${activeFilterLabels.map((l) => l.replace(/[^a-z0-9]+/gi, '-').toLowerCase()).join('_')}`
    : 'employees';

  const columns = [
    {
      key: 'fullName',
      title: 'Name',
      render: (_: unknown, row: Employee) => employeeDisplayLabel(row) || '-',
    },
    {
      key: 'username',
      title: 'Username',
    },
    {
      key: 'role',
      title: 'Role',
      render: (value: string) => value || '-',
    },
    {
      key: 'designation',
      title: 'Designation',
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
      key: 'perks',
      title: 'Salary',
      render: (_: unknown, row: Employee) =>
        row.perks?.salary != null ? String(row.perks.salary) : '-',
      total: 'sum' as const,
      totalValue: (row: Employee) => Number(row.perks?.salary ?? 0),
    },
    {
      key: 'target',
      title: 'Target',
      render: (value: string) => value || '-',
      // Stored as free text, so anything non-numeric contributes nothing rather than breaking.
      total: 'sum' as const,
      totalValue: (row: Employee) => Number(row.target) || 0,
    },
    {
      key: 'achivedTarget',
      title: 'Target Achieved',
      render: (value: string) => value || '-',
      total: 'sum' as const,
      totalValue: (row: Employee) => Number(row.achivedTarget) || 0,
    },
    {
      key: 'address',
      title: 'City',
      render: (value: unknown) => (value as { city?: string })?.city || '-',
    },
    {
      key: 'isActive',
      title: 'Status',
      // A frozen rider is still "active" — the freeze is a separate, temporary lock, and
      // showing only Active here would hide the reason they cannot record any work.
      render: (value: boolean, row: Employee) => (
        <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap' }}>
          <StatusBadge status={value ? 'active' : 'inactive'} />
          {row.isFrozen && (
            <span
              title={row.frozenReason || 'Frozen for a late start'}
              style={{
                display: 'inline-block',
                padding: '0.125rem 0.5rem',
                borderRadius: '9999px',
                fontSize: '0.75rem',
                fontWeight: 600,
                whiteSpace: 'nowrap',
                background: '#dbeafe',
                color: '#1d4ed8',
              }}
            >
              Frozen
            </span>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      title: 'Actions',
      render: (_: any, row: Employee) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/employees/${row._id}`);
            }}
          >
            View
          </button>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/employees/${row._id}/edit`);
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
          <h1>Employees</h1>
          {can(undefined, 'employees:add') && (
          <button
            className={styles.addButton}
            onClick={() => router.push('/employees/create')}
          >
            + Add Employee
          </button>
          )}
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

            {activeFilterLabels.length > 0 && (
              <p className={styles.filterSummary}>
                Showing {filteredEmployees.length} of {employees.length} employee{employees.length !== 1 ? 's' : ''} — filtered by:{' '}
                {activeFilterLabels.join(' · ')}
              </p>
            )}
            <Table
              columns={columns}
              data={filteredEmployees}
              loading={loading}
              onRowClick={(row) => router.push(`/employees/${row._id}`)}
              exportFileName={exportFileName}
              exportPdfTitle={exportPdfTitle}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function EmployeesPageWrapper() {
  return (
    <ProtectedRoute>
      <EmployeesPage />
    </ProtectedRoute>
  );
}
