import React, { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import styles from './MapView.module.scss';

interface Marker {
  lat: number;
  lng: number;
  type: 'client' | 'completion' | 'current';
  label?: string;
  pinLabel?: string;
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

    // Use actual pin-style marker icons (not circle badges)
    const buildPinIcon = (iconUrl: string, pinLabel?: string) =>
      L.divIcon({
        className: 'custom-marker',
        html: `
          <div style="display:flex;flex-direction:column;align-items:center;transform:translateY(-6px);">
            <img src="${iconUrl}" style="width:15px;height:25px;" />
            ${pinLabel ? `<div style="margin-top:2px;padding:1px 6px;border-radius:10px;background:#111827;color:#fff;font-size:10px;line-height:14px;">${pinLabel}</div>` : ''}
          </div>
        `,
        iconSize: [25, 35],
        iconAnchor: [16, 30],
        popupAnchor: [0, -34],
      });

    // Add markers
    markers.forEach((marker) => {
      const icon = buildPinIcon(
        marker.type === 'client'
          ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-blue.png'
          : marker.type === 'completion'
            ? 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-green.png'
            : 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-red.png',
        marker.pinLabel,
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
        color: path.color || '#f59e0b',
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
