import React, { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import dynamic from 'next/dynamic';
import { addDays, subDays, format, isToday } from 'date-fns';
import {
  visitService,
  Visit,
  formatVisitOrderAmount,
  VISIT_DURATION_LIMIT_MINUTES,
} from '../../services/visitService';
import { nearestNeighborOrder } from '../../utils/geo';
import StatusBadge from '../UI/StatusBadge';
import NavigateButton from '../Map/NavigateButton';
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

  // Tick while any visit is checked in, so the rider can watch their time at the store.
  const hasOpenCheckIn = visits.some((v) => v.status === 'checked_in');
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    if (!hasOpenCheckIn) return;
    const timer = window.setInterval(() => setNowTick(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [hasOpenCheckIn]);

  /** Minutes elapsed since check-in, for a visit the rider is currently inside. */
  const elapsedMinutesFor = (v: Visit): number | null =>
    v.status === 'checked_in' && v.checkedInAt
      ? Math.max(0, Math.floor((nowTick - new Date(v.checkedInAt).getTime()) / 60_000))
      : null;

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
                    {(() => {
                      const elapsed = elapsedMinutesFor(v);
                      if (elapsed == null) return null;
                      const over = elapsed > VISIT_DURATION_LIMIT_MINUTES;
                      return (
                        <span
                          style={{
                            color: over ? '#b91c1c' : '#0369a1',
                            fontWeight: 600,
                            whiteSpace: 'nowrap',
                          }}
                          title={
                            over
                              ? `Over the ${VISIT_DURATION_LIMIT_MINUTES} min limit — this visit will be flagged`
                              : `${VISIT_DURATION_LIMIT_MINUTES} min allowed at the store`
                          }
                        >
                          {over ? '⚠️ ' : '⏱ '}
                          {elapsed} min at store
                        </span>
                      );
                    })()}
                    {v.isSelfInitiated && (
                      <span
                        style={{
                          padding: '0.0625rem 0.375rem',
                          borderRadius: '9999px',
                          fontSize: '0.6875rem',
                          fontWeight: 600,
                          background: '#ede9fe',
                          color: '#5b21b6',
                          whiteSpace: 'nowrap',
                        }}
                        title="Extra visit you started yourself — not counted in today's 75% target"
                      >
                        Extra
                      </span>
                    )}
                    {/* Only once the rider has actually been in the shop — showing
                        "No Order" against a to-do visit would be nagging, not reporting. */}
                    {(v.status === 'checked_in' || v.status === 'completed') && (
                      <span
                        style={{
                          padding: '0.0625rem 0.375rem',
                          borderRadius: '9999px',
                          fontSize: '0.6875rem',
                          fontWeight: 700,
                          whiteSpace: 'nowrap',
                          background: v.orderSummary ? '#d1fae5' : '#fef3c7',
                          color: v.orderSummary ? '#065f46' : '#92400e',
                        }}
                        title={
                          v.orderSummary
                            ? `${v.orderSummary.orderCount} order(s) taken during this visit`
                            : 'No order was taken during this visit'
                        }
                      >
                        {formatVisitOrderAmount(v.orderSummary)}
                      </span>
                    )}
                    {v.overstayFlagged && v.status === 'completed' && (
                      <span style={{ color: '#b91c1c', fontWeight: 600, whiteSpace: 'nowrap' }}>
                        ⚠️ {v.durationMinutes} min — flagged
                      </span>
                    )}
                    {v.dealerId?.latitude != null && v.dealerId?.longitude != null && (
                      <span onClick={(e) => e.stopPropagation()}>
                        <NavigateButton
                          destination={{ lat: v.dealerId.latitude, lng: v.dealerId.longitude }}
                          variant="link"
                          title={`Open driving directions to ${v.dealerId?.name ?? 'this client'}`}
                        />
                      </span>
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
