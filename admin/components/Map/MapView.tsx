import React, { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import styles from './MapView.module.scss';

export type MapPinIcon = 'blue' | 'gold' | 'green' | 'red' | 'grey';

const PIN_ICON_BASE =
  'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img';

const PIN_ICON_URL: Record<MapPinIcon, string> = {
  blue: `${PIN_ICON_BASE}/marker-icon-blue.png`,
  gold: `${PIN_ICON_BASE}/marker-icon-gold.png`,
  green: `${PIN_ICON_BASE}/marker-icon-green.png`,
  red: `${PIN_ICON_BASE}/marker-icon-red.png`,
  grey: `${PIN_ICON_BASE}/marker-icon-grey.png`,
};

export interface Marker {
  lat: number;
  lng: number;
  type: 'client' | 'completion' | 'current';
  label?: string;
  pinLabel?: string;
  /** When set, overrides icon implied by `type` (backward compatible when omitted). */
  pinIcon?: MapPinIcon;
  /** Renders pin badge text with line-through (labels must be app-controlled, not user HTML). */
  pinLabelStrikethrough?: boolean;
}

interface PolylinePath {
  points: [number, number][];
  color?: string;
  weight?: number;
  opacity?: number;
  label?: string;
}

interface MapViewProps {
  markers: Marker[];
  polylines?: PolylinePath[];
  height?: string;
}

const MapView: React.FC<MapViewProps> = ({ markers, polylines = [], height = '400px' }) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const L = require('leaflet');

    // Fix default marker icon issue with Next.js
    delete (L.Icon.Default.prototype as any)._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: '/images/marker-icon-2x.png',
      iconUrl: '/images/marker-icon.png',
      shadowUrl: '/images/marker-shadow.png',
    });

    if (mapRef.current && !mapInstanceRef.current) {
      const map = L.map(mapRef.current).setView([0, 0], 2);

      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);

      mapInstanceRef.current = map;
    }

    return () => {
      if (mapInstanceRef.current) {
        mapInstanceRef.current.remove();
        mapInstanceRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!mapInstanceRef.current) return;

    const L = require('leaflet');
    const map = mapInstanceRef.current;

    // Clear existing markers and polylines
    map.eachLayer((layer: any) => {
      if (layer instanceof L.Marker || layer instanceof L.Polyline) {
        map.removeLayer(layer);
      }
    });

    if (markers.length === 0 && polylines.length === 0) return;

    const resolveIconUrl = (m: Marker): string => {
      if (m.pinIcon) return PIN_ICON_URL[m.pinIcon];
      if (m.type === 'client') return PIN_ICON_URL.blue;
      if (m.type === 'completion') return PIN_ICON_URL.green;
      return PIN_ICON_URL.red;
    };

    // Use actual pin-style marker icons (not circle badges)
    const buildPinIcon = (
      iconUrl: string,
      pinLabel?: string,
      pinLabelStrikethrough?: boolean,
    ) => {
      const labelInner =
        pinLabel && pinLabelStrikethrough
          ? `<span style="text-decoration:line-through">${pinLabel}</span>`
          : pinLabel ?? '';
      return L.divIcon({
        className: 'custom-marker',
        html: `
          <div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-6px);">
            <img src="${iconUrl}" style="width:15px;height:25px;" />
            ${labelInner ? `<div style="margin-top:2px;padding:1px 6px;border-radius:10px;background:var(--admin-primary);color:#fff;font-size:10px;line-height:14px;">${labelInner}</div>` : ''}
          </div>
        `,
        iconSize: [25, 35],
        iconAnchor: [16, 30],
        popupAnchor: [0, -34],
      });
    };

    // Add markers
    markers.forEach((marker) => {
      const icon = buildPinIcon(
        resolveIconUrl(marker),
        marker.pinLabel,
        marker.pinLabelStrikethrough,
      );
      const markerInstance = L.marker([marker.lat, marker.lng], { icon }).addTo(
        map
      );

      if (marker.label) {
        markerInstance.bindPopup(marker.label);
      }
    });

    // Add path overlays
    polylines.forEach((path) => {
      if (!path.points || path.points.length < 2) return;
      const line = L.polyline(path.points, {
        color: path.color || '#111827',
        weight: path.weight ?? 4,
        opacity: path.opacity ?? 0.85,
      }).addTo(map);
      if (path.label) {
        line.bindPopup(path.label);
      }
    });

    // Fit bounds to show all markers
    const allPoints: [number, number][] = [
      ...markers.map((m) => [m.lat, m.lng] as [number, number]),
      ...polylines.flatMap((p) => p.points || []),
    ];
    if (allPoints.length > 0) {
      const bounds = L.latLngBounds(allPoints);
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [markers, polylines]);

  return <div ref={mapRef} className={styles.mapContainer} style={{ height }} />;
};

export default MapView;
