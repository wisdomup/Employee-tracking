import React, { useCallback, useState } from 'react';
import { MapTrifold } from '@phosphor-icons/react';
import { toast } from 'react-toastify';
import { buildGoogleMapsDirectionsUrl, type LatLng } from '../../utils/googleMapsNavigation';

interface NavigateButtonProps {
  /** Where to navigate to. Null/undefined coordinates disable the button. */
  destination?: LatLng | null;
  /** Button text. Defaults to "Navigate". */
  label?: string;
  /** Tooltip; falls back to a generic description of where it goes. */
  title?: string;
  /** Shown as an error toast when no coordinates are available. */
  missingCoordsMessage?: string;
  /** Optional intermediate stops (max 8, reordered nearest-first by the URL builder). */
  waypoints?: LatLng[];
  /** 'button' renders the full teal button; 'link' renders a compact inline link. */
  variant?: 'button' | 'link';
  className?: string;
}

/**
 * Opens Google Maps driving directions to a point, using the device's current location
 * as the origin when the browser allows it.
 *
 * Geolocation is best-effort: if it is unavailable, denied, or times out we still open
 * Maps without an origin, and Maps falls back to the device's own location. Failing to
 * get a fix should never block navigation.
 */
const NavigateButton: React.FC<NavigateButtonProps> = ({
  destination,
  label = 'Navigate',
  title,
  missingCoordsMessage = 'No map coordinates on file for this location.',
  waypoints,
  variant = 'button',
  className,
}) => {
  const [navigating, setNavigating] = useState(false);

  const hasCoords =
    destination != null &&
    Number.isFinite(destination.lat) &&
    Number.isFinite(destination.lng);

  const openNavigation = useCallback(() => {
    if (!hasCoords || !destination) {
      toast.error(missingCoordsMessage);
      return;
    }
    setNavigating(true);

    const finish = (origin: LatLng | null) => {
      const url = buildGoogleMapsDirectionsUrl({ origin, destination, waypoints });
      window.open(url, '_blank', 'noopener,noreferrer');
      setNavigating(false);
    };

    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      finish(null);
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => finish({ lat: position.coords.latitude, lng: position.coords.longitude }),
      // Denied or timed out — still navigate, just without an explicit origin.
      () => finish(null),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 30000 },
    );
  }, [hasCoords, destination, waypoints, missingCoordsMessage]);

  if (!hasCoords) return null;

  if (variant === 'link') {
    return (
      <button
        type="button"
        onClick={openNavigation}
        disabled={navigating}
        title={title ?? 'Open driving directions in Google Maps'}
        className={className}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: '0.25rem',
          background: 'none',
          border: 'none',
          padding: 0,
          color: '#0f766e',
          fontSize: '0.8125rem',
          fontWeight: 600,
          cursor: navigating ? 'wait' : 'pointer',
          textDecoration: 'underline',
        }}
      >
        <MapTrifold size={14} weight="bold" aria-hidden />
        {navigating ? 'Locating…' : label}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={openNavigation}
      disabled={navigating}
      title={title ?? 'Open driving directions in Google Maps'}
      className={className}
    >
      <MapTrifold size={20} weight="bold" aria-hidden />
      {navigating ? 'Locating…' : label}
    </button>
  );
};

export default NavigateButton;
