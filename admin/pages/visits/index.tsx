import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import StatusBadge from '../../components/UI/StatusBadge';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { visitService, Visit } from '../../services/visitService';
import { clientService, Client } from '../../services/clientService';
import { employeeService, Employee } from '../../services/employeeService';
import { useAuth } from '../../contexts/AuthContext';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../styles/ListPage.module.scss';

const VisitsPage: React.FC = () => {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [clientFilter, setClientFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOrderTaker = user?.role === 'order_taker';

  useEffect(() => {
    clientService.getClients().then(setClients).catch(() => {});
    if (isAdmin) {
      employeeService.getEmployees().then(setEmployees).catch(() => {});
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!user) return;
    fetchVisits();
  }, [clientFilter, statusFilter, employeeFilter, startDate, endDate, user?.id, isOrderTaker]);

  const fetchVisits = async () => {
    setLoading(true);
    try {
      const effectiveEmployeeId = isOrderTaker && user?.id ? user.id : (employeeFilter || undefined);
      const data = await visitService.getVisits({
        clientId: clientFilter || undefined,
        status: statusFilter || undefined,
        employeeId: effectiveEmployeeId,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setVisits(data);
    } catch (error) {
      toast.error('Failed to fetch visits');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this visit?')) return;
    try {
      await visitService.deleteVisit(id);
      toast.success('Visit deleted');
      fetchVisits();
    } catch (error: any) {
      toast.error(error.response?.data?.message || 'Failed to delete visit');
    }
  };

  const columns = [
    {
      key: 'dealerId',
      title: 'Client',
      render: (value: any) => value?.name || '-',
    },
    {
      key: 'employeeId',
      title: 'Employee',
      render: (value: any) => value?.username || '-',
    },
    {
      key: 'routeId',
      title: 'Route',
      render: (value: any) => value?.name || '-',
    },
    {
      key: 'visitDate',
      title: 'Visit Date',
      render: (value: string) => (value ? format(new Date(value), 'MMM dd, yyyy') : '-'),
    },
    {
      key: 'status',
      title: 'Status',
      render: (value: string) => <StatusBadge status={value} />,
    },
    {
      key: 'createdBy',
      title: 'Created By',
      render: (value: any) =>
        value ? `${value.username ?? value.userID ?? '-'}${value.role ? ` (${value.role})` : ''}` : '-',
    },
    {
      key: '_id',
      title: 'Actions',
      render: (_: string, row: Visit) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/visits/${row._id}`);
            }}
          >
            View
          </button>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/visits/${row._id}/edit`);
            }}
          >
            Edit
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
          <h1>Visits</h1>
          {isAdmin && (
            <button className={styles.addButton} onClick={() => router.push('/visits/create')}>
              + Schedule Visit
            </button>
          )}
        </div>

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar}>
              <SearchableSelect
                name="clientFilter"
                value={clientFilter}
                onChange={(e) => setClientFilter(e.target.value)}
                className={styles.searchSelect}
                style={{ maxWidth: 220 }}
                placeholder="All Clients"
                options={[
                  { value: '', label: 'All Clients' },
                  ...clients.map((d) => ({ value: d._id, label: d.name })),
                ]}
              />
              {!isOrderTaker && (
                <SearchableSelect
                  name="employeeFilter"
                  value={employeeFilter}
                  onChange={(e) => setEmployeeFilter(e.target.value)}
                  className={styles.searchSelect}
                  style={{ maxWidth: 220 }}
                  placeholder="All Employees"
                  options={[
                    { value: '', label: 'All Employees' },
                    ...employees.map((e) => ({ value: e._id, label: e.username })),
                  ]}
                />
              )}
              <SearchableSelect
                name="statusFilter"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className={styles.searchSelect}
                style={{ maxWidth: 180 }}
                placeholder="All Statuses"
                options={[
                  { value: '', label: 'All Statuses' },
                  { value: 'todo', label: 'To Do' },
                  { value: 'in_progress', label: 'In Progress' },
                  { value: 'completed', label: 'Completed' },
                  { value: 'incomplete', label: 'Incomplete' },
                  { value: 'cancelled', label: 'Cancelled' },
                ]}
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
            </div>
            <Table
              columns={columns}
              data={visits}
              loading={loading}
              onRowClick={(row) => router.push(`/visits/${row._id}`)}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function VisitsPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin', 'order_taker']}>
      <VisitsPage />
    </ProtectedRoute>
  );
}
