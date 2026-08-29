import type { Place } from '../types.js';

/**
 * ZIP centroids for San Diego County, the MVP's service area. A veteran gives
 * us a ZIP; we match from the centre of it.
 *
 * This is deliberately a table and not a geocoding call: it needs no key, no
 * network hop and no rate limit, and a ZIP centroid is about as precise as a
 * veteran's home address should be to the matcher anyway. Replacing it with a
 * real geocoder means reimplementing `lookupZip` and nothing else.
 *
 * Coordinates are approximate centroids — good to a kilometre or so, which is
 * well inside the tens-of-kilometres radius matching actually works at.
 */
const ZIP_CENTROIDS: Record<string, { lat: number; lng: number; city: string }> = {
  // City of San Diego
  '92101': { lat: 32.7157, lng: -117.1611, city: 'Downtown San Diego' },
  '92102': { lat: 32.715, lng: -117.13, city: 'Golden Hill' },
  '92103': { lat: 32.748, lng: -117.166, city: 'Hillcrest' },
  '92104': { lat: 32.741, lng: -117.129, city: 'North Park' },
  '92105': { lat: 32.742, lng: -117.094, city: 'City Heights' },
  '92106': { lat: 32.725, lng: -117.235, city: 'Point Loma' },
  '92107': { lat: 32.745, lng: -117.247, city: 'Ocean Beach' },
  '92108': { lat: 32.774, lng: -117.145, city: 'Mission Valley' },
  '92109': { lat: 32.794, lng: -117.235, city: 'Pacific Beach' },
  '92110': { lat: 32.766, lng: -117.198, city: 'Old Town' },
  '92111': { lat: 32.804, lng: -117.17, city: 'Linda Vista' },
  '92113': { lat: 32.697, lng: -117.122, city: 'Logan Heights' },
  '92114': { lat: 32.71, lng: -117.056, city: 'Encanto' },
  '92115': { lat: 32.762, lng: -117.07, city: 'College Area' },
  '92116': { lat: 32.765, lng: -117.125, city: 'Normal Heights' },
  '92117': { lat: 32.825, lng: -117.197, city: 'Clairemont' },
  '92119': { lat: 32.805, lng: -117.03, city: 'San Carlos' },
  '92120': { lat: 32.793, lng: -117.07, city: 'Del Cerro' },
  '92121': { lat: 32.899, lng: -117.205, city: 'Sorrento Valley' },
  '92122': { lat: 32.857, lng: -117.207, city: 'University City' },
  '92123': { lat: 32.797, lng: -117.137, city: 'Serra Mesa' },
  '92124': { lat: 32.818, lng: -117.096, city: 'Tierrasanta' },
  '92126': { lat: 32.913, lng: -117.142, city: 'Mira Mesa' },
  '92127': { lat: 33.023, lng: -117.085, city: 'Rancho Bernardo' },
  '92128': { lat: 33.006, lng: -117.07, city: 'Rancho Bernardo' },
  '92129': { lat: 32.964, lng: -117.123, city: 'Rancho Peñasquitos' },
  '92130': { lat: 32.943, lng: -117.215, city: 'Carmel Valley' },
  '92131': { lat: 32.918, lng: -117.093, city: 'Scripps Ranch' },
  '92139': { lat: 32.68, lng: -117.043, city: 'Paradise Hills' },
  '92154': { lat: 32.571, lng: -117.07, city: 'Otay Mesa' },
  '92173': { lat: 32.555, lng: -117.045, city: 'San Ysidro' },
  '92037': { lat: 32.845, lng: -117.274, city: 'La Jolla' },
  // Military installations — a lot of the roster lives on or near one
  '92055': { lat: 33.305, lng: -117.345, city: 'Camp Pendleton' },
  '92134': { lat: 32.728, lng: -117.144, city: 'Naval Medical Center Balboa' },
  '92135': { lat: 32.699, lng: -117.215, city: 'NAS North Island' },
  '92136': { lat: 32.681, lng: -117.122, city: 'Naval Base San Diego' },
  '92140': { lat: 32.742, lng: -117.197, city: 'MCRD San Diego' },
  '92145': { lat: 32.87, lng: -117.14, city: 'MCAS Miramar' },
  '92155': { lat: 32.679, lng: -117.16, city: 'Naval Base Coronado' },
  // South Bay
  '91910': { lat: 32.64, lng: -117.084, city: 'Chula Vista' },
  '91911': { lat: 32.607, lng: -117.057, city: 'Chula Vista' },
  '91913': { lat: 32.632, lng: -116.972, city: 'Eastlake' },
  '91914': { lat: 32.66, lng: -116.955, city: 'Chula Vista' },
  '91915': { lat: 32.621, lng: -116.95, city: 'Otay Ranch' },
  '91932': { lat: 32.578, lng: -117.116, city: 'Imperial Beach' },
  '91950': { lat: 32.678, lng: -117.099, city: 'National City' },
  '92118': { lat: 32.679, lng: -117.173, city: 'Coronado' },
  // East County
  '91941': { lat: 32.762, lng: -116.997, city: 'La Mesa' },
  '91942': { lat: 32.79, lng: -117.013, city: 'La Mesa' },
  '91945': { lat: 32.733, lng: -117.031, city: 'Lemon Grove' },
  '91977': { lat: 32.725, lng: -116.995, city: 'Spring Valley' },
  '92019': { lat: 32.79, lng: -116.91, city: 'El Cajon' },
  '92020': { lat: 32.797, lng: -116.97, city: 'El Cajon' },
  '92021': { lat: 32.82, lng: -116.92, city: 'El Cajon' },
  '92040': { lat: 32.86, lng: -116.92, city: 'Lakeside' },
  '92071': { lat: 32.848, lng: -116.98, city: 'Santee' },
  '92065': { lat: 33.04, lng: -116.87, city: 'Ramona' },
  '92036': { lat: 33.079, lng: -116.601, city: 'Julian' },
  // North County
  '92064': { lat: 32.962, lng: -117.035, city: 'Poway' },
  '92007': { lat: 33.018, lng: -117.279, city: 'Cardiff' },
  '92024': { lat: 33.045, lng: -117.261, city: 'Encinitas' },
  '92008': { lat: 33.158, lng: -117.335, city: 'Carlsbad' },
  '92009': { lat: 33.096, lng: -117.267, city: 'Carlsbad' },
  '92010': { lat: 33.162, lng: -117.287, city: 'Carlsbad' },
  '92011': { lat: 33.109, lng: -117.305, city: 'Carlsbad' },
  '92054': { lat: 33.196, lng: -117.379, city: 'Oceanside' },
  '92056': { lat: 33.193, lng: -117.307, city: 'Oceanside' },
  '92057': { lat: 33.244, lng: -117.311, city: 'Oceanside' },
  '92058': { lat: 33.236, lng: -117.358, city: 'Oceanside' },
  '92069': { lat: 33.145, lng: -117.17, city: 'San Marcos' },
  '92078': { lat: 33.12, lng: -117.19, city: 'San Marcos' },
  '92081': { lat: 33.17, lng: -117.24, city: 'Vista' },
  '92083': { lat: 33.195, lng: -117.25, city: 'Vista' },
  '92084': { lat: 33.21, lng: -117.22, city: 'Vista' },
  '92025': { lat: 33.115, lng: -117.07, city: 'Escondido' },
  '92026': { lat: 33.16, lng: -117.1, city: 'Escondido' },
  '92027': { lat: 33.13, lng: -117.03, city: 'Escondido' },
  '92029': { lat: 33.09, lng: -117.12, city: 'Escondido' },
  '92028': { lat: 33.376, lng: -117.251, city: 'Fallbrook' },
  '92082': { lat: 33.22, lng: -117.03, city: 'Valley Center' },
};

export interface ZipLocation extends Place {
  zip: string;
  city: string;
}

/** Resolves a 5-digit ZIP to the point we match from, or null if off the map. */
export function lookupZip(zip: string): ZipLocation | null {
  const entry = ZIP_CENTROIDS[zip];
  if (!entry) return null;
  return { zip, city: entry.city, lat: entry.lat, lng: entry.lng, address: entry.city };
}

export function isServicedZip(zip: string): boolean {
  return zip in ZIP_CENTROIDS;
}

/** Every ZIP we cover, for the sign-up form's "where are you?" hint. */
export const SERVICED_ZIPS = Object.keys(ZIP_CENTROIDS).sort();
