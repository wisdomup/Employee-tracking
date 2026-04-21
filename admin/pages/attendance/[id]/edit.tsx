import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import SearchableSelect from '../../../components/UI/SearchableSelect';
import {
  attendanceService,
  Attendance,
  getEmployeeLabel,
} from '../../../services/attendanceService';
import { employeeService, Employee } from '../../../services/employeeService';
import { useAuth } from '../../../contexts/AuthContext';
import { ALL_ROLES } from '../../../utils/permissions';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import styles from '../../../styles/FormPage.module.scss';

const EditAttendancePage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [record, setRecord] = useState<Attendance | null>(null);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Shared field
  const [note, setNote] = useState('');

  // Admin-only fields
  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState('');
  const [checkInTime, setCheckInTime] = useState('');
  const [checkInLat, setCheckInLat] = useState('');
  const [checkInLng, setCheckInLng] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');
  const [checkOutLat, setCheckOutLat] = useState('');
  const [checkOutLng, setCheckOutLng] = useState('');

  useEffect(() => {
    if (isAdmin) {
      employeeService.getEmployees().then(setEmployees).catch(() => {});
    }
  }, [isAdmin]);

  useEffect(() => {
    if (!id) return;
    fetchRecord();
  }, [id]);

  const fetchRecord = async () => {
    try {
      const data = await attendanceService.getRecord(id as string);
      setRecord(data);
      setNote(data.note || '');
      if (isAdmin) {
        const empId =
          data.employeeId && typeof data.employeeId === 'object'
            ? data.employeeId._id
            : String(data.employeeId || '');
        setEmployeeId(empId);
        setDate(data.date ? format(new Date(data.date), 'yyyy-MM-dd') : '');
        setCheckInTime(
          data.checkInTime
            ? format(new Date(data.checkInTime), "yyyy-MM-dd'T'HH:mm")
            : '',
        );
        setCheckInLat(data.checkInLatitude != null ? String(data.checkInLatitude) : '');
        setCheckInLng(data.checkInLongitude != null ? String(data.checkInLongitude) : '');
        setCheckOutTime(
          data.checkOutTime
            ? format(new Date(data.checkOutTime), "yyyy-MM-dd'T'HH:mm")
            : '',
        );
        setCheckOutLat(
          data.checkOutLatitude != null ? String(data.checkOutLatitude) : '',
        );
        setCheckOutLng(
          data.checkOutLongitude != null ? String(data.checkOutLongitude) : '',
        );
      }
    } catch {
      toast.error('Failed to fetch attendance record');
    } finally {
      setFetchLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    try {
      if (isAdmin) {
        await attendanceService.updateRecord(id as string, {
          employeeId: employeeId || undefined,
          date: date || undefined,
          checkInTime: checkInTime || undefined,
          checkInLatitude: checkInLat ? parseFloat(checkInLat) : undefined,
          checkInLongitude: checkInLng ? parseFloat(checkInLng) : undefined,
          checkOutTime: checkOutTime || undefined,
          checkOutLatitude: checkOutLat ? parseFloat(checkOutLat) : undefined,
          checkOutLongitude: checkOutLng ? parseFloat(checkOutLng) : undefined,
          note,
        } as any);
      } else {
        await attendanceService.updateRecord(id as string, { note });
      }
      toast.success('Attendance record updated');
      router.push(`/attendance/${id}`);
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to update attendance record');
    } finally {
      setSaving(false);
    }
  };

  if (fetchLoading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (!record) {
    return (
      <Layout>
        <div>Attendance record not found</div>
      </Layout>
    );
  }

  const employeeOptions = employees.map((e) => ({
    value: e._id,
    label: `${e.username} (${e.userID})`,
  }));

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Edit Attendance</h1>
          <button className={styles.backButton} onClick={() => router.push(`/attendance/${id}`)}>
            ← Back
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          {!isAdmin && (
            <p style={{ marginBottom: '1.5rem', color: '#6b7280', fontSize: '0.9rem' }}>
              Employee: <strong style={{ color: '#1f2937' }}>{getEmployeeLabel(record.employeeId)}</strong>
              {' · '}
              Date: <strong style={{ color: '#1f2937' }}>
                {record.date ? format(new Date(record.date), 'MMMM dd, yyyy') : '-'}
              </strong>
            </p>
          )}

          {isAdmin && (
            <>
              <div className={styles.formGroup}>
                <label htmlFor="employeeId">Employee</label>
                <SearchableSelect
                  id="employeeId"
                  name="employeeId"
                  options={employeeOptions}
                  value={employeeId}
                  onChange={(e) => setEmployeeId(e.target.value)}
                  placeholder="Select employee..."
                  className={styles.select}
                />
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label htmlFor="date">Date</label>
                  <input
                    id="date"
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label htmlFor="checkInTime">Check-in Time</label>
                  <input
                    id="checkInTime"
                    type="datetime-local"
                    value={checkInTime}
                    onChange={(e) => setCheckInTime(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label htmlFor="checkInLat">Check-in Latitude</label>
                  <input
                    id="checkInLat"
                    type="number"
                    step="any"
                    value={checkInLat}
                    onChange={(e) => setCheckInLat(e.target.value)}
                    className={styles.input}
                    placeholder="e.g. 24.8607"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label htmlFor="checkInLng">Check-in Longitude</label>
                  <input
                    id="checkInLng"
                    type="number"
                    step="any"
                    value={checkInLng}
                    onChange={(e) => setCheckInLng(e.target.value)}
                    className={styles.input}
                    placeholder="e.g. 67.0011"
                  />
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label htmlFor="checkOutTime">Check-out Time (optional)</label>
                  <input
                    id="checkOutTime"
                    type="datetime-local"
                    value={checkOutTime}
                    onChange={(e) => setCheckOutTime(e.target.value)}
                    className={styles.input}
                  />
                </div>
              </div>

              <div className={styles.formRow}>
                <div className={styles.formGroup}>
                  <label htmlFor="checkOutLat">Check-out Latitude (optional)</label>
                  <input
                    id="checkOutLat"
                    type="number"
                    step="any"
                    value={checkOutLat}
                    onChange={(e) => setCheckOutLat(e.target.value)}
                    className={styles.input}
                    placeholder="e.g. 24.8607"
                  />
                </div>
                <div className={styles.formGroup}>
                  <label htmlFor="checkOutLng">Check-out Longitude (optional)</label>
                  <input
                    id="checkOutLng"
                    type="number"
                    step="any"
                    value={checkOutLng}
                    onChange={(e) => setCheckOutLng(e.target.value)}
                    className={styles.input}
                    placeholder="e.g. 67.0011"
                  />
                </div>
              </div>
            </>
          )}

          <div className={styles.formGroup}>
            <label htmlFor="note">Note</label>
            <textarea
              id="note"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              className={styles.textarea}
              placeholder="Add a note..."
            />
          </div>

          <div className={styles.formActions}>
            <button
              type="button"
              className={styles.cancelButton}
              onClick={() => router.push(`/attendance/${id}`)}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={saving}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function EditAttendancePageWrapper() {
  return (
    <ProtectedRoute allowedRoles={ALL_ROLES}>
      <EditAttendancePage />
    </ProtectedRoute>
  );
}
