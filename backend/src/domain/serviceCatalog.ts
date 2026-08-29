/**
 * The service catalog is intentionally small for the bootstrap. Each entry is a
 * kind of help a veteran can commit to providing. `defaultDurationMinutes` is
 * what we assume a requester needs when they don't say.
 */
export const SERVICE_TYPES = [
  {
    id: 'rides',
    label: 'Rides & transport',
    description: 'Rides to VA appointments, the airport, job interviews, anywhere.',
    defaultDurationMinutes: 60,
  },
  {
    id: 'moving',
    label: 'Moving & heavy lifting',
    description: 'PCS moves, furniture, loading and unloading a truck.',
    defaultDurationMinutes: 180,
  },
  {
    id: 'home_repair',
    label: 'Home repair & handyman',
    description: 'Small repairs, mounting, plumbing and electrical odd jobs.',
    defaultDurationMinutes: 120,
  },
  {
    id: 'yard_work',
    label: 'Yard work',
    description: 'Mowing, leaf clearing, snow removal, seasonal cleanup.',
    defaultDurationMinutes: 90,
  },
  {
    id: 'tech_support',
    label: 'Tech support',
    description: 'Computers, phones, Wi-Fi, filing things online.',
    defaultDurationMinutes: 60,
  },
  {
    id: 'benefits_navigation',
    label: 'Benefits navigation',
    description: 'Help filing VA claims, appeals, and paperwork.',
    defaultDurationMinutes: 90,
  },
  {
    id: 'peer_support',
    label: 'Peer support',
    description: 'A veteran who will sit down, listen, and check in.',
    defaultDurationMinutes: 60,
  },
] as const;

export type ServiceTypeId = (typeof SERVICE_TYPES)[number]['id'];

export const SERVICE_TYPE_IDS = SERVICE_TYPES.map((s) => s.id) as [ServiceTypeId, ...ServiceTypeId[]];

const byId = new Map(SERVICE_TYPES.map((s) => [s.id, s]));

export function getServiceType(id: ServiceTypeId) {
  return byId.get(id)!;
}

export function isServiceTypeId(value: string): value is ServiceTypeId {
  return byId.has(value as ServiceTypeId);
}

export const MILITARY_BRANCHES = ['army', 'navy', 'air_force', 'marines', 'coast_guard', 'space_force'] as const;
export type MilitaryBranch = (typeof MILITARY_BRANCHES)[number];
