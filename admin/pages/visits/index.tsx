import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import StatusBadge from '../../components/UI/StatusBadge';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import { visitService, Visit } from '../../services/visitService';
import { dealerService, Dealer } from '../../services/dealerService';
import { employeeService, Employee } from '../../services/employeeService';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../styles/ListPage.module.scss';

const VisitsPage: React.FC = () => {
  const [visits, setVisits] = useState<Visit[]>([]);
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [dealerFilter, setDealerFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const router = useRouter();

  useEffect(() => {
    dealerService.getDealers().then(setDealers).catch(() => {});
    employeeService.getEmployees().then(setEmployees).catch(() => {});
  }, []);

  useEffect(() => {
    fetchVisits();
  }, [dealerFilter, statusFilter, employeeFilter, startDate, endDate]);

  const fetchVisits = async () => {
    setLoading(true);
    try {
      const data = await visitService.getVisits({
        dealerId: dealerFilter || undefined,
        status: statusFilter || undefined,
        employeeId: employeeFilter || undefined,
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
      title: 'Dealer',
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
          <h1>Visits</h1>
          <button className={styles.addButton} onClick={() => router.push('/visits/create')}>
            + Schedule Visit
          </button>
        </div>
        <div className={styles.searchBar}>
          <select
            value={dealerFilter}
            onChange={(e) => setDealerFilter(e.target.value)}
            className={styles.searchInput}
            style={{ maxWidth: 220 }}
          >
            <option value="">All Dealers</option>
            {dealers.map((d) => (
              <option key={d._id} value={d._id}>
                {d.name}
              </option>
            ))}
          </select>
          <select
            value={employeeFilter}
            onChange={(e) => setEmployeeFilter(e.target.value)}
            className={styles.searchInput}
            style={{ maxWidth: 220 }}
          >
            <option value="">All Employees</option>
            {employees.map((e) => (
              <option key={e._id} value={e._id}>
                {e.username}
              </option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={styles.searchInput}
            style={{ maxWidth: 180 }}
          >
            <option value="">All Statuses</option>
            <option value="todo">To Do</option>
            <option value="in_progress">In Progress</option>
            <option value="completed">Completed</option>
            <option value="incomplete">Incomplete</option>
            <option value="cancelled">Cancelled</option>
          </select>
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
    </Layout>
  );
};

export default function VisitsPageWrapper() {
  return (
    <ProtectedRoute>
      <VisitsPage />
    </ProtectedRoute>
  );
}
