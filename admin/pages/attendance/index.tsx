import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import Table from '../../components/UI/Table';
import DatePickerFilter from '../../components/UI/DatePickerFilter';
import SearchableSelect from '../../components/UI/SearchableSelect';
import {
  attendanceService,
  Attendance,
  getEmployeeLabel,
} from '../../services/attendanceService';
import { employeeService, Employee } from '../../services/employeeService';
import { useAuth } from '../../contexts/AuthContext';
import { ALL_ROLES } from '../../utils/permissions';
import { toast } from 'react-toastify';
import { format, differenceInMinutes } from 'date-fns';
import styles from '../../styles/ListPage.module.scss';

function formatDuration(checkIn: string, checkOut?: string): string {
  if (!checkOut) return '-';
  const mins = differenceInMinutes(new Date(checkOut), new Date(checkIn));
  if (mins < 0) return '-';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m}m`;
  return `${h}h ${m}m`;
}

const AttendancePage: React.FC = () => {
  const [records, setRecords] = useState<Attendance[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [employeeFilter, setEmployeeFilter] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const router = useRouter();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (isAdmin) {
      employeeService.getEmployees().then(setEmployees).catch(() => {});
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!user) return;
    fetchRecords();
  }, [employeeFilter, startDate, endDate, user?.id]);

  const fetchRecords = async () => {
    setLoading(true);
    try {
      const data = await attendanceService.getAttendance({
        employeeId: isAdmin ? employeeFilter || undefined : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setRecords(data);
    } catch {
      toast.error('Failed to fetch attendance records');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm('Are you sure you want to delete this attendance record?')) return;
    try {
      await attendanceService.deleteRecord(id);
      toast.success('Attendance record deleted');
      fetchRecords();
    } catch {
      toast.error('Failed to delete attendance record');
    }
  };

  const employeeOptions = useMemo(
    () => [
      ...employees.map((e) => ({ value: e._id, label: `${e.username} (${e.userID})` })),
    ],
    [employees],
  );

  const activeFilterLabels = useMemo(() => {
    const parts: string[] = [];
    if (isAdmin && employeeFilter) {
      const emp = employees.find((e) => e._id === employeeFilter);
      parts.push(`Employee: ${emp ? emp.username : employeeFilter}`);
    }
    if (startDate) parts.push(`From: ${startDate}`);
    if (endDate) parts.push(`To: ${endDate}`);
    return parts;
  }, [isAdmin, employeeFilter, startDate, endDate, employees]);

  const exportPdfTitle = activeFilterLabels.length
    ? `Attendance — Filtered by: ${activeFilterLabels.join(' · ')}`
    : 'Attendance';

  const exportFileName = activeFilterLabels.length
    ? `attendance-${activeFilterLabels
        .map((l) => l.replace(/[^a-z0-9]+/gi, '-').toLowerCase())
        .join('_')}`
    : 'attendance';

  const columns = [
    {
      key: 'date',
      title: 'Date',
      render: (value: string) =>
        value ? format(new Date(value), 'MMM dd, yyyy') : '-',
      exportValue: (row: Attendance) =>
        row.date ? format(new Date(row.date), 'yyyy-MM-dd') : '',
    },
    ...(isAdmin
      ? [
          {
            key: 'employeeId',
            title: 'Employee',
            render: (value: unknown) => getEmployeeLabel(value as Attendance['employeeId']),
            exportValue: (row: Attendance) => getEmployeeLabel(row.employeeId),
          },
        ]
      : []),
    {
      key: 'checkInTime',
      title: 'Check In',
      render: (value: string) => (value ? format(new Date(value), 'hh:mm a') : '-'),
      exportValue: (row: Attendance) =>
        row.checkInTime ? format(new Date(row.checkInTime), 'hh:mm a') : '',
    },
    {
      key: 'checkOutTime',
      title: 'Check Out',
      render: (value: string) => (value ? format(new Date(value), 'hh:mm a') : '-'),
      exportValue: (row: Attendance) =>
        row.checkOutTime ? format(new Date(row.checkOutTime), 'hh:mm a') : '',
    },
    {
      key: 'checkInTime',
      title: 'Duration',
      omitFromExport: false,
      render: (_: unknown, row: Attendance) =>
        formatDuration(row.checkInTime, row.checkOutTime),
      exportValue: (row: Attendance) => formatDuration(row.checkInTime, row.checkOutTime),
    },
    {
      key: 'note',
      title: 'Note',
      render: (value: string) => value || '-',
    },
    {
      key: 'actions',
      title: 'Actions',
      omitFromExport: true,
      render: (_: unknown, row: Attendance) => (
        <div className={styles.actions}>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/attendance/${row._id}`);
            }}
          >
            View
          </button>
          <button
            className={styles.editButton}
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/attendance/${row._id}/edit`);
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
          <h1>Attendance</h1>
          {isAdmin && (
            <button
              className={styles.addButton}
              onClick={() => router.push('/attendance/create')}
            >
              + Add Record
            </button>
          )}
        </div>

        <div className={styles.listCard}>
          <div className={styles.listCardBody}>
            <div className={styles.searchBar}>
              {isAdmin && (
                <SearchableSelect
                  name="employeeFilter"
                  options={employeeOptions}
                  value={employeeFilter}
                  onChange={(e) => setEmployeeFilter(e.target.value)}
                  placeholder="All Employees"
                  isClearable
                  className={styles.searchSelect}
                />
              )}
              <DatePickerFilter
                value={startDate}
                onChange={setStartDate}
                placeholder="Start Date"
              />
              <DatePickerFilter
                value={endDate}
                onChange={setEndDate}
                placeholder="End Date"
              />
            </div>

            {activeFilterLabels.length > 0 && (
              <p className={styles.filterSummary}>
                Showing {records.length} record{records.length !== 1 ? 's' : ''} — filtered by:{' '}
                <strong>{activeFilterLabels.join(' · ')}</strong>
              </p>
            )}

            <Table
              columns={columns}
              data={records}
              loading={loading}
              onRowClick={(row) => router.push(`/attendance/${row._id}`)}
              exportFileName={exportFileName}
              exportPdfTitle={exportPdfTitle}
            />
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function AttendancePageWrapper() {
  return (
    <ProtectedRoute allowedRoles={ALL_ROLES}>
      <AttendancePage />
    </ProtectedRoute>
  );
}
