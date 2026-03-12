import React, { useEffect, useRef, useState } from 'react';
import 'leaflet/dist/leaflet.css';
import styles from './MapPicker.module.scss';

const DEFAULT_CENTER: [number, number] = [31.52, 74.35];
const DEFAULT_ZOOM = 10;
const PICKED_ZOOM = 15;

function isValidLocation(lat: number | undefined, lng: number | undefined): boolean {
  if (lat == null || lng == null) return false;
  if (lat === 0 && lng === 0) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

interface MapPickerProps {
  latitude?: number;
  longitude?: number;
  onLocationSelect: (lat: number, lng: number) => void;
  height?: string;
}

const MapPicker: React.FC<MapPickerProps> = ({
  latitude,
  longitude,
  onLocationSelect,
  height = '300px',
}) => {
  const mapRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<unknown>(null);
  const markerRef = useRef<unknown>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !mounted) return;

    const L = require('leaflet') as typeof import('leaflet');

    delete (L.Icon.Default.prototype as unknown as { _getIconUrl?: unknown })._getIconUrl;
    L.Icon.Default.mergeOptions({
      iconRetinaUrl: '/images/marker-icon-2x.png',
      iconUrl: '/images/marker-icon.png',
      shadowUrl: '/images/marker-shadow.png',
    });

    if (!mapRef.current || mapInstanceRef.current) return;

    const hasInitial = isValidLocation(latitude, longitude);
    const [initLat, initLng] = hasInitial
      ? [latitude!, longitude!]
      : DEFAULT_CENTER;
    const initZoom = hasInitial ? PICKED_ZOOM : DEFAULT_ZOOM;

    const map = L.map(mapRef.current).setView([initLat, initLng], initZoom);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    const dealerIcon = L.divIcon({
      className: 'custom-marker dealer-marker',
      html: '<div style="background-color: #3b82f6; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">D</div>',
      iconSize: [30, 30],
    });

    if (hasInitial) {
      const marker = L.marker([latitude!, longitude!], { icon: dealerIcon }).addTo(map);
      markerRef.current = marker;
    }

    const handleClick = (e: { latlng: { lat: number; lng: number } }) => {
      const { lat, lng } = e.latlng;
      if (markerRef.current) {
        map.removeLayer(markerRef.current as Parameters<typeof map.removeLayer>[0]);
        markerRef.current = null;
      }
      const marker = L.marker([lat, lng], { icon: dealerIcon }).addTo(map);
      markerRef.current = marker;
      map.setView([lat, lng], PICKED_ZOOM);
      onLocationSelect(lat, lng);
    };

    map.on('click', handleClick);
    mapInstanceRef.current = map;

    return () => {
      map.off('click', handleClick);
      if (markerRef.current) {
        map.removeLayer(markerRef.current as L.Layer);
        markerRef.current = null;
      }
      map.remove();
      mapInstanceRef.current = null;
    };
  }, [mounted]);

  useEffect(() => {
    if (typeof window === 'undefined' || !mapInstanceRef.current || !mounted) return;

    const L = require('leaflet') as typeof import('leaflet');
    const map = mapInstanceRef.current as import('leaflet').Map;

    if (markerRef.current) {
      map.removeLayer(markerRef.current as import('leaflet').Layer);
      markerRef.current = null;
    }

    if (isValidLocation(latitude, longitude)) {
      const dealerIcon = L.divIcon({
        className: 'custom-marker dealer-marker',
        html: '<div style="background-color: #3b82f6; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">D</div>',
        iconSize: [30, 30],
      });
      const marker = L.marker([latitude!, longitude!], { icon: dealerIcon }).addTo(map);
      markerRef.current = marker;
      map.setView([latitude!, longitude!], PICKED_ZOOM);
    }
  }, [latitude, longitude, mounted]);

  if (!mounted) {
    return (
      <div className={styles.mapContainer} style={{ height, background: '#f3f4f6' }}>
        <div style={{ padding: '1rem', color: '#6b7280', fontSize: '0.875rem' }}>
          Loading map...
        </div>
      </div>
    );
  }

  const hasLocation = isValidLocation(latitude, longitude);

  return (
    <div>
      <p className={styles.hint} role="status">
        Map to pick dealer location. Click on the map to set dealer location.
      </p>
      <div ref={mapRef} className={styles.mapContainer} style={{ height }} />
      {hasLocation && (
        <p className={styles.coords}>
          Selected: {latitude!.toFixed(6)}, {longitude!.toFixed(6)}
        </p>
      )}
    </div>
  );
};

export default MapPicker;
