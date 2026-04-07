import React, { useEffect, useMemo, useState } from 'react';
import dynamic from 'next/dynamic';
import Link from 'next/link';
import {
  ArrowsClockwise,
  CheckCircle,
  ClipboardText,
  Folders,
  Hourglass,
  MapTrifold,
  Package,
  PencilSimple,
  Play,
  Plus,
  ShoppingCart,
  Storefront,
  Trash,
  Users,
} from '@phosphor-icons/react';
import Layout from '../components/Layout/Layout';
import ProtectedRoute from '../components/Auth/ProtectedRoute';
import Loader from '../components/UI/Loader';
import MapView, { type MapPinIcon } from '../components/Map/MapView';
import DatePickerFilter from '../components/UI/DatePickerFilter';
import {
  dashboardService,
  DashboardReports,
  DashboardStats,
  RecentActivityEntry,
} from '../services/dashboardService';
import { visitService, Visit, getVisitCompletionImageUrl } from '../services/visitService';
import { taskService } from '../services/taskService';
import { useAuth } from '../contexts/AuthContext';
import { ALL_ROLES } from '../utils/permissions';
import { format } from 'date-fns';
import styles from '../styles/Dashboard.module.scss';
import { buildTrendDataFromReports } from '../utils/dashboardReportsTrend';

const LineTrendChart = dynamic(() => import('../components/UI/LineTrendChart'), {
  ssr: false,
});

const STAT_ICON_SIZE = 34;
const ACTIVITY_ICON_SIZE = 22;

type DashIcon = React.ComponentType<{
  size?: number;
  weight?: 'thin' | 'light' | 'regular' | 'bold' | 'fill' | 'duotone';
  className?: string;
  'aria-hidden'?: boolean;
}>;

