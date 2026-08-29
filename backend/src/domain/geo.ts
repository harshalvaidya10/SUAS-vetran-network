import type { GeoPoint } from '../types.js';

const EARTH_RADIUS_KM = 6371;

const toRadians = (degrees: number) => (degrees * Math.PI) / 180;

export function isValidGeoPoint(point: GeoPoint | null | undefined): point is GeoPoint {
  return Boolean(
    point &&
      Number.isFinite(point.lat) &&
      Number.isFinite(point.lng) &&
      point.lat >= -90 &&
      point.lat <= 90 &&
      point.lng >= -180 &&
      point.lng <= 180,
  );
}

/** Great-circle distance in km. Good enough for matching inside a metro area. */
export function distanceKm(a: GeoPoint, b: GeoPoint): number {
  if (!isValidGeoPoint(a) || !isValidGeoPoint(b)) return Number.NaN;
  const dLat = toRadians(b.lat - a.lat);
  const dLng = toRadians(b.lng - a.lng);
  const lat1 = toRadians(a.lat);
  const lat2 = toRadians(b.lat);

  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}
