import React, { useEffect, useMemo, useState } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { GeoPoint, fetchRoadRoute } from '../../utils/geo';
import { Visit } from '../../services/visitService';
import styles from '../../styles/VisitsCalendar.module.scss';

interface VisitsRouteMapProps {
  origin: GeoPoint | null;
  stops: { visit: Visit; distanceKm: number }[];
}

function numberedIcon(label: string, variant: 'origin' | 'stop') {
  return L.divIcon({
    className: styles.mapMarkerWrap,
    html: `<div class="${variant === 'origin' ? styles.mapMarkerOrigin : styles.mapMarkerStop}">${label}</div>`,
    iconSize: [30, 30],
    iconAnchor: [15, 15],
  });
}

function FitBounds({ points }: { points: GeoPoint[] }) {
  const map = useMap();
  useEffect(() => {
    if (points.length === 0) return;
    if (points.length === 1) {
      map.setView([points[0].latitude, points[0].longitude], 14);
      return;
    }
    const bounds = L.latLngBounds(points.map((p) => [p.latitude, p.longitude] as [number, number]));
    map.fitBounds(bounds, { padding: [40, 40] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(points)]);
  return null;
}

const VisitsRouteMap: React.FC<VisitsRouteMapProps> = ({ origin, stops }) => {
  const [roadRoute, setRoadRoute] = useState<GeoPoint[] | null>(null);
  const [roadRouteFailed, setRoadRouteFailed] = useState(false);

  const stopPoints = useMemo(
    () =>
      stops
        .map(({ visit }) =>
          visit.dealerId?.latitude != null && visit.dealerId?.longitude != null
            ? { latitude: visit.dealerId.latitude, longitude: visit.dealerId.longitude }
            : null,
        )
        .filter((p): p is GeoPoint => p != null),
    [stops],
  );

  const allPoints = useMemo(() => (origin ? [origin, ...stopPoints] : stopPoints), [origin, stopPoints]);

  useEffect(() => {
    let cancelled = false;
    setRoadRoute(null);
    setRoadRouteFailed(false);
    if (allPoints.length < 2) return;
    fetchRoadRoute(allPoints).then((route) => {
      if (cancelled) return;
      if (route) setRoadRoute(route);
      else setRoadRouteFailed(true);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(allPoints)]);

  if (allPoints.length === 0) {
    return <p className={styles.emptyHint}>No visit locations to show on the map yet.</p>;
  }

  const center: [number, number] = [allPoints[0].latitude, allPoints[0].longitude];
  const lineLatLngs = (roadRoute ?? allPoints).map((p) => [p.latitude, p.longitude] as [number, number]);

  return (
    <div className={styles.mapWrap}>
      <MapContainer center={center} zoom={13} scrollWheelZoom className={styles.mapContainer}>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <FitBounds points={allPoints} />
        {allPoints.length > 1 && (
          <Polyline
            positions={lineLatLngs}
            pathOptions={{ color: '#111827', weight: 4, opacity: 0.75, dashArray: roadRoute ? undefined : '6 8' }}
          />
        )}
        {origin && (
          <Marker position={[origin.latitude, origin.longitude]} icon={numberedIcon('You', 'origin')}>
            <Popup>Your current location</Popup>
          </Marker>
        )}
        {stops.map(({ visit, distanceKm }, index) => {
          const lat = visit.dealerId?.latitude;
          const lng = visit.dealerId?.longitude;
          if (lat == null || lng == null) return null;
          return (
            <Marker key={visit._id} position={[lat, lng]} icon={numberedIcon(String(index + 1), 'stop')}>
              <Popup>
                <strong>{visit.dealerId?.name || visit.dealerId?.shopName || 'Client'}</strong>
                {Number.isFinite(distanceKm) && (
                  <>
                    <br />
                    {distanceKm.toFixed(1)} km from previous stop
                  </>
                )}
              </Popup>
            </Marker>
          );
        })}
      </MapContainer>
      {roadRouteFailed && (
        <p className={styles.routeHintWarn} style={{ marginTop: '0.5rem' }}>
          Couldn&apos;t load road directions — showing a straight-line estimate instead.
        </p>
      )}
    </div>
  );
};

export default VisitsRouteMap;
