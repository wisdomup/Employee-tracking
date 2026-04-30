import React, { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import DatePicker from 'react-datepicker';
import Layout from '../../../components/Layout/Layout';
import ProtectedRoute from '../../../components/Auth/ProtectedRoute';
import Loader from '../../../components/UI/Loader';
import {
  attendanceService,
  Attendance,
  getEmployeeLabel,
} from '../../../services/attendanceService';
import { useAuth } from '../../../contexts/AuthContext';
import { ALL_ROLES } from '../../../utils/permissions';
import { toast } from 'react-toastify';
import { format } from 'date-fns';
import 'react-datepicker/dist/react-datepicker.css';
import styles from '../../../styles/FormPage.module.scss';
import pickerStyles from '../../../components/UI/DatePickerFilter.module.scss';

function buildAdminUpdatePayload(
  record: Attendance,
  fields: {
    date: string;
    checkInTime: Date | null;
    checkInLat: string;
    checkInLng: string;
    checkOutTime: Date | null;
    checkOutLat: string;
    checkOutLng: string;
    note: string;
  },
): Record<string, unknown> {
  const clearingCheckout = fields.checkOutTime === null && !!record.checkOutTime;
  return {
    date: fields.date || undefined,
    checkInTime: fields.checkInTime ? fields.checkInTime.toISOString() : undefined,
    checkInLatitude: fields.checkInLat ? parseFloat(fields.checkInLat) : undefined,
    checkInLongitude: fields.checkInLng ? parseFloat(fields.checkInLng) : undefined,
    checkOutTime: fields.checkOutTime
      ? fields.checkOutTime.toISOString()
      : clearingCheckout
        ? null
        : undefined,
    checkOutLatitude: clearingCheckout
      ? null
      : fields.checkOutLat
        ? parseFloat(fields.checkOutLat)
        : undefined,
    checkOutLongitude: clearingCheckout
      ? null
      : fields.checkOutLng
        ? parseFloat(fields.checkOutLng)
        : undefined,
    note: fields.note,
  };
}

const EditAttendancePage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const { user, loading: authLoading } = useAuth();
  const isAdmin = user?.role === 'admin';

  const [record, setRecord] = useState<Attendance | null>(null);
  const [fetchLoading, setFetchLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Shared field
  const [note, setNote] = useState('');

  // Admin-only fields
  const [date, setDate] = useState('');
  const [checkInTime, setCheckInTime] = useState<Date | null>(null);
  const [checkInLat, setCheckInLat] = useState('');
  const [checkInLng, setCheckInLng] = useState('');
  const [checkOutTime, setCheckOutTime] = useState<Date | null>(null);
  const [checkOutLat, setCheckOutLat] = useState('');
  const [checkOutLng, setCheckOutLng] = useState('');

  const applyAdminFieldsFromRecord = useCallback((data: Attendance) => {
    setDate(data.date ? format(new Date(data.date), 'yyyy-MM-dd') : '');
    setCheckInTime(data.checkInTime ? new Date(data.checkInTime) : null);
    setCheckInLat(data.checkInLatitude != null ? String(data.checkInLatitude) : '');
    setCheckInLng(data.checkInLongitude != null ? String(data.checkInLongitude) : '');
    setCheckOutTime(data.checkOutTime ? new Date(data.checkOutTime) : null);
    setCheckOutLat(data.checkOutLatitude != null ? String(data.checkOutLatitude) : '');
    setCheckOutLng(data.checkOutLongitude != null ? String(data.checkOutLongitude) : '');
  }, []);

  useEffect(() => {
    if (!id || authLoading) return;
    let cancelled = false;
    setFetchLoading(true);
    (async () => {
      try {
        const data = await attendanceService.getRecord(id as string);
        if (cancelled) return;
        setRecord(data);
        setNote(data.note || '');
      } catch {
        if (!cancelled) toast.error('Failed to fetch attendance record');
      } finally {
        if (!cancelled) setFetchLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id, authLoading]);

  useEffect(() => {
    if (!record || !isAdmin) return;
    applyAdminFieldsFromRecord(record);
  }, [record, isAdmin, applyAdminFieldsFromRecord]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id) return;
    setSaving(true);
    try {
      if (isAdmin && record) {
        await attendanceService.updateRecord(
          id as string,
          buildAdminUpdatePayload(record, {
            date,
            checkInTime,
            checkInLat,
            checkInLng,
            checkOutTime,
            checkOutLat,
            checkOutLng,
            note,
          }),
        );
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
              <p
                style={{
                  marginBottom: '1.25rem',
                  marginTop: 0,
                  color: '#6b7280',
                  fontSize: '0.875rem',
                  lineHeight: 1.5,
                }}
              >
                You can correct mistaken check-in or check-out times and GPS coordinates below.
                Clearing check-out time removes the checkout and its coordinates on save.
              </p>
              <div className={styles.formGroup}>
                <label>Employee</label>
                <input
                  type="text"
                  value={getEmployeeLabel(record.employeeId)}
                  className={styles.input}
                  disabled
                />
              </div>

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

              <div className={styles.formGroup}>
                <label htmlFor="checkInTime">Check-in Time</label>
                <div className={pickerStyles.fullWidth}>
                  <DatePicker
                    id="checkInTime"
                    selected={checkInTime}
                    onChange={(value: Date | null) => setCheckInTime(value)}
                    showTimeSelect
                    timeIntervals={5}
                    dateFormat="MMM d, yyyy h:mm aa"
                    className={styles.input}
                    placeholderText="Select check-in date and time"
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

              <div className={styles.formGroup}>
                <label htmlFor="checkOutTime">Check-out Time (optional)</label>
                <div className={pickerStyles.fullWidth}>
                  <DatePicker
                    id="checkOutTime"
                    selected={checkOutTime}
                    onChange={(value: Date | null) => setCheckOutTime(value)}
                    showTimeSelect
                    timeIntervals={5}
                    dateFormat="MMM d, yyyy h:mm aa"
                    className={styles.input}
                    placeholderText="Select check-out date and time"
                    isClearable
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
