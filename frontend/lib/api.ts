export const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

export type Branch =
  | 'army'
  | 'navy'
  | 'air_force'
  | 'marines'
  | 'coast_guard'
  | 'space_force';

export interface ServiceType {
  id: string;
  label: string;
  description: string;
  defaultDurationMinutes: number;
}

export interface PilotTerms {
  version: string;
  headline: string;
  summary: string;
  points: { title: string; detail: string }[];
  acknowledgement: string;
}

export interface Catalog {
  serviceTypes: ServiceType[];
  branches: Branch[];
  matchWeights: Record<string, number>;
  pilotTerms: PilotTerms;
  distance: {
    /** How far from their ZIP a veteran gets matched. */
    serviceRadiusKm: number;
    /** Fairness only reorders drivers within this much of the closest one. */
    fairnessMaxExtraKm: number;
  };
}

export interface Offering {
  serviceType: string;
  rateType: 'volunteer' | 'hourly';
  hourlyRateUsd: number;
}

export interface Provider {
  id: string;
  name: string;
  branch: Branch;
  yearsOfService: number;
  bio: string;
  rating: number | null;
  completedJobs: number;
  verified: boolean;
  servesFrom: string | null;
  offerings: Offering[];
  email?: string;
  phone?: string;
  vehicle?: { model: string; licensePlate: string } | null;
  /** Present on the veteran's own record once they accept the pilot terms. */
  pilotConsent?: { version: string; acceptedAt: string } | null;
}

export interface Slot {
  id: string;
  providerId: string;
  startsAt: string;
  endsAt: string;
  serviceTypes: string[];
  status: 'open' | 'booked' | 'cancelled';
  origin: { zipCode: string | null; address: string | null } | null;
  note: string | null;
}

export interface Booking {
  id: string;
  providerId: string;
  slotId: string;
  serviceType: string;
  serviceLabel: string;
  requester: { name: string; veteran: true; email?: string; phone?: string };
  location: { lat: number; lng: number; zipCode?: string; address?: string };
  startsAt: string;
  endsAt: string;
  status: 'confirmed' | 'completed' | 'cancelled';
  estimatedCostUsd: number;
  matchScore: number;
  notes?: string;
  provider?: Provider;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: { field: string; message: string }[],
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Thin fetch wrapper that turns the API's error envelope into a thrown ApiError. */
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      cache: 'no-store',
      headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    });
  } catch {
    throw new ApiError(`Can't reach the API at ${API_BASE}. Is it running?`, 0);
  }

  const body = await response.json().catch(() => null);

  if (!response.ok) {
    const error = body?.error;
    throw new ApiError(error?.message ?? response.statusText, response.status, error?.details);
  }

  return body as T;
}

export const getCatalog = () => api<Catalog>('/api/v1/catalog');

export const getProviders = (serviceType?: string) =>
  api<{ providers: Provider[]; count: number }>(
    `/api/v1/providers${serviceType ? `?serviceType=${serviceType}` : ''}`,
  );

export const getProvider = (providerId: string) =>
  api<{ provider: Provider; openSlots: Slot[] }>(`/api/v1/providers/${providerId}`);

export const getProviderSlots = (providerId: string) =>
  api<{ slots: Slot[] }>(`/api/v1/providers/${providerId}/slots`);

export const getProviderBookings = (providerId: string) =>
  api<{ bookings: Booking[] }>(`/api/v1/providers/${providerId}/bookings`);

export const post = <T>(path: string, payload: unknown, headers?: Record<string, string>) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(payload), ...(headers ? { headers } : {}) });

export const patch = <T>(path: string, payload: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(payload) });

export const del = <T>(path: string) => api<T>(path, { method: 'DELETE' });
