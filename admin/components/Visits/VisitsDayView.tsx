import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { addDays, subDays, format, isToday } from 'date-fns';
import { visitService, Visit } from '../../services/visitService';
import { nearestNeighborOrder } from '../../utils/geo';
import StatusBadge from '../UI/StatusBadge';
import styles from '../../styles/VisitsCalendar.module.scss';

const VisitsRouteMap = dynamic(() => import('./VisitsRouteMap'), { ssr: false });

interface VisitsDayViewProps {
  employeeId: string;
}

type LocationStatus = 'idle' | 'loading' | 'granted' | 'error';

const VisitsDayView: React.FC<VisitsDayViewProps> = ({ employeeId }) => {
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [visits, setVisits] = useState<Visit[]>([]);
  const [loading, setLoading] = useState(true);
  const [optimize, setOptimize] = useState(true);
  const [position, setPosition] = useState<{ latitude: number; longitude: number } | null>(null);
  const [locationStatus, setLocationStatus] = useState<LocationStatus>('idle');
  const [locationError, setLocationError] = useState('');
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const dayStr = format(selectedDate, 'yyyy-MM-dd');
    visitService
      .getVisits({ employeeId, startDate: dayStr, endDate: dayStr })
      .then((data) => {
        if (!cancelled) setVisits(data);
      })
      .catch(() => {
        if (!cancelled) setVisits([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate.getTime(), employeeId]);

  const requestLocation = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setLocationStatus('error');
      setLocationError('Location not supported on this device.');
      return;
    }
    setLocationStatus('loading');
    setLocationError('');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setPosition({ latitude: pos.coords.latitude, longitude: pos.coords.longitude });
        setLocationStatus('granted');
      },
      () => {
        setLocationStatus('error');
        setLocationError('Location denied — showing default order.');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  useEffect(() => {
    requestLocation();
  }, []);

  const orderedVisits = useMemo(() => {
    if (!optimize || !position) {
      return visits.map((v) => ({ visit: v, distanceKm: NaN }));
    }
    const result = nearestNeighborOrder(position, visits, (v) =>
      v.dealerId?.latitude != null && v.dealerId?.longitude != null
        ? { latitude: v.dealerId.latitude, longitude: v.dealerId.longitude }
        : null,
    );
    return result.map((r) => ({ visit: r.item, distanceKm: r.distanceKm }));
  }, [visits, optimize, position]);

  const totalDistanceKm = useMemo(
    () => orderedVisits.reduce((sum, r) => (Number.isFinite(r.distanceKm) ? sum + r.distanceKm : sum), 0),
    [orderedVisits],
  );

  return (
    <div className={styles.dayViewCard}>
      <div className={styles.dayViewHeader}>
        <button type="button" className={styles.navButton} onClick={() => setSelectedDate((d) => subDays(d, 1))}>
          ‹ Prev
        </button>
        <div className={styles.dayViewDateGroup}>
          <h2>{format(selectedDate, 'EEEE, MMM d, yyyy')}</h2>
          {isToday(selectedDate) && <span className={styles.todayTag}>Today</span>}
        </div>
        <button type="button" className={styles.navButton} onClick={() => setSelectedDate((d) => addDays(d, 1))}>
          Next ›
        </button>
        <input
          type="date"
          className={styles.dateJumpInput}
          value={format(selectedDate, 'yyyy-MM-dd')}
          onChange={(e) => {
            if (e.target.value) setSelectedDate(new Date(`${e.target.value}T00:00:00`));
          }}
        />
        {!isToday(selectedDate) && (
          <button type="button" className={styles.todayButton} onClick={() => setSelectedDate(new Date())}>
            Today
          </button>
        )}
      </div>

      <div className={styles.routeBar}>
        <label className={styles.routeToggle}>
          <input type="checkbox" checked={optimize} onChange={(e) => setOptimize(e.target.checked)} />
          <span>Sort by shortest route</span>
        </label>
        {optimize && locationStatus === 'loading' && (
          <span className={styles.routeHint}>Getting your location…</span>
        )}
        {optimize && locationStatus === 'granted' && position && (
          <span className={styles.routeHint}>
            Optimized from your location{totalDistanceKm > 0 ? ` · ~${totalDistanceKm.toFixed(1)} km total` : ''}
          </span>
        )}
        {optimize && locationStatus === 'error' && (
          <span className={styles.routeHintWarn}>
            {locationError}{' '}
            <button type="button" className={styles.retryLink} onClick={requestLocation}>
              Retry
            </button>
          </span>
        )}
      </div>

      {loading ? (
        <p className={styles.loadingHint}>Loading visits…</p>
      ) : visits.length === 0 ? (
        <p className={styles.emptyHint}>No visits scheduled for this day.</p>
      ) : (
        <>
          <VisitsRouteMap origin={position} stops={orderedVisits} />
          <div className={styles.visitCardList}>
            {orderedVisits.map(({ visit: v, distanceKm }, index) => (
              <div key={v._id} className={styles.visitCard} onClick={() => router.push(`/visits/${v._id}`)}>
                <span className={styles.visitCardOrder}>{index + 1}</span>
                <div className={styles.visitCardMain}>
                  <strong>{v.dealerId?.name || v.dealerId?.shopName || 'Client'}</strong>
                  <div className={styles.visitCardSubline}>
                    {v.routeId?.name && <span className={styles.visitCardRoute}>{v.routeId.name}</span>}
                    {optimize && Number.isFinite(distanceKm) && (
                      <span className={styles.visitCardDistance}>{distanceKm.toFixed(1)} km from previous</span>
                    )}
                  </div>
                </div>
                <StatusBadge status={v.status} />
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
};

export default VisitsDayView;
