import React, { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/router';
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
import { format, differenceInMinutes } from 'date-fns';
import styles from '../../../styles/DetailPage.module.scss';

const MapView = dynamic(() => import('../../../components/Map/MapView'), { ssr: false });

function formatDuration(checkIn: string, checkOut?: string): string {
  if (!checkOut) return 'Still working';
  const mins = differenceInMinutes(new Date(checkOut), new Date(checkIn));
  if (mins < 0) return '-';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  if (h === 0) return `${m} min`;
  return `${h}h ${m}m`;
}

const AttendanceDetailPage: React.FC = () => {
  const router = useRouter();
  const { id } = router.query;
  const [record, setRecord] = useState<Attendance | null>(null);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  useEffect(() => {
    if (id) fetchRecord();
  }, [id]);

  const fetchRecord = async () => {
    try {
      const data = await attendanceService.getRecord(id as string);
      setRecord(data);
    } catch {
      toast.error('Failed to fetch attendance record');
    } finally {
      setLoading(false);
    }
  };

  if (loading) {
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

  const checkInMarkers =
    record.checkInLatitude != null && record.checkInLongitude != null
      ? [
          {
            lat: record.checkInLatitude,
            lng: record.checkInLongitude,
            type: 'client' as const,
            label: 'Check-in location',
          },
        ]
      : [];

  const checkOutMarkers =
    record.checkOutLatitude != null && record.checkOutLongitude != null
      ? [
          {
            lat: record.checkOutLatitude,
            lng: record.checkOutLongitude,
            type: 'completion' as const,
            label: 'Check-out location',
          },
        ]
      : [];

  return (
    <Layout>
      <div className={styles.container}>
        <div className={styles.header}>
          <h1>Attendance Detail</h1>
          <div className={styles.headerActions}>
            <button
              className={styles.editButton}
              onClick={() => router.push(`/attendance/${id}/edit`)}
            >
              Edit
            </button>
            <button className={styles.backButton} onClick={() => router.push('/attendance')}>
              ← Back
            </button>
          </div>
        </div>

        {isAdmin && (
          <p
            style={{
              margin: '0 0 1rem',
              padding: '0 1rem',
              color: '#6b7280',
              fontSize: '0.875rem',
              lineHeight: 1.5,
            }}
          >
            Use Edit to correct mistaken check-in or check-out times and GPS coordinates when needed.
          </p>
        )}

        <div className={styles.content}>
          <div className={styles.section}>
            <h2>Attendance Information</h2>
            <div className={styles.infoGrid}>
              <div className={styles.infoItem}>
                <span className={styles.label}>Date</span>
                <span className={styles.value}>
                  {record.date ? format(new Date(record.date), 'EEEE, MMMM dd, yyyy') : '-'}
                </span>
              </div>
              {isAdmin && (
                <div className={styles.infoItem}>
                  <span className={styles.label}>Employee</span>
                  <span className={styles.value}>{getEmployeeLabel(record.employeeId)}</span>
                </div>
              )}
              <div className={styles.infoItem}>
                <span className={styles.label}>Check-in Time</span>
                <span className={styles.value}>
                  {record.checkInTime
                    ? format(new Date(record.checkInTime), 'hh:mm:ss a')
                    : '-'}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Check-out Time</span>
                <span className={styles.value}>
                  {record.checkOutTime
                    ? format(new Date(record.checkOutTime), 'hh:mm:ss a')
                    : 'Not checked out'}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Duration</span>
                <span className={styles.value}>
                  {formatDuration(record.checkInTime, record.checkOutTime)}
                </span>
              </div>
              <div className={styles.infoItem}>
                <span className={styles.label}>Note</span>
                <span className={styles.value}>{record.note || '-'}</span>
              </div>
            </div>
          </div>

          {/* Check-in location */}
          <div className={styles.section}>
            <h2>Check-in Location</h2>
            {checkInMarkers.length > 0 ? (
              <>
                <div className={styles.infoGrid} style={{ marginBottom: '1rem' }}>
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Latitude</span>
                    <span className={styles.value}>
                      {record.checkInLatitude?.toFixed(6)}
                    </span>
                  </div>
                  <div className={styles.infoItem}>
                    <span className={styles.label}>Longitude</span>
                    <span className={styles.value}>
                      {record.checkInLongitude?.toFixed(6)}
                    </span>
                  </div>
                </div>
                <MapView markers={checkInMarkers} height="300px" />
              </>
            ) : (
              <p style={{ color: '#6b7280' }}>No location data available.</p>
            )}
          </div>

          {/* Check-out location */}
          {record.checkOutTime && (
            <div className={styles.section}>
              <h2>Check-out Location</h2>
              {checkOutMarkers.length > 0 ? (
                <>
                  <div className={styles.infoGrid} style={{ marginBottom: '1rem' }}>
                    <div className={styles.infoItem}>
                      <span className={styles.label}>Latitude</span>
                      <span className={styles.value}>
                        {record.checkOutLatitude?.toFixed(6)}
                      </span>
                    </div>
                    <div className={styles.infoItem}>
                      <span className={styles.label}>Longitude</span>
                      <span className={styles.value}>
                        {record.checkOutLongitude?.toFixed(6)}
                      </span>
                    </div>
                  </div>
                  <MapView markers={checkOutMarkers} height="300px" />
                </>
              ) : (
                <p style={{ color: '#6b7280' }}>No check-out location data available.</p>
              )}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
};

export default function AttendanceDetailPageWrapper() {
  return (
    <ProtectedRoute allowedRoles={ALL_ROLES}>
      <AttendanceDetailPage />
    </ProtectedRoute>
  );
}
