/**
 * MVP scope: driving only. The catalog stays a list — the type union, the
 * per-slot service filter and the API contract are all derived from it — so
 * adding a second service later is an entry here, not a schema change.
 */
export const SERVICE_TYPES = [
  {
    id: 'rides',
    label: 'Rides & transport',
    description: 'Rides to VA appointments, the airport, job interviews, anywhere.',
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
