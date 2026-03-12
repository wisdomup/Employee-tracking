import React, { useEffect, useRef } from 'react';
import 'leaflet/dist/leaflet.css';
import styles from './MapView.module.scss';

interface Marker {
  lat: number;
  lng: number;
  type: 'dealer' | 'completion';
  label?: string;
}

interface MapViewProps {
  markers: Marker[];
  height?: string;
}

const MapView: React.FC<MapViewProps> = ({ markers, height = '400px' }) => {
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

    // Clear existing markers
    map.eachLayer((layer: any) => {
      if (layer instanceof L.Marker) {
        map.removeLayer(layer);
      }
    });

    if (markers.length === 0) return;

    // Create custom icons
    const dealerIcon = L.divIcon({
      className: 'custom-marker dealer-marker',
      html: '<div style="background-color: #3b82f6; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">D</div>',
      iconSize: [30, 30],
    });

    const completionIcon = L.divIcon({
      className: 'custom-marker completion-marker',
      html: '<div style="background-color: #10b981; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; color: white; font-weight: bold;">C</div>',
      iconSize: [30, 30],
    });

    // Add markers
    markers.forEach((marker) => {
      const icon = marker.type === 'dealer' ? dealerIcon : completionIcon;
      const markerInstance = L.marker([marker.lat, marker.lng], { icon }).addTo(
        map
      );

      if (marker.label) {
        markerInstance.bindPopup(marker.label);
      }
    });

    // Fit bounds to show all markers
    if (markers.length > 0) {
      const bounds = L.latLngBounds(
        markers.map((m) => [m.lat, m.lng])
      );
      map.fitBounds(bounds, { padding: [50, 50] });
    }
  }, [markers]);

  return <div ref={mapRef} className={styles.mapContainer} style={{ height }} />;
};

export default MapView;