function StatCardIcon({ Icon }: { Icon: DashIcon }) {
  return (
    <div className={styles.statIcon}>
      <Icon size={STAT_ICON_SIZE} weight="duotone" aria-hidden />
    </div>
  );
}

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const isOrderTaker = user?.role === 'order_taker';

  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [reports, setReports] = useState<DashboardReports | null>(null);
  const [loading, setLoading] = useState(true);
  const [reportLoading, setReportLoading] = useState(true);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [groupBy, setGroupBy] = useState<'day' | 'month' | 'year'>('month');

  const [orderTakerStats, setOrderTakerStats] = useState<{
    totalVisits: number;
    visitsTodo: number;
    visitsInProgress: number;
    visitsCompleted: number;
    totalTasks: number;
    tasksPending: number;
    tasksInProgress: number;
    tasksCompleted: number;
  } | null>(null);
  const [orderTakerVisitsForDate, setOrderTakerVisitsForDate] = useState<Visit[]>([]);
  const [orderTakerMapDate, setOrderTakerMapDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [orderTakerMapLoading, setOrderTakerMapLoading] = useState(false);
  const [orderTakerLocation, setOrderTakerLocation] = useState<{ lat: number; lng: number } | null>(null);
  const [orderTakerLocationError, setOrderTakerLocationError] = useState('');
  const [orderTakerRoutePath, setOrderTakerRoutePath] = useState<[number, number][]>([]);
  const [isVisitsMapFullscreen, setIsVisitsMapFullscreen] = useState(false);

  useEffect(() => {
    if (isAdmin) {
      fetchInitialData();
    } else if (isOrderTaker && user?.id) {
      fetchOrderTakerStats(user.id);
      setLoading(false);
      setReportLoading(false);
    } else {
      setLoading(false);
      setReportLoading(false);
    }
  }, [isAdmin, isOrderTaker, user?.id]);

  const fetchOrderTakerStats = async (userId: string) => {
    try {
      const [visits, tasks] = await Promise.all([
        visitService.getVisits({ employeeId: userId }),
        taskService.getTasks({ assignedTo: userId }),
      ]);
      setOrderTakerStats({
        totalVisits: visits.length,
        visitsTodo: visits.filter((v: any) => v.status === 'todo').length,
        visitsInProgress: visits.filter((v: any) => v.status === 'in_progress').length,
        visitsCompleted: visits.filter((v: any) => v.status === 'completed').length,
        totalTasks: tasks.length,
        tasksPending: tasks.filter((t: any) => t.status === 'pending').length,
        tasksInProgress: tasks.filter((t: any) => t.status === 'in_progress').length,
        tasksCompleted: tasks.filter((t: any) => t.status === 'completed').length,
      });
    } catch {
      // non-critical — widgets will just show links without counts
    }
  };

  const fetchOrderTakerVisitsForDate = async (userId: string, date: string) => {
    setOrderTakerMapLoading(true);
    try {
      const visits = await visitService.getVisits({
        employeeId: userId,
        startDate: date,
        endDate: date,
      });
      setOrderTakerVisitsForDate(visits);
    } catch {
      setOrderTakerVisitsForDate([]);
    } finally {
      setOrderTakerMapLoading(false);
    }
  };

  useEffect(() => {
    if (!isOrderTaker || !user?.id) return;
    fetchOrderTakerVisitsForDate(user.id, orderTakerMapDate);
  }, [isOrderTaker, user?.id, orderTakerMapDate]);

  useEffect(() => {
    if (!isOrderTaker) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setOrderTakerLocationError('Location is not supported by this browser.');
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setOrderTakerLocation({
          lat: position.coords.latitude,
          lng: position.coords.longitude,
        });
        setOrderTakerLocationError('');
      },
      () => {
        setOrderTakerLocationError('Location permission denied or unavailable.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, [isOrderTaker]);

  useEffect(() => {
    if (!isAdmin) return;
    const run = async () => {
      setReportLoading(true);
      try {
        const data = await dashboardService.getReports({ startDate, endDate, groupBy, viewBy: 'item' });
        setReports(data);
      } catch (error) {
        console.error('Failed to fetch dashboard reports:', error);
      } finally {
        setReportLoading(false);
      }
    };
    run();
  }, [startDate, endDate, groupBy, isAdmin]);

  const fetchInitialData = async () => {
    try {
      const [statsData, reportData] = await Promise.all([
        dashboardService.getStats(),
        dashboardService.getReports({ startDate, endDate, groupBy, viewBy: 'item' }),
      ]);
      setStats(statsData);
      setReports(reportData);
    } catch (error) {
      console.error('Failed to fetch dashboard stats:', error);
    } finally {
      setLoading(false);
      setReportLoading(false);
    }
  };

  const trendData = useMemo(() => buildTrendDataFromReports(reports), [reports]);

  const orderTakerVisitSummary = useMemo(() => {
    return {
      total: orderTakerVisitsForDate.length,
      todo: orderTakerVisitsForDate.filter((v) => v.status === 'todo').length,
      inProgress: orderTakerVisitsForDate.filter((v) => v.status === 'in_progress').length,
      completed: orderTakerVisitsForDate.filter((v) => v.status === 'completed').length,
      incomplete: orderTakerVisitsForDate.filter((v) => v.status === 'incomplete').length,
      cancelled: orderTakerVisitsForDate.filter((v) => v.status === 'cancelled').length,
    };
  }, [orderTakerVisitsForDate]);

  const orderTakerVisitMarkers = useMemo(() => {
    const dealerPinForStatus = (
      status: Visit['status'] | undefined,
    ): {
      pinIcon: MapPinIcon;
      pinLabel: string;
      pinLabelStrikethrough?: boolean;
    } => {
      switch (status) {
        case 'todo':
          return { pinIcon: 'blue', pinLabel: 'To Do' };
        case 'in_progress':
          return { pinIcon: 'gold', pinLabel: 'In progress' };
        case 'completed':
          return { pinIcon: 'green', pinLabel: 'Completed', pinLabelStrikethrough: true };
        case 'incomplete':
          return { pinIcon: 'grey', pinLabel: 'Incomplete' };
        case 'cancelled':
          return { pinIcon: 'grey', pinLabel: 'Cancelled' };
        default:
          return { pinIcon: 'grey', pinLabel: 'Visit' };
      }
    };

    const buildPopup = (visit: Visit, markerType: 'client' | 'completion') => {
      const visitId = visit._id;
      const clientName = visit.dealerId?.name || 'Client';
      const routeName = visit.routeId?.name || '-';
      const status = visit.status || '-';
      const visitDate = visit.visitDate ? format(new Date(visit.visitDate), 'MMM dd, yyyy') : '-';
      const destinationLat = visit.dealerId?.latitude;
      const destinationLng = visit.dealerId?.longitude;
      const routeUrl =
        orderTakerLocation && destinationLat && destinationLng
          ? `https://www.google.com/maps/dir/?api=1&origin=${orderTakerLocation.lat},${orderTakerLocation.lng}&destination=${destinationLat},${destinationLng}&travelmode=driving`
          : destinationLat && destinationLng
            ? `https://www.google.com/maps/search/?api=1&query=${destinationLat},${destinationLng}`
            : '';
      const imagesHtml = (visit.completionImages || [])
        .map((img) => `<img src="${getVisitCompletionImageUrl(img.url)}" alt="${img.type}" style="width:60px;height:60px;object-fit:cover;border-radius:6px;border:1px solid #ddd;" />`)
        .join('');

      return `
        <div style="min-width:220px;">
          <div style="font-weight:600;margin-bottom:4px;">${clientName}</div>
          <div style="font-size:12px;color:#4b5563;margin-bottom:2px;">Status: ${status.replace('_', ' ')}</div>
          <div style="font-size:12px;color:#4b5563;margin-bottom:2px;">Visit Date: ${visitDate}</div>
          <div style="font-size:12px;color:#4b5563;margin-bottom:6px;">Route: ${routeName}</div>
          <div style="font-size:12px;color:var(--admin-primary);margin-bottom:4px;">Marker: ${markerType === 'client' ? 'Client location' : 'Completion location'}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:8px;">
            ${visitId ? `<a href="/visits/${visitId}/edit?nextStatus=in_progress" style="display:inline-block;padding:6px 10px;background:#0ea5e9;color:#fff;border-radius:6px;text-decoration:none;font-size:12px;">Set In Progress</a>` : ''}
            ${visitId ? `<a href="/visits/${visitId}/edit?nextStatus=completed" style="display:inline-block;padding:6px 10px;background:#16a34a;color:#fff;border-radius:6px;text-decoration:none;font-size:12px;">Set Completed</a>` : ''}
          </div>
          ${status !== 'completed' ? '<div style="font-size:11px;color:#6b7280;margin-bottom:8px;">Completion needs GPS location + shop image + selfie.</div>' : ''}
          ${routeUrl ? `<a href="${routeUrl}" target="_blank" rel="noopener noreferrer" style="display:inline-block;margin-bottom:8px;padding:6px 10px;background:var(--admin-primary);color:#fff;border-radius:6px;text-decoration:none;font-size:12px;">View Route</a>` : ''}
          ${imagesHtml ? `<div style="display:flex;gap:6px;flex-wrap:wrap;">${imagesHtml}</div>` : '<div style="font-size:12px;color:#6b7280;">No completion images</div>'}
        </div>
      `;
    };

    const visitMarkers = orderTakerVisitsForDate.flatMap((visit) => {
      const markers: {
        lat: number;
        lng: number;
        type: 'client' | 'completion' | 'current';
        label: string;
        pinLabel?: string;
        pinIcon?: MapPinIcon;
        pinLabelStrikethrough?: boolean;
      }[] = [];

      if (visit.dealerId?.latitude && visit.dealerId?.longitude) {
        const dp = dealerPinForStatus(visit.status);
        markers.push({
          lat: visit.dealerId.latitude,
          lng: visit.dealerId.longitude,
          type: 'client',
          label: buildPopup(visit, 'client'),
          pinIcon: dp.pinIcon,
          pinLabel: dp.pinLabel,
          pinLabelStrikethrough: dp.pinLabelStrikethrough,
        });
      }

      if (visit.latitude && visit.longitude) {
        markers.push({
          lat: visit.latitude,
          lng: visit.longitude,
          type: 'completion',
          label: buildPopup(visit, 'completion'),
          pinIcon: 'green',
          pinLabel: 'Completed',
          pinLabelStrikethrough: visit.status === 'completed',
        });
      }

      return markers;
    });

    if (orderTakerLocation) {
      visitMarkers.unshift({
        lat: orderTakerLocation.lat,
        lng: orderTakerLocation.lng,
        type: 'current',
        label: '<div><strong>My Current Location</strong></div>',
        pinIcon: 'red',
        pinLabel: 'My location',
      });
    }

    return visitMarkers;
  }, [orderTakerVisitsForDate, orderTakerLocation]);

  const orderedVisitStops = useMemo(() => {
    const geoDistanceKm = (
      aLat: number,
      aLng: number,
      bLat: number,
      bLng: number,
    ) => {
      const toRad = (deg: number) => (deg * Math.PI) / 180;
      const R = 6371;
      const dLat = toRad(bLat - aLat);
      const dLng = toRad(bLng - aLng);
      const aa =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(aLat)) *
          Math.cos(toRad(bLat)) *
          Math.sin(dLng / 2) *
          Math.sin(dLng / 2);
      const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
      return R * c;
    };

    const optimizeNearestNeighbor = (
      stops: Visit[],
      start?: { lat: number; lng: number } | null,
    ) => {
      if (stops.length <= 1) return stops;
      const remaining = [...stops];
      const result: Visit[] = [];
      let current = start
        ? { lat: start.lat, lng: start.lng }
        : { lat: remaining[0].dealerId.latitude, lng: remaining[0].dealerId.longitude };

      while (remaining.length > 0) {
        let bestIdx = 0;
        let bestDist = Number.POSITIVE_INFINITY;
        for (let i = 0; i < remaining.length; i += 1) {
          const stop = remaining[i];
          const d = geoDistanceKm(
            current.lat,
            current.lng,
            stop.dealerId.latitude,
            stop.dealerId.longitude,
          );
          if (d < bestDist) {
            bestDist = d;
            bestIdx = i;
          }
        }
        const [nextStop] = remaining.splice(bestIdx, 1);
        result.push(nextStop);
        current = { lat: nextStop.dealerId.latitude, lng: nextStop.dealerId.longitude };
      }
      return result;
    };

    const validStops = [...orderTakerVisitsForDate].filter(
      (v) => v.dealerId?.latitude && v.dealerId?.longitude,
    );

    // Keep actionable stops first, but optimize route order by proximity inside each group.
    const actionable = validStops.filter((v) => v.status === 'todo' || v.status === 'in_progress');
    const nonActionable = validStops.filter((v) => v.status !== 'todo' && v.status !== 'in_progress');

    const optimizedActionable = optimizeNearestNeighbor(actionable, orderTakerLocation);
    const startForNonActionable =
      optimizedActionable.length > 0
        ? {
            lat: optimizedActionable[optimizedActionable.length - 1].dealerId.latitude,
            lng: optimizedActionable[optimizedActionable.length - 1].dealerId.longitude,
          }
        : orderTakerLocation;
    const optimizedNonActionable = optimizeNearestNeighbor(nonActionable, startForNonActionable);

    return [...optimizedActionable, ...optimizedNonActionable];
  }, [orderTakerVisitsForDate, orderTakerLocation]);

  useEffect(() => {
    const buildRoadRoute = async () => {
      const points: [number, number][] = [];
      if (orderTakerLocation) {
        points.push([orderTakerLocation.lat, orderTakerLocation.lng]);
      }
      orderedVisitStops.forEach((visit) => {
        points.push([visit.dealerId.latitude, visit.dealerId.longitude]);
      });

      if (points.length < 2) {
        setOrderTakerRoutePath([]);
        return;
      }

      try {
        // Fetch realistic driving path segment-by-segment.
        const segmentRequests: Promise<Response>[] = [];
        for (let i = 0; i < points.length - 1; i += 1) {
          const [startLat, startLng] = points[i];
          const [endLat, endLng] = points[i + 1];
          segmentRequests.push(
            fetch(
              `https://router.project-osrm.org/route/v1/driving/${startLng},${startLat};${endLng},${endLat}?overview=full&geometries=geojson`,
            ),
          );
        }

        const responses = await Promise.all(segmentRequests);
        const payloads = await Promise.all(responses.map((r) => r.json()));

        const roadPoints: [number, number][] = [];
        payloads.forEach((payload: any) => {
          const coords = payload?.routes?.[0]?.geometry?.coordinates;
          if (!Array.isArray(coords)) return;
          coords.forEach((c: [number, number], idx: number) => {
            const nextPoint: [number, number] = [c[1], c[0]];
            if (idx === 0 && roadPoints.length > 0) return;
            roadPoints.push(nextPoint);
          });
        });

        if (roadPoints.length >= 2) {
          setOrderTakerRoutePath(roadPoints);
        } else {
          setOrderTakerRoutePath(points);
        }
      } catch {
        // Fallback to straight polyline only if route API fails.
        setOrderTakerRoutePath(points);
      }
    };

    buildRoadRoute();
  }, [orderTakerLocation, orderedVisitStops]);

  const orderTakerVisitPath = useMemo(() => {
    if (orderTakerRoutePath.length < 2) return [];
    return [
      {
        points: orderTakerRoutePath,
        color: '#111827',
        weight: 4,
        opacity: 0.9,
        label: 'Suggested driving path',
      },
    ];
  }, [orderTakerRoutePath]);

  const nextVisitStop = useMemo(() => {
    return orderedVisitStops[0] || null;
  }, [orderedVisitStops]);

  const nextVisitNavigationUrl = useMemo(() => {
    if (!nextVisitStop?.dealerId?.latitude || !nextVisitStop?.dealerId?.longitude) return '';
    const destination = `${nextVisitStop.dealerId.latitude},${nextVisitStop.dealerId.longitude}`;
    if (orderTakerLocation) {
      const origin = `${orderTakerLocation.lat},${orderTakerLocation.lng}`;
      return `https://www.google.com/maps/dir/?api=1&origin=${origin}&destination=${destination}&travelmode=driving`;
    }
    return `https://www.google.com/maps/search/?api=1&query=${destination}`;
  }, [nextVisitStop, orderTakerLocation]);

  if (loading) {
    return (
      <Layout>
        <Loader />
      </Layout>
    );
  }

  if (isOrderTaker) {
    return (
      <Layout>
        <div className={styles.dashboard}>
          <h1 className={styles.title}>Welcome, {user?.username}!</h1>
          <p style={{ color: 'var(--text-secondary, #666)', marginBottom: '2rem' }}>
            Here is a quick overview of your workspace.
          </p>

          <div className={styles.section} style={{ marginBottom: '2rem' }}>
            <div className={styles.reportHeader} style={{ marginBottom: '1rem' }}>
              <h2 className={styles.sectionTitle}>My Visits Map</h2>
              <button
                type="button"
                onClick={() => setIsVisitsMapFullscreen(true)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0.5rem 0.85rem',
                  borderRadius: '8px',
                  background: 'var(--admin-primary)',
                  color: '#fff',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                }}
              >
                Full Screen
              </button>
            </div>
            <div className={styles.reportFilters} style={{ marginBottom: '1rem' }}>
              <DatePickerFilter
                value={orderTakerMapDate}
                onChange={setOrderTakerMapDate}
                placeholder="Visit date"
                title="Visit date"
              />
              <a
                href={nextVisitNavigationUrl || '#'}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  pointerEvents: nextVisitNavigationUrl ? 'auto' : 'none',
                  opacity: nextVisitNavigationUrl ? 1 : 0.6,
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0.5rem 0.85rem',
                  borderRadius: '8px',
                  background: 'var(--admin-primary)',
                  color: '#fff',
                  textDecoration: 'none',
                  fontSize: '0.875rem',
                  fontWeight: 600,
                  whiteSpace: 'nowrap',
                }}
              >
                Start Navigation
              </a>
            </div>
            {nextVisitStop && (
              <div style={{ fontSize: '0.85rem', color: '#4b5563', marginBottom: '0.75rem' }}>
                Next stop: <strong>{nextVisitStop.dealerId?.name || 'Dealer'}</strong> ({nextVisitStop.status.replace('_', ' ')})
              </div>
            )}
            {orderTakerLocationError && (
              <div className={styles.emptyState} style={{ marginBottom: '1rem' }}>
                {orderTakerLocationError}
              </div>
            )}
            <div className={styles.statsGrid} style={{ marginBottom: '1rem' }}>
              <div className={styles.statCard}><div className={styles.statContent}><div className={styles.statValue}>{orderTakerVisitSummary.total}</div><div className={styles.statLabel}>Total</div></div></div>
              <div className={styles.statCard}><div className={styles.statContent}><div className={styles.statValue}>{orderTakerVisitSummary.todo}</div><div className={styles.statLabel}>To Do</div></div></div>
              <div className={styles.statCard}><div className={styles.statContent}><div className={styles.statValue}>{orderTakerVisitSummary.inProgress}</div><div className={styles.statLabel}>In Progress</div></div></div>
              <div className={styles.statCard}><div className={styles.statContent}><div className={styles.statValue}>{orderTakerVisitSummary.completed}</div><div className={styles.statLabel}>Completed</div></div></div>
            </div>
            {orderTakerMapLoading ? (
              <Loader />
            ) : orderTakerVisitMarkers.length > 0 ? (
              <MapView markers={orderTakerVisitMarkers} polylines={orderTakerVisitPath} height="420px" />
            ) : (
              <div className={styles.emptyState}>No visits found for selected date.</div>
            )}
          </div>

          {isVisitsMapFullscreen && (
            <div className={styles.mapFullscreenOverlay}>
              <div className={styles.mapFullscreenContent}>
                <div className={styles.mapFullscreenHeader}>
                  <h2 className={styles.sectionTitle} style={{ marginBottom: 0 }}>My Visits Map</h2>
                  <button
                    type="button"
                    onClick={() => setIsVisitsMapFullscreen(false)}
                    className={styles.mapFullscreenClose}
                  >
                    Close
                  </button>
                </div>
                <div className={styles.reportFilters} style={{ marginBottom: '1rem' }}>
                  <DatePickerFilter
                    value={orderTakerMapDate}
                    onChange={setOrderTakerMapDate}
                    placeholder="Visit date"
                    title="Visit date"
                  />
                  <a
                    href={nextVisitNavigationUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{
                      pointerEvents: nextVisitNavigationUrl ? 'auto' : 'none',
                      opacity: nextVisitNavigationUrl ? 1 : 0.6,
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '0.5rem 0.85rem',
                      borderRadius: '8px',
                      background: 'var(--admin-primary)',
                      color: '#fff',
                      textDecoration: 'none',
                      fontSize: '0.875rem',
                      fontWeight: 600,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    Start Navigation
                  </a>
                </div>
                {orderTakerMapLoading ? (
                  <Loader />
                ) : orderTakerVisitMarkers.length > 0 ? (
                  <MapView markers={orderTakerVisitMarkers} polylines={orderTakerVisitPath} height="78vh" />
                ) : (
                  <div className={styles.emptyState}>No visits found for selected date.</div>
                )}
              </div>
            </div>
          )}

          {/* Tasks widgets */}
          <h2 className={styles.sectionTitle} style={{ marginBottom: '1rem' }}>My Tasks</h2>
          <div className={styles.statsGrid} style={{ marginBottom: '2rem' }}>
            <Link href="/tasks" className={styles.statCard}>
              <StatCardIcon Icon={ClipboardText} />
              <div className={styles.statContent}>
                {orderTakerStats && <div className={styles.statValue}>{orderTakerStats.totalTasks}</div>}
                <div className={styles.statLabel}>Total Tasks</div>
              </div>
            </Link>
            <Link href="/tasks" className={styles.statCard}>
              <StatCardIcon Icon={Hourglass} />
              <div className={styles.statContent}>
                {orderTakerStats && <div className={styles.statValue}>{orderTakerStats.tasksPending}</div>}
                <div className={styles.statLabel}>Pending</div>
              </div>
            </Link>
            <Link href="/tasks" className={styles.statCard}>
              <StatCardIcon Icon={ArrowsClockwise} />
              <div className={styles.statContent}>
                {orderTakerStats && <div className={styles.statValue}>{orderTakerStats.tasksInProgress}</div>}
                <div className={styles.statLabel}>In Progress</div>
              </div>
            </Link>
            <Link href="/tasks" className={styles.statCard}>
              <StatCardIcon Icon={CheckCircle} />
              <div className={styles.statContent}>
                {orderTakerStats && <div className={styles.statValue}>{orderTakerStats.tasksCompleted}</div>}
                <div className={styles.statLabel}>Completed</div>
              </div>
            </Link>
          </div>
        </div>
      </Layout>
    );
  }

  if (!isAdmin) {
    return (
      <Layout>
        <div className={styles.dashboard}>
          <h1 className={styles.title}>Welcome, {user?.username}!</h1>
          <p style={{ color: 'var(--text-secondary, #666)', marginTop: '1rem' }}>
            More role-specific tools will appear here as they are added.
          </p>
        </div>
      </Layout>
    );
  }

  if (!stats) {
    return (
      <Layout>
        <div>Failed to load dashboard data</div>
      </Layout>
    );
  }

  const mapMarkers = stats.completedTasksForMap.flatMap((task) => {
    const markers = [];
    if (task.clientLocation) {
      markers.push({
        lat: task.clientLocation.latitude,
        lng: task.clientLocation.longitude,
        type: 'client' as const,
        label: task.clientLocation.name,
      });
    }
    if (task.completionLocation) {
      markers.push({
        lat: task.completionLocation.latitude,
        lng: task.completionLocation.longitude,
        type: 'completion' as const,
        label: `${task.taskName} - ${task.employeeName}`,
      });
    }
    return markers;
  });

  const getActivityIcon = (activity: RecentActivityEntry) => {
    const p = { size: ACTIVITY_ICON_SIZE, weight: 'regular' as const, 'aria-hidden': true as const };
    if (activity.action === 'started_task') return <Play {...p} />;
    if (activity.action === 'completed_task') return <CheckCircle {...p} />;
    if (activity.action === 'deleted') return <Trash {...p} />;
    if (activity.action === 'status_changed') return <ArrowsClockwise {...p} />;
    if (activity.action === 'updated') return <PencilSimple {...p} />;
    return <Plus {...p} />;
  };

  const getActivityText = (activity: RecentActivityEntry) => {
    const actor = activity.employeeId?.username || 'System';
    const actionText = activity.action.replace(/_/g, ' ');
    const moduleText = activity.module ? activity.module.replace(/_/g, ' ') : 'item';
    const taskName = activity.taskId?.taskName;
    const entityShort = activity.entityId ? activity.entityId.slice(-6).toUpperCase() : '';
    if (taskName) {
      return `${actor} ${actionText} ${taskName}`;
    }
    return `${actor} ${actionText} ${moduleText}${entityShort ? ` (${entityShort})` : ''}`;
  };

  return (
    <Layout>
      <div className={styles.dashboard}>
        <h1 className={styles.title}>Dashboard</h1>

        <div className={styles.statsGrid}>
          <Link href="/employees" className={styles.statCard}>
            <StatCardIcon Icon={Users} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.activeEmployees}</div>
              <div className={styles.statLabel}>Active Employees</div>
              {stats.stats.inactiveEmployees > 0 && (
                <div className={styles.statSub}>{stats.stats.inactiveEmployees} inactive</div>
              )}
            </div>
          </Link>

          <Link href="/clients" className={styles.statCard}>
            <StatCardIcon Icon={Storefront} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.totalClients}</div>
              <div className={styles.statLabel}>Total Clients</div>
            </div>
          </Link>

          <Link href="/products" className={styles.statCard}>
            <StatCardIcon Icon={Package} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.totalProducts}</div>
              <div className={styles.statLabel}>Total Products</div>
            </div>
          </Link>

          <Link href="/categories" className={styles.statCard}>
            <StatCardIcon Icon={Folders} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.totalCategories}</div>
              <div className={styles.statLabel}>Total Categories</div>
            </div>
          </Link>

          <Link href="/orders" className={styles.statCard}>
            <StatCardIcon Icon={ShoppingCart} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.totalOrders}</div>
              <div className={styles.statLabel}>Total Orders</div>
            </div>
          </Link>

          <Link href="/orders" className={styles.statCard}>
            <StatCardIcon Icon={Hourglass} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.totalPendingOrders}</div>
              <div className={styles.statLabel}>Pending Orders</div>
            </div>
          </Link>

          <Link href="/routes" className={styles.statCard}>
            <StatCardIcon Icon={MapTrifold} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.totalRoutes}</div>
              <div className={styles.statLabel}>Total Routes</div>
            </div>
          </Link>

          <Link href="/tasks" className={styles.statCard}>
            <StatCardIcon Icon={ClipboardText} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.totalTasks}</div>
              <div className={styles.statLabel}>Total Tasks</div>
            </div>
          </Link>

          <Link href="/tasks" className={styles.statCard}>
            <StatCardIcon Icon={CheckCircle} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>
                {stats.stats.tasksCompletedToday}
              </div>
              <div className={styles.statLabel}>Completed Today</div>
            </div>
          </Link>

          <Link href="/tasks" className={styles.statCard}>
            <StatCardIcon Icon={ArrowsClockwise} />
            <div className={styles.statContent}>
              <div className={styles.statValue}>{stats.stats.tasksInProgress}</div>
              <div className={styles.statLabel}>Tasks In Progress</div>
            </div>
          </Link>
        </div>

        <div className={styles.section}>
          <div className={styles.reportHeader}>
            <h2 className={styles.sectionTitle}>Sales & Stock Highlights</h2>
            <Link href="/reports" className={styles.reportsLink}>Open Full Reports</Link>
          </div>
          <div className={styles.reportFilters}>
            <DatePickerFilter value={startDate} onChange={setStartDate} placeholder="Start date" />
            <DatePickerFilter value={endDate} onChange={setEndDate} placeholder="End date" />
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as 'day' | 'month' | 'year')}
              className={styles.reportSelect}
            >
              <option value="day">Daily</option>
              <option value="month">Monthly</option>
              <option value="year">Yearly</option>
            </select>
          </div>

          {reportLoading || !reports ? (
            <Loader />
          ) : (
            <>
              <div className={styles.kpiGrid}>
                <div className={styles.kpiCard}>
                  <span>Current Stock</span>
                  <strong>{reports.kpis.totalCurrentStock}</strong>
                </div>
                <div className={styles.kpiCard}>
                  <span>Stock Hold</span>
                  <strong>{reports.kpis.totalHoldStock}</strong>
                </div>
                <div className={styles.kpiCard}>
                  <span>Returned Qty</span>
                  <strong>{reports.kpis.totalReturnedQty}</strong>
                </div>
                <div className={styles.kpiCard}>
                  <span>Damaged Qty</span>
                  <strong>{reports.kpis.totalDamagedQty}</strong>
                </div>
                <div className={styles.kpiCard}>
                  <span>Sold Qty</span>
                  <strong>{reports.kpis.totalSoldQty}</strong>
                </div>
                <div className={styles.kpiCard}>
                  <span>Earned (Delivered Sales)</span>
                  <strong>{reports.kpis.salesInRange.toFixed(2)}</strong>
                </div>
                <div className={styles.kpiCard}>
                  <span>Paid Back (Returns)</span>
                  <strong>{reports.kpis.totalReturnPayout.toFixed(2)}</strong>
                </div>
                <div className={styles.kpiCard}>
                  <span>Net After Returns</span>
                  <strong>{reports.kpis.netAfterReturns.toFixed(2)}</strong>
                </div>
                <div className={styles.kpiCard}>
                  <span>Booked Sales (Open Orders)</span>
                  <strong>{reports.kpis.bookedSalesInRange.toFixed(2)}</strong>
                </div>
              </div>

              <div className={styles.trendChartBlock}>
                <h3 className={styles.trendChartTitle}>Quantity Trend (Sold / Returned / Damaged)</h3>
                <div className={styles.trendChartWrap}>
                  <LineTrendChart
                    labels={trendData.labels}
                    datasets={[
                      { label: 'Sold Qty', values: trendData.qtySeries.sold },
                      { label: 'Returned Qty', values: trendData.qtySeries.returned, borderColor: '#16a34a' },
                      { label: 'Damaged Qty', values: trendData.qtySeries.damaged, borderColor: '#dc2626' },
                    ]}
                    height={400}
                    emptyText="No quantity trend data in selected range"
                  />
                </div>
              </div>

              <div className={styles.trendChartBlock}>
                <h3 className={styles.trendChartTitle}>Amount Trend (Earned / Paid Back / Booked / Net)</h3>
                <div className={styles.trendChartWrap}>
                  <LineTrendChart
                    labels={trendData.labels}
                    datasets={[
                      { label: 'Earned', values: trendData.amountSeries.earned },
                      { label: 'Paid Back', values: trendData.amountSeries.paidBack, borderColor: '#dc2626' },
                      { label: 'Booked', values: trendData.amountSeries.booked, borderColor: '#7c3aed' },
                      { label: 'Net', values: trendData.amountSeries.net, borderColor: '#16a34a' },
                    ]}
                    height={400}
                    emptyText="No amount trend data in selected range"
                  />
                </div>
              </div>
            </>
          )}
        </div>

        <div className={styles.contentGrid}>
          <div className={`${styles.section} ${styles.recentActivitySection}`}>
            <h2 className={styles.sectionTitle}>Recent Activity</h2>
            <div className={styles.activityList}>
              {stats.recentActivity.length === 0 ? (
                <div className={styles.emptyState}>No recent activity</div>
              ) : (
                stats.recentActivity.map((activity: any) => (
                  <div key={activity._id} className={styles.activityItem}>
                    <div className={styles.activityIcon}>
                      {getActivityIcon(activity)}
                    </div>
                    <div className={styles.activityContent}>
                      <div className={styles.activityText}>
                        {getActivityText(activity)}
                      </div>
                      <div className={styles.activityTime}>
                        {format(new Date(activity.timestamp), 'MMM dd, yyyy hh:mm a')}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          <div className={styles.section}>
            <h2 className={styles.sectionTitle}>Completed Tasks Map</h2>
            {mapMarkers.length > 0 ? (
              <MapView markers={mapMarkers} height="400px" />
            ) : (
              <div className={styles.emptyState}>
                No completed tasks with location data
              </div>
            )}
          </div>
        </div>
      </div>
    </Layout>
  );
};

export default function DashboardPage() {
  return (
    <ProtectedRoute allowedRoles={ALL_ROLES}>
      <Dashboard />
    </ProtectedRoute>
  );
}
