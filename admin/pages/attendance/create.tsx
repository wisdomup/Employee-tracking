import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import Layout from '../../components/Layout/Layout';
import ProtectedRoute from '../../components/Auth/ProtectedRoute';
import SearchableSelect from '../../components/UI/SearchableSelect';
import { attendanceService } from '../../services/attendanceService';
import { employeeService, Employee } from '../../services/employeeService';
import { toast } from 'react-toastify';
import styles from '../../styles/FormPage.module.scss';

const CreateAttendancePage: React.FC = () => {
  const router = useRouter();
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [saving, setSaving] = useState(false);

  const [employeeId, setEmployeeId] = useState('');
  const [date, setDate] = useState('');
  const [checkInTime, setCheckInTime] = useState('');
  const [checkInLat, setCheckInLat] = useState('');
  const [checkInLng, setCheckInLng] = useState('');
  const [checkOutTime, setCheckOutTime] = useState('');
  const [checkOutLat, setCheckOutLat] = useState('');
  const [checkOutLng, setCheckOutLng] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    employeeService.getEmployees().then(setEmployees).catch(() => {});
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!employeeId || !date || !checkInTime || !checkInLat || !checkInLng) {
      toast.error('Employee, date, check-in time, and check-in location are required');
      return;
    }
    setSaving(true);
    try {
      await attendanceService.createRecord({
        employeeId,
        date,
        checkInTime,
        checkInLatitude: parseFloat(checkInLat),
        checkInLongitude: parseFloat(checkInLng),
        checkOutTime: checkOutTime || undefined,
        checkOutLatitude: checkOutLat ? parseFloat(checkOutLat) : undefined,
        checkOutLongitude: checkOutLng ? parseFloat(checkOutLng) : undefined,
        note: note || undefined,
      });
      toast.success('Attendance record created');
      router.push('/attendance');
    } catch (err: any) {
      toast.error(err?.response?.data?.message || 'Failed to create attendance record');
    } finally {
      setSaving(false);
    }
  };

  const employeeOptions = employees.map((e) => ({
    value: e._id,
    label: `${e.username} (${e.userID})`,
  }));

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Create Attendance Record</h1>
          <button className={styles.backButton} onClick={() => router.push('/attendance')}>
            ← Back
          </button>
        </div>

        <form onSubmit={handleSubmit} className={styles.form}>
          <div className={styles.formGroup}>
            <label htmlFor="employeeId">Employee *</label>
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
              <label htmlFor="date">Date *</label>
              <input
                id="date"
                type="date"
                value={date}
                onChange={(e) => setDate(e.target.value)}
                required
                className={styles.input}
              />
            </div>
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="checkInTime">Check-in Time *</label>
              <input
                id="checkInTime"
                type="datetime-local"
                value={checkInTime}
                onChange={(e) => setCheckInTime(e.target.value)}
                required
                className={styles.input}
              />
            </div>
          </div>

          <div className={styles.formRow}>
            <div className={styles.formGroup}>
              <label htmlFor="checkInLat">Check-in Latitude *</label>
              <input
                id="checkInLat"
                type="number"
                step="any"
                value={checkInLat}
                onChange={(e) => setCheckInLat(e.target.value)}
                required
                className={styles.input}
                placeholder="e.g. 24.8607"
              />
            </div>
            <div className={styles.formGroup}>
              <label htmlFor="checkInLng">Check-in Longitude *</label>
              <input
                id="checkInLng"
                type="number"
                step="any"
                value={checkInLng}
                onChange={(e) => setCheckInLng(e.target.value)}
                required
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

          <div className={styles.formGroup}>
            <label htmlFor="note">Note (optional)</label>
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
              onClick={() => router.push('/attendance')}
            >
              Cancel
            </button>
            <button type="submit" className={styles.submitButton} disabled={saving}>
              {saving ? 'Creating…' : 'Create Record'}
            </button>
          </div>
        </form>
      </div>
    </Layout>
  );
};

export default function CreateAttendancePageWrapper() {
  return (
    <ProtectedRoute allowedRoles={['admin']}>
      <CreateAttendancePage />
    </ProtectedRoute>
  );
}
