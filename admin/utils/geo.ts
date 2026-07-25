/** Great-circle distance between two lat/lng points, in kilometers. */
export function haversineDistanceKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/**
 * Greedy nearest-neighbor stop order starting from `origin`. Items without
 * resolvable coordinates are appended at the end, in original order, with
 * distanceKm = NaN (no leg distance to previous stop).
 */
export function nearestNeighborOrder<T>(
  origin: GeoPoint,
  items: T[],
  getCoords: (item: T) => GeoPoint | null,
): { item: T; distanceKm: number }[] {
  const withCoords: { item: T; coords: GeoPoint }[] = [];
  const withoutCoords: T[] = [];
  for (const item of items) {
    const coords = getCoords(item);
    if (coords) withCoords.push({ item, coords });
    else withoutCoords.push(item);
  }

  const remaining = [...withCoords];
  const ordered: { item: T; distanceKm: number }[] = [];
  let cur = origin;

  while (remaining.length) {
    let bestIndex = 0;
    let bestDist = Infinity;
    remaining.forEach((entry, i) => {
      const d = haversineDistanceKm(cur.latitude, cur.longitude, entry.coords.latitude, entry.coords.longitude);
      if (d < bestDist) {
        bestDist = d;
        bestIndex = i;
      }
    });
    const [next] = remaining.splice(bestIndex, 1);
    ordered.push({ item: next.item, distanceKm: bestDist });
    cur = next.coords;
  }

  return [...ordered, ...withoutCoords.map((item) => ({ item, distanceKm: NaN }))];
}

/**
 * Road-following path through an ordered list of points, via the public OSRM
 * demo routing server. Returns null (caller should fall back to straight
 * lines between points) if the request fails or no route is found.
 */
export async function fetchRoadRoute(points: GeoPoint[]): Promise<GeoPoint[] | null> {
  if (points.length < 2) return null;
  const coords = points.map((p) => `${p.longitude},${p.latitude}`).join(';');
  try {
    const res = await fetch(
      `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`,
    );
    if (!res.ok) return null;
    const data = await res.json();
    const line = data?.routes?.[0]?.geometry?.coordinates;
    if (!Array.isArray(line) || line.length < 2) return null;
    return line.map(([lng, lat]: [number, number]) => ({ latitude: lat, longitude: lng }));
  } catch {
    return null;
  }
}
