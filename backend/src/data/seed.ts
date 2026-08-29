import { store } from './store.js';
import type { MilitaryBranch, ServiceTypeId } from '../domain/serviceCatalog.js';
import type { Place, ServiceOffering } from '../types.js';

const HOUR = 60 * 60 * 1000;

/** Hours from the start of today, local time — keeps demo slots always upcoming. */
function at(dayOffset: number, hour: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return new Date(d.getTime() + dayOffset * 24 * HOUR + hour * HOUR);
}

interface SeedProvider {
  name: string;
  branch: MilitaryBranch;
  yearsOfService: number;
  bio: string;
  email: string;
  phone: string;
  base: Place;
  zipCode: string;
  serviceRadiusKm: number;
  offerings: ServiceOffering[];
  rating: number | null;
  completedJobs: number;
  slots: { day: number; from: number; to: number; serviceTypes: ServiceTypeId[]; note?: string }[];
}

/** San Diego metro — one of the densest veteran populations in the country. */
const SEED_PROVIDERS: SeedProvider[] = [
  {
    name: 'Marcus Hale',
    branch: 'marines',
    yearsOfService: 8,
    bio: 'Motor T for two deployments. Happy to drive anyone to a VA appointment.',
    email: 'marcus.hale@example.com',
    phone: '+1-619-555-0142',
    base: { lat: 32.7157, lng: -117.1611, address: 'Downtown, San Diego, CA' },
    zipCode: '92101',
    serviceRadiusKm: 40,
    offerings: [
      { serviceType: 'rides', rateType: 'volunteer', hourlyRateUsd: 0 },
      { serviceType: 'moving', rateType: 'hourly', hourlyRateUsd: 45 },
    ],
    rating: 4.9,
    completedJobs: 34,
    slots: [
      { day: 0, from: 8, to: 12, serviceTypes: ['rides'], note: 'Weekday mornings, VA La Jolla runs' },
      { day: 1, from: 8, to: 12, serviceTypes: ['rides'] },
      { day: 2, from: 9, to: 17, serviceTypes: ['rides', 'moving'] },
    ],
  },
  {
    name: 'Denise Okafor',
    branch: 'navy',
    yearsOfService: 12,
    bio: 'Hospital corpsman turned benefits counselor. I will sit with you and file the claim.',
    email: 'denise.okafor@example.com',
    phone: '+1-619-555-0177',
    base: { lat: 32.7677, lng: -117.2231, address: 'Point Loma, San Diego, CA' },
    zipCode: '92106',
    serviceRadiusKm: 25,
    offerings: [
      { serviceType: 'benefits_navigation', rateType: 'volunteer', hourlyRateUsd: 0 },
      { serviceType: 'peer_support', rateType: 'volunteer', hourlyRateUsd: 0 },
    ],
    rating: 5,
    completedJobs: 61,
    slots: [
      { day: 0, from: 13, to: 18, serviceTypes: ['benefits_navigation', 'peer_support'] },
      { day: 3, from: 10, to: 16, serviceTypes: ['benefits_navigation'] },
    ],
  },
  {
    name: 'Ray Whitlock',
    branch: 'army',
    yearsOfService: 20,
    bio: '12B combat engineer. Twenty years of building and fixing. Nothing scares me but drywall dust.',
    email: 'ray.whitlock@example.com',
    phone: '+1-619-555-0193',
    base: { lat: 32.8328, lng: -116.9625, address: 'El Cajon, CA' },
    zipCode: '92020',
    serviceRadiusKm: 35,
    offerings: [
      { serviceType: 'home_repair', rateType: 'hourly', hourlyRateUsd: 55 },
      { serviceType: 'yard_work', rateType: 'hourly', hourlyRateUsd: 35 },
      { serviceType: 'moving', rateType: 'hourly', hourlyRateUsd: 40 },
    ],
    rating: 4.7,
    completedJobs: 18,
    slots: [
      { day: 0, from: 7, to: 15, serviceTypes: ['home_repair', 'yard_work'] },
      { day: 1, from: 7, to: 15, serviceTypes: ['home_repair', 'moving'] },
      { day: 2, from: 7, to: 12, serviceTypes: ['yard_work'] },
    ],
  },
  {
    name: 'Priya Raman',
    branch: 'air_force',
    yearsOfService: 6,
    bio: 'Cyber ops. If it has a screen and it is misbehaving, I can probably fix it.',
    email: 'priya.raman@example.com',
    phone: '+1-858-555-0110',
    base: { lat: 32.8801, lng: -117.2340, address: 'La Jolla, San Diego, CA' },
    zipCode: '92037',
    serviceRadiusKm: 20,
    offerings: [
      { serviceType: 'tech_support', rateType: 'volunteer', hourlyRateUsd: 0 },
      { serviceType: 'benefits_navigation', rateType: 'volunteer', hourlyRateUsd: 0 },
    ],
    rating: null,
    completedJobs: 0,
    slots: [
      { day: 0, from: 17, to: 21, serviceTypes: ['tech_support'], note: 'Evenings after work' },
      { day: 1, from: 17, to: 21, serviceTypes: ['tech_support', 'benefits_navigation'] },
      { day: 4, from: 9, to: 18, serviceTypes: ['tech_support'] },
    ],
  },
  {
    name: 'Tom Bierman',
    branch: 'coast_guard',
    yearsOfService: 10,
    bio: 'Search and rescue. Retired, restless, and available most of the week.',
    email: 'tom.bierman@example.com',
    phone: '+1-760-555-0164',
    base: { lat: 33.1959, lng: -117.3795, address: 'Oceanside, CA' },
    zipCode: '92054',
    serviceRadiusKm: 50,
    offerings: [
      { serviceType: 'rides', rateType: 'volunteer', hourlyRateUsd: 0 },
      { serviceType: 'peer_support', rateType: 'volunteer', hourlyRateUsd: 0 },
      { serviceType: 'yard_work', rateType: 'hourly', hourlyRateUsd: 30 },
    ],
    rating: 4.4,
    completedJobs: 9,
    slots: [
      { day: 0, from: 6, to: 20, serviceTypes: ['rides', 'peer_support'] },
      { day: 1, from: 6, to: 20, serviceTypes: ['rides', 'yard_work'] },
      { day: 2, from: 6, to: 20, serviceTypes: ['rides', 'peer_support'] },
    ],
  },
];

/** Loads demo veterans and their committed slots into the in-memory store. */
export function seedDemoData(): { providers: number; slots: number } {
  let slotCount = 0;

  for (const seed of SEED_PROVIDERS) {
    const provider = store.createProvider({
      name: seed.name,
      branch: seed.branch,
      yearsOfService: seed.yearsOfService,
      bio: seed.bio,
      email: seed.email,
      phone: seed.phone,
      base: seed.base,
      zipCode: seed.zipCode,
      serviceRadiusKm: seed.serviceRadiusKm,
      offerings: seed.offerings,
      rating: seed.rating,
      completedJobs: seed.completedJobs,
      verified: true,
      active: true,
    });

    for (const slot of seed.slots) {
      const startsAt = at(slot.day, slot.from);
      // Skip demo slots that already ended today.
      if (startsAt.getTime() < Date.now()) continue;
      store.createSlot({
        providerId: provider.id,
        startsAt: startsAt.toISOString(),
        endsAt: at(slot.day, slot.to).toISOString(),
        serviceTypes: slot.serviceTypes,
        status: 'open',
        ...(slot.note ? { note: slot.note } : {}),
      });
      slotCount += 1;
    }
  }

  return { providers: SEED_PROVIDERS.length, slots: slotCount };
}
