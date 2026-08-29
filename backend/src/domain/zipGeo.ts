import type { GeoPoint } from '../types.js';
import { distanceKm, isValidGeoPoint } from './geo.js';

/**
 * Small, deliberately local centroid table for the San Diego hackathon demo.
 * ZIPs are geographic identifiers, never numbers to subtract from one another.
 */
const ZIP_CENTROIDS: Readonly<Record<string, GeoPoint>> = {
  '92020': { lat: 32.7955, lng: -116.9625 }, // El Cajon
  '92037': { lat: 32.8444, lng: -117.2521 }, // La Jolla
  '92054': { lat: 33.1959, lng: -117.3795 }, // Oceanside
  '92101': { lat: 32.7190, lng: -117.1628 }, // Downtown
  '92102': { lat: 32.7139, lng: -117.1174 },
  '92103': { lat: 32.7473, lng: -117.1662 }, // Hillcrest
  '92104': { lat: 32.7415, lng: -117.1277 }, // North Park
  '92105': { lat: 32.7378, lng: -117.0927 },
  '92106': { lat: 32.7262, lng: -117.2291 }, // Point Loma
  '92110': { lat: 32.7657, lng: -117.2005 },
  '92111': { lat: 32.8068, lng: -117.1687 },
  '92117': { lat: 32.8246, lng: -117.2028 },
  '92123': { lat: 32.8068, lng: -117.1340 },
  '92126': { lat: 32.9156, lng: -117.1439 },
  '92130': { lat: 32.9534, lng: -117.2323 },
};

export function normalizeZipCode(zipCode: string): string {
  return zipCode.trim().slice(0, 5);
}

export function getZipCoordinates(zipCode: string): GeoPoint | null {
  if (typeof zipCode !== 'string') return null;
  const point = ZIP_CENTROIDS[normalizeZipCode(zipCode)];
  if (!point || !isValidGeoPoint(point)) return null;
  return { ...point };
}

export function distanceBetweenZipCodes(zipA: string, zipB: string): number | null {
  const a = getZipCoordinates(zipA);
  const b = getZipCoordinates(zipB);
  return a && b ? distanceKm(a, b) : null;
}
