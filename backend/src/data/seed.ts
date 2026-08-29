import { store } from './store.js';
import { config } from '../config.js';
import { lookupZip } from '../domain/zipCodes.js';
import { milesToKm } from '../domain/distancePolicy.js';
import type { MilitaryBranch, ServiceTypeId } from '../domain/serviceCatalog.js';
import type { ServiceOffering } from '../types.js';

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
  zip: string;
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
    zip: '92101',
    offerings: [{ serviceType: 'rides', rateType: 'volunteer', hourlyRateUsd: 0 }],
    rating: 4.9,
    completedJobs: 34,
    slots: [
      { day: 0, from: 8, to: 12, serviceTypes: ['rides'], note: 'Weekday mornings, VA La Jolla runs' },
      { day: 1, from: 8, to: 12, serviceTypes: ['rides'] },
      { day: 2, from: 9, to: 17, serviceTypes: ['rides'] },
    ],
  },
  {
    name: 'Denise Okafor',
    branch: 'navy',
    yearsOfService: 12,
    bio: 'Hospital corpsman. I will drive you to the appointment and sit with you through it.',
    email: 'denise.okafor@example.com',
    phone: '+1-619-555-0177',
    zip: '92106',
    offerings: [{ serviceType: 'rides', rateType: 'volunteer', hourlyRateUsd: 0 }],
    rating: 5,
    completedJobs: 61,
    slots: [
      { day: 0, from: 13, to: 18, serviceTypes: ['rides'] },
      { day: 3, from: 10, to: 16, serviceTypes: ['rides'] },
    ],
  },
  {
    name: 'Ray Whitlock',
    branch: 'army',
    yearsOfService: 20,
    bio: 'Drove convoy for twenty years. Long hauls, early starts, bad weather — none of it bothers me.',
    email: 'ray.whitlock@example.com',
    phone: '+1-619-555-0193',
    zip: '92020',
    offerings: [{ serviceType: 'rides', rateType: 'hourly', hourlyRateUsd: 35 }],
    rating: 4.7,
    completedJobs: 18,
    slots: [
      { day: 0, from: 7, to: 15, serviceTypes: ['rides'] },
      { day: 1, from: 7, to: 15, serviceTypes: ['rides'], note: 'Can do airport runs' },
      { day: 2, from: 7, to: 12, serviceTypes: ['rides'] },
    ],
  },
  {
    name: 'Priya Raman',
    branch: 'air_force',
    yearsOfService: 6,
    bio: 'Cyber ops, still serving in the reserves. Evenings and weekends are mine to give.',
    email: 'priya.raman@example.com',
    phone: '+1-858-555-0110',
    zip: '92037',
    offerings: [{ serviceType: 'rides', rateType: 'volunteer', hourlyRateUsd: 0 }],
    rating: null,
    completedJobs: 0,
    slots: [
      { day: 0, from: 17, to: 21, serviceTypes: ['rides'], note: 'Evenings after work' },
      { day: 1, from: 17, to: 21, serviceTypes: ['rides'] },
      { day: 4, from: 9, to: 18, serviceTypes: ['rides'] },
    ],
  },
  {
    name: 'Tom Bierman',
    branch: 'coast_guard',
    yearsOfService: 10,
    bio: 'Search and rescue. Retired, restless, and behind the wheel most of the week.',
    email: 'tom.bierman@example.com',
    phone: '+1-760-555-0164',
    zip: '92054',
    offerings: [{ serviceType: 'rides', rateType: 'volunteer', hourlyRateUsd: 0 }],
    rating: 4.4,
    completedJobs: 9,
    slots: [
      { day: 0, from: 6, to: 20, serviceTypes: ['rides'] },
      { day: 1, from: 6, to: 20, serviceTypes: ['rides'] },
      { day: 2, from: 6, to: 20, serviceTypes: ['rides'] },
    ],
  },
];

/** Loads demo veterans and their committed slots into the in-memory store. */
export function seedDemoData(): { providers: number; slots: number } {
  let slotCount = 0;

  for (const seed of SEED_PROVIDERS) {
    const location = lookupZip(seed.zip);
    if (!location) throw new Error(`Demo veteran ${seed.name} has an unserviced ZIP ${seed.zip}`);

    const provider = store.createProvider({
      name: seed.name,
      branch: seed.branch,
      yearsOfService: seed.yearsOfService,
      bio: seed.bio,
      email: seed.email,
      phone: seed.phone,
      zip: seed.zip,
      base: { lat: location.lat, lng: location.lng, address: location.city },
      serviceRadiusKm: milesToKm(config.maxPickupMiles),
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
