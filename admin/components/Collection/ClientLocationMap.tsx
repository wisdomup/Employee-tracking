import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import MapView, { Marker } from '../Map/MapView';
import { haversineDistanceKm } from '../../utils/geo';
import { RiderOrderGroup } from '../../services/collectionService';

/**
 * Spec §2 — the client's location in an IN-APP embedded map, not an external Google Maps
 * redirect.
 *
 * Uses `MapView` imported DIRECTLY, not through `next/dynamic`. MapView is the imperative-Leaflet
 * variant: its only `leaflet` access is a `require()` inside a `useEffect` guarded on `window`,
 * so it is already SSR-safe and `pages/dashboard.tsx` imports it statically today.
 * `dynamic(..., { ssr: false })` is mandatory only for `VisitsRouteMap`, which imports
 * react-leaflet at module top level. A single-marker view does not justify a second map stack.
 *
 * `showNavigate` stays on: §2 requires the map to be embedded, not that turn-by-turn is
 * forbidden. The Navigate link inside the popup is an explicit second tap.
 */

interface Props {
  dealer: RiderOrderGroup['dealer'];
  height?: string;
}

const ClientLocationMap: React.FC<Props> = ({ dealer, height = '52vh' }) => {
  const [current, setCurrent] = useState<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (p) => setCurrent({ lat: p.coords.latitude, lng: p.coords.longitude }),
      // Silent: a denied or unavailable location must never block a delivery.
      () => undefined,
      { enableHighAccuracy: true, timeout: 10_000 },
    );
  }, []);

  const markers = useMemo<Marker[]>(() => {
    const out: Marker[] = [];
    if (dealer.latitude != null && dealer.longitude != null) {
      out.push({
        lat: dealer.latitude,
        lng: dealer.longitude,
        type: 'client',
        label: dealer.shopName || dealer.name,
        pinIcon: 'blue',
      });
    }
    if (current) {
      out.push({ lat: current.lat, lng: current.lng, type: 'current', label: 'You', pinIcon: 'red' });
    }
    return out;
  }, [dealer, current]);

  const distanceKm =
    current && dealer.latitude != null && dealer.longitude != null
      ? haversineDistanceKm(current.lat, current.lng, dealer.latitude, dealer.longitude)
      : null;

  if (!dealer.hasLocation) {
    return (
      <div
        style={{
          padding: '1.5rem',
          borderRadius: 12,
          border: '1px dashed #d1d5db',
          background: '#f9fafb',
          textAlign: 'center',
        }}
      >
        <p style={{ margin: 0, fontWeight: 600, color: '#374151' }}>No location saved for this client</p>
        <p style={{ margin: '0.5rem 0 1rem', fontSize: '0.875rem', color: '#6b7280' }}>
          You can still deliver the order. If you are standing at the shop, save the pin now so the
          next delivery is easier.
        </p>
        <Link
          href={`/clients/${dealer._id}`}
          style={{
            display: 'inline-block',
            padding: '0.5rem 1rem',
            borderRadius: 8,
            background: 'var(--admin-primary, #2563eb)',
            color: '#fff',
            fontWeight: 600,
            fontSize: '0.875rem',
            textDecoration: 'none',
          }}
        >
          Set shop location
        </Link>
      </div>
    );
  }

  return (
    <div>
      {distanceKm != null && (
        <p style={{ margin: '0 0 0.5rem', fontSize: '0.875rem', color: '#6b7280' }}>
          About <strong style={{ color: '#111827' }}>{distanceKm.toFixed(1)} km</strong> from you
        </p>
      )}
      <MapView markers={markers} height={height} showNavigate />
    </div>
  );
};

export default ClientLocationMap;
