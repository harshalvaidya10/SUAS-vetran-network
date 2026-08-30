import type { GeoPoint } from '../types.js';
import { distanceKm, isValidGeoPoint } from './geo.js';

/**
 * Deliberately local centroid table for the San Diego and Bay Area demos.
 * ZIPs are geographic identifiers, never numbers to subtract from one another.
 */
const ZIP_CENTROIDS: Readonly<Record<string, GeoPoint>> = {
  // San Francisco Peninsula / South Bay. Hacker Dojo is in 94043.
  '94022': { lat: 37.37, lng: -122.145 }, // Los Altos
  '94024': { lat: 37.35, lng: -122.10 }, // Los Altos
  '94040': { lat: 37.38, lng: -122.087 }, // Mountain View
  '94041': { lat: 37.389, lng: -122.079 }, // Downtown Mountain View
  '94043': { lat: 37.414, lng: -122.07 }, // Hacker Dojo / North Mountain View
  '94085': { lat: 37.389, lng: -122.017 }, // Sunnyvale
  '94086': { lat: 37.371, lng: -122.023 }, // Sunnyvale
  '94087': { lat: 37.351, lng: -122.036 }, // Sunnyvale
  '94089': { lat: 37.412, lng: -122.015 }, // North Sunnyvale
  '94103': { lat: 37.773, lng: -122.411 }, // San Francisco SOMA
  '94105': { lat: 37.789, lng: -122.394 }, // San Francisco Embarcadero
  '94107': { lat: 37.766, lng: -122.395 }, // San Francisco Mission Bay
  '94301': { lat: 37.444, lng: -122.15 }, // Palo Alto
  '94303': { lat: 37.454, lng: -122.117 }, // East Palo Alto / Palo Alto
  '94304': { lat: 37.405, lng: -122.167 }, // Stanford
  '94306': { lat: 37.418, lng: -122.13 }, // Palo Alto
  '95014': { lat: 37.306, lng: -122.081 }, // Cupertino
  '95050': { lat: 37.354, lng: -121.953 }, // Santa Clara
  '95051': { lat: 37.35, lng: -121.984 }, // Santa Clara
  '95054': { lat: 37.395, lng: -121.964 }, // North Santa Clara
  '95110': { lat: 37.347, lng: -121.91 }, // San Jose
  '95112': { lat: 37.344, lng: -121.883 }, // Downtown San Jose
  '95113': { lat: 37.334, lng: -121.89 }, // Downtown San Jose
  '95126': { lat: 37.325, lng: -121.916 }, // San Jose
  '95128': { lat: 37.316, lng: -121.936 }, // San Jose

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

  // Remainder of San Diego County, so a driver anywhere in the service area
  // can sign up. Same shape and precision as the entries above.
  '91910': { lat: 32.64, lng: -117.084 }, // Chula Vista
  '91911': { lat: 32.607, lng: -117.057 }, // Chula Vista
  '91913': { lat: 32.632, lng: -116.972 }, // Eastlake
  '91914': { lat: 32.66, lng: -116.955 }, // Chula Vista
  '91915': { lat: 32.621, lng: -116.95 }, // Otay Ranch
  '91932': { lat: 32.578, lng: -117.116 }, // Imperial Beach
  '91941': { lat: 32.762, lng: -116.997 }, // La Mesa
  '91942': { lat: 32.79, lng: -117.013 }, // La Mesa
  '91945': { lat: 32.733, lng: -117.031 }, // Lemon Grove
  '91950': { lat: 32.678, lng: -117.099 }, // National City
  '91977': { lat: 32.725, lng: -116.995 }, // Spring Valley
  '92007': { lat: 33.018, lng: -117.279 }, // Cardiff
  '92008': { lat: 33.158, lng: -117.335 }, // Carlsbad
  '92009': { lat: 33.096, lng: -117.267 }, // Carlsbad
  '92010': { lat: 33.162, lng: -117.287 }, // Carlsbad
  '92011': { lat: 33.109, lng: -117.305 }, // Carlsbad
  '92019': { lat: 32.79, lng: -116.91 }, // El Cajon
  '92021': { lat: 32.82, lng: -116.92 }, // El Cajon
  '92024': { lat: 33.045, lng: -117.261 }, // Encinitas
  '92025': { lat: 33.115, lng: -117.07 }, // Escondido
  '92026': { lat: 33.16, lng: -117.1 }, // Escondido
  '92027': { lat: 33.13, lng: -117.03 }, // Escondido
  '92028': { lat: 33.376, lng: -117.251 }, // Fallbrook
  '92029': { lat: 33.09, lng: -117.12 }, // Escondido
  '92036': { lat: 33.079, lng: -116.601 }, // Julian
  '92040': { lat: 32.86, lng: -116.92 }, // Lakeside
  '92055': { lat: 33.305, lng: -117.345 }, // Camp Pendleton
  '92056': { lat: 33.193, lng: -117.307 }, // Oceanside
  '92057': { lat: 33.244, lng: -117.311 }, // Oceanside
  '92058': { lat: 33.236, lng: -117.358 }, // Oceanside
  '92064': { lat: 32.962, lng: -117.035 }, // Poway
  '92065': { lat: 33.04, lng: -116.87 }, // Ramona
  '92069': { lat: 33.145, lng: -117.17 }, // San Marcos
  '92071': { lat: 32.848, lng: -116.98 }, // Santee
  '92078': { lat: 33.12, lng: -117.19 }, // San Marcos
  '92081': { lat: 33.17, lng: -117.24 }, // Vista
  '92082': { lat: 33.22, lng: -117.03 }, // Valley Center
  '92083': { lat: 33.195, lng: -117.25 }, // Vista
  '92084': { lat: 33.21, lng: -117.22 }, // Vista
  '92107': { lat: 32.745, lng: -117.247 }, // Ocean Beach
  '92108': { lat: 32.774, lng: -117.145 }, // Mission Valley
  '92109': { lat: 32.794, lng: -117.235 }, // Pacific Beach
  '92113': { lat: 32.697, lng: -117.122 }, // Logan Heights
  '92114': { lat: 32.71, lng: -117.056 }, // Encanto
  '92115': { lat: 32.762, lng: -117.07 }, // College Area
  '92116': { lat: 32.765, lng: -117.125 }, // Normal Heights
  '92118': { lat: 32.679, lng: -117.173 }, // Coronado
  '92119': { lat: 32.805, lng: -117.03 }, // San Carlos
  '92120': { lat: 32.793, lng: -117.07 }, // Del Cerro
  '92121': { lat: 32.899, lng: -117.205 }, // Sorrento Valley
  '92122': { lat: 32.857, lng: -117.207 }, // University City
  '92124': { lat: 32.818, lng: -117.096 }, // Tierrasanta
  '92127': { lat: 33.023, lng: -117.085 }, // Rancho Bernardo
  '92128': { lat: 33.006, lng: -117.07 }, // Rancho Bernardo
  '92129': { lat: 32.964, lng: -117.123 }, // Rancho Peñasquitos
  '92131': { lat: 32.918, lng: -117.093 }, // Scripps Ranch
  '92134': { lat: 32.728, lng: -117.144 }, // Naval Medical Center Balboa
  '92135': { lat: 32.699, lng: -117.215 }, // NAS North Island
  '92136': { lat: 32.681, lng: -117.122 }, // Naval Base San Diego
  '92139': { lat: 32.68, lng: -117.043 }, // Paradise Hills
  '92140': { lat: 32.742, lng: -117.197 }, // MCRD San Diego
  '92145': { lat: 32.87, lng: -117.14 }, // MCAS Miramar
  '92154': { lat: 32.571, lng: -117.07 }, // Otay Mesa
  '92155': { lat: 32.679, lng: -117.16 }, // Naval Base Coronado
  '92173': { lat: 32.555, lng: -117.045 }, // San Ysidro
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
