/**
 * Build Google Maps directions URLs (opens in Maps app / browser).
 * @see https://developers.google.com/maps/documentation/urls/get-started
 */

const MAX_WAYPOINTS = 8;

function geoDistanceKm(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const aa =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(aa), Math.sqrt(1 - aa));
  return R * c;
}

/** Order intermediate stops by nearest-neighbor from a starting point. */
export function orderWaypointsNearestNeighbor(
  start: { lat: number; lng: number },
  points: { lat: number; lng: number }[],
): { lat: number; lng: number }[] {
  if (points.length <= 1) return [...points];
  const remaining = [...points];
  const result: { lat: number; lng: number }[] = [];
  let current = { lat: start.lat, lng: start.lng };

  while (remaining.length > 0) {
    let bestIdx = 0;
    let bestDist = Number.POSITIVE_INFINITY;
    for (let i = 0; i < remaining.length; i += 1) {
      const p = remaining[i];
      const d = geoDistanceKm(current.lat, current.lng, p.lat, p.lng);
      if (d < bestDist) {
        bestDist = d;
        bestIdx = i;
      }
    }
    const [next] = remaining.splice(bestIdx, 1);
    result.push(next);
    current = { lat: next.lat, lng: next.lng };
  }
  return result;
}

export type LatLng = { lat: number; lng: number };

/**
 * Driving directions: optional explicit origin (otherwise Maps uses device location),
 * ordered intermediate waypoints (max 8), final destination.
 */
export function buildGoogleMapsDirectionsUrl(options: {
  origin?: LatLng | null;
  destination: LatLng;
  /** Stops before the final destination (e.g. other dealers); excludes destination. */
  waypoints?: LatLng[];
}): string {
  const destStr = `${options.destination.lat},${options.destination.lng}`;
  let wp = options.waypoints ?? [];
  if (options.origin && wp.length > 0) {
    wp = orderWaypointsNearestNeighbor(options.origin, wp);
  }
  wp = wp.slice(0, MAX_WAYPOINTS);

  const params = new URLSearchParams();
  params.set('api', '1');
  params.set('travelmode', 'driving');
  if (options.origin) {
    params.set('origin', `${options.origin.lat},${options.origin.lng}`);
  }
  params.set('destination', destStr);
  if (wp.length > 0) {
    params.set('waypoints', wp.map((w) => `${w.lat},${w.lng}`).join('|'));
  }

  return `https://www.google.com/maps/dir/?${params.toString()}`;
}
