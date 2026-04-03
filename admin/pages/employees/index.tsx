import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import StatusBadge from '../../components/UI/StatusBadge';
import { useAuth } from '../../contexts/AuthContext';
import { employeeService, Employee } from '../../services/employeeService';
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
        emp.phone.includes(search) ||
        (emp.email && emp.email.toLowerCase().includes(search.toLowerCase()))
    );

  const columns = [
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
    },
    {
      key: 'target',
      title: 'Target',
      render: (value: string) => value || '-',
    },
    {
      key: 'achivedTarget',
      title: 'Target Achieved',
      render: (value: string) => value || '-',
    },
    {
      key: 'address',
      title: 'City',
      render: (value: unknown) => (value as { city?: string })?.city || '-',
    },
    {
      key: 'isActive',
      title: 'Status',
      render: (value: boolean) => (
        <StatusBadge status={value ? 'active' : 'inactive'} />
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
          <button
            className={styles.addButton}
            onClick={() => router.push('/employees/create')}
          >
            + Add Employee
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
              data={filteredEmployees}
              loading={loading}
              onRowClick={(row) => router.push(`/employees/${row._id}`)}
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
