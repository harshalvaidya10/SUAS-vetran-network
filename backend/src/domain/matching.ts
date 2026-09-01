import { distanceKm, isValidGeoPoint } from './geo.js';
import { getZipCoordinates } from './zipGeo.js';
import type { MilitaryBranch, ServiceTypeId } from './serviceCatalog.js';
import type {
  AvailabilitySlot,
  Booking,
  GeoPoint,
  Place,
  Provider,
  ServiceOffering,
} from '../types.js';

const DEFAULT_RATING = 4.5;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Fairness may reorder only drivers within about two miles of the closest candidate. */
export const FAIRNESS_MAX_EXTRA_KM = 3.2;

/** Availability is filtered first; these weights rank only fully eligible drivers. */
export const SCORE_WEIGHTS = {
  proximity: 0.65,
  workloadFairness: 0.25,
  reliability: 0.1,
} as const;

export type ScoreComponent = keyof typeof SCORE_WEIGHTS;

export interface MatchCriteria {
  serviceType: ServiceTypeId;
  /** ZIP centroid is preferred; location remains for display and backwards-compatible storage. */
  pickupZip: string;
  location?: Place;
  /** For rides this is the exact requested pickup time, not a flexible search window. */
  windowStartsAt: string;
  windowEndsAt: string;
  durationMinutes: number;
  maxDistanceKm: number;
  minRating?: number;
  preferredBranch?: MilitaryBranch;
  maxHourlyRateUsd?: number;
  volunteerOnly?: boolean;
  providerId?: string;
  limit?: number;
}

export interface MatchContext {
  providers: Provider[];
  slots: AvailabilitySlot[];
  bookings: Pick<Booking, 'providerId' | 'startsAt' | 'endsAt' | 'status'>[];
  /** providerId -> confirmed/completed rides assigned in the trailing 7 days. */
  recentBookingCounts: Map<string, number>;
  now?: Date;
}

export interface Candidate {
  provider: Provider;
  slot: AvailabilitySlot;
  offering: ServiceOffering;
  distanceKm: number;
  startsAt: string;
  endsAt: string;
  estimatedCostUsd: number;
  recentRideCount: number;
  withinFairnessGuardrail: boolean;
  /** 0-100. */
  score: number;
  scoreBreakdown: Record<ScoreComponent, number>;
}

export type RejectionReason =
  | 'inactive_or_unverified'
  | 'service_not_offered'
  | 'rating_below_minimum'
  | 'branch_mismatch'
  | 'rate_too_high'
  | 'invalid_zip'
  | 'outside_search_radius'
  | 'no_open_slot'
  | 'no_valid_availability'
  | 'ride_exceeds_slot'
  | 'overlapping_booking'
  | 'request_in_past'
  | 'invalid_duration';

export interface MatchResult {
  candidates: Candidate[];
  matchedProviders: number;
  rejections: Record<RejectionReason, number>;
}

interface EligibleCandidate {
  provider: Provider;
  slot: AvailabilitySlot;
  offering: ServiceOffering;
  distanceKm: number;
  recentRideCount: number;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function emptyRejections(): Record<RejectionReason, number> {
  return {
    inactive_or_unverified: 0,
    service_not_offered: 0,
    rating_below_minimum: 0,
    branch_mismatch: 0,
    rate_too_high: 0,
    invalid_zip: 0,
    outside_search_radius: 0,
    no_open_slot: 0,
    no_valid_availability: 0,
    ride_exceeds_slot: 0,
    overlapping_booking: 0,
    request_in_past: 0,
    invalid_duration: 0,
  };
}

function effectiveRating(provider: Provider): number {
  return provider.rating ?? DEFAULT_RATING;
}

function hourlyRate(offering: ServiceOffering): number {
  return offering.rateType === 'volunteer' ? 0 : offering.hourlyRateUsd;
}

function preferredCoordinates(place: Place | undefined, zipCode?: string): GeoPoint | null {
  if (zipCode) return getZipCoordinates(zipCode);
  if (place?.zipCode) return getZipCoordinates(place.zipCode);
  return isValidGeoPoint(place) ? place : null;
}

function intervalsOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

function hasOverlappingBooking(
  providerId: string,
  requestedStart: number,
  requestedEnd: number,
  bookings: MatchContext['bookings'],
): boolean {
  return bookings.some((booking) => {
    if (booking.providerId !== providerId || booking.status !== 'confirmed') return false;
    const startsAt = new Date(booking.startsAt).getTime();
    const endsAt = new Date(booking.endsAt).getTime();
    return (
      Number.isFinite(startsAt) &&
      Number.isFinite(endsAt) &&
      intervalsOverlap(requestedStart, requestedEnd, startsAt, endsAt)
    );
  });
}

/** Pure, deterministic ride matcher. Hard constraints are never traded for score. */
export function findMatches(criteria: MatchCriteria, context: MatchContext): MatchResult {
  const now = context.now ?? new Date();
  const rejections = emptyRejections();
  const eligible: EligibleCandidate[] = [];
  const requestedStart = new Date(criteria.windowStartsAt).getTime();
  const windowEnd = new Date(criteria.windowEndsAt).getTime();
  const durationMs = criteria.durationMinutes * 60_000;
  const requestedEnd = requestedStart + durationMs;
  const pickup = getZipCoordinates(criteria.pickupZip);

  if (!pickup) {
    rejections.invalid_zip = 1;
    return { candidates: [], matchedProviders: 0, rejections };
  }
  if (!Number.isFinite(criteria.durationMinutes) || criteria.durationMinutes <= 0) {
    rejections.invalid_duration = 1;
    return { candidates: [], matchedProviders: 0, rejections };
  }
  if (!Number.isFinite(requestedStart) || requestedStart < now.getTime()) {
    rejections.request_in_past = 1;
    return { candidates: [], matchedProviders: 0, rejections };
  }
  if (!Number.isFinite(windowEnd) || requestedEnd > windowEnd) {
    rejections.no_valid_availability = 1;
    return { candidates: [], matchedProviders: 0, rejections };
  }

  for (const provider of context.providers) {
    if (criteria.providerId && provider.id !== criteria.providerId) continue;

    if (!provider.active || !provider.verified) {
      rejections.inactive_or_unverified += 1;
      continue;
    }

    const offering = provider.offerings.find((item) => item.serviceType === criteria.serviceType);
    if (!offering) {
      rejections.service_not_offered += 1;
      continue;
    }
    if (criteria.minRating !== undefined && effectiveRating(provider) < criteria.minRating) {
      rejections.rating_below_minimum += 1;
      continue;
    }
    if (criteria.preferredBranch && provider.branch !== criteria.preferredBranch) {
      rejections.branch_mismatch += 1;
      continue;
    }

    const rate = hourlyRate(offering);
    if (
      (criteria.volunteerOnly && offering.rateType !== 'volunteer') ||
      (criteria.maxHourlyRateUsd !== undefined && rate > criteria.maxHourlyRateUsd)
    ) {
      rejections.rate_too_high += 1;
      continue;
    }

    const providerSlots = context.slots.filter(
      (slot) => slot.providerId === provider.id && slot.serviceTypes.includes(criteria.serviceType),
    );
    const openSlots = providerSlots.filter((slot) => slot.status === 'open');
    if (openSlots.length === 0) {
      rejections.no_open_slot += 1;
      continue;
    }

    let sawStartInsideSlot = false;
    let sawTooShortSlot = false;
    let sawInvalidOrigin = false;
    let sawInRange = false;
    const validSlots: { slot: AvailabilitySlot; distanceKm: number }[] = [];

    for (const slot of openSlots) {
      const slotStart = new Date(slot.startsAt).getTime();
      const slotEnd = new Date(slot.endsAt).getTime();
      if (!Number.isFinite(slotStart) || !Number.isFinite(slotEnd)) continue;
      if (requestedStart < slotStart || requestedStart >= slotEnd) continue;
      sawStartInsideSlot = true;
      if (requestedEnd > slotEnd) {
        sawTooShortSlot = true;
        continue;
      }

      const origin = preferredCoordinates(
        slot.origin ?? provider.base,
        slot.origin?.zipCode ?? provider.zipCode,
      );
      if (!origin) {
        sawInvalidOrigin = true;
        continue;
      }
      const distance = distanceKm(origin, pickup);
      if (!Number.isFinite(distance)) {
        sawInvalidOrigin = true;
        continue;
      }
      const reach = Math.min(provider.serviceRadiusKm, criteria.maxDistanceKm);
      if (distance > reach) continue;
      sawInRange = true;
      validSlots.push({ slot, distanceKm: distance });
    }

    if (validSlots.length === 0) {
      if (sawTooShortSlot) rejections.ride_exceeds_slot += 1;
      else if (!sawStartInsideSlot) rejections.no_valid_availability += 1;
      else if (sawInvalidOrigin) rejections.invalid_zip += 1;
      else if (!sawInRange) rejections.outside_search_radius += 1;
      else rejections.no_valid_availability += 1;
      continue;
    }

    if (hasOverlappingBooking(provider.id, requestedStart, requestedEnd, context.bookings)) {
      rejections.overlapping_booking += 1;
      continue;
    }

    validSlots.sort(
      (a, b) =>
        a.distanceKm - b.distanceKm ||
        new Date(a.slot.startsAt).getTime() - new Date(b.slot.startsAt).getTime() ||
        a.slot.id.localeCompare(b.slot.id),
    );
    const best = validSlots[0]!;
    eligible.push({
      provider,
      slot: best.slot,
      offering,
      distanceKm: best.distanceKm,
      recentRideCount: context.recentBookingCounts.get(provider.id) ?? 0,
    });
  }

  if (eligible.length === 0) return { candidates: [], matchedProviders: 0, rejections };

  const closestDistance = Math.min(...eligible.map((candidate) => candidate.distanceKm));
  const guardrailLimit = closestDistance + FAIRNESS_MAX_EXTRA_KM;
  const competition = eligible.filter((candidate) => candidate.distanceKm <= guardrailLimit);
  const loads = competition.map((candidate) => candidate.recentRideCount);
  const minLoad = Math.min(...loads);
  const maxLoad = Math.max(...loads);

  const candidates: Candidate[] = eligible.map((candidate) => {
    const withinFairnessGuardrail = candidate.distanceKm <= guardrailLimit;
    const workloadFairness = withinFairnessGuardrail
      ? maxLoad === minLoad
        ? 0.5
        : 1 - (candidate.recentRideCount - minLoad) / (maxLoad - minLoad)
      : 0;
    const scoreBreakdown: Record<ScoreComponent, number> = {
      proximity: clamp01(1 - candidate.distanceKm / Math.max(criteria.maxDistanceKm, 0.001)),
      workloadFairness: clamp01(workloadFairness),
      reliability: clamp01(effectiveRating(candidate.provider) / 5),
    };
    const total = (Object.keys(SCORE_WEIGHTS) as ScoreComponent[]).reduce(
      (sum, component) => sum + scoreBreakdown[component] * SCORE_WEIGHTS[component],
      0,
    );

    return {
      ...candidate,
      // Keep full precision for deterministic ranking; serializers round for display.
      distanceKm: candidate.distanceKm,
      startsAt: new Date(requestedStart).toISOString(),
      endsAt: new Date(requestedEnd).toISOString(),
      estimatedCostUsd:
        Math.round(((hourlyRate(candidate.offering) * criteria.durationMinutes) / 60) * 100) / 100,
      withinFairnessGuardrail,
      score: Math.round(total * 1000) / 10,
      scoreBreakdown,
    };
  });

  candidates.sort(
    (a, b) =>
      Number(b.withinFairnessGuardrail) - Number(a.withinFairnessGuardrail) ||
      b.score - a.score ||
      a.distanceKm - b.distanceKm ||
      a.recentRideCount - b.recentRideCount ||
      effectiveRating(b.provider) - effectiveRating(a.provider) ||
      new Date(a.slot.startsAt).getTime() - new Date(b.slot.startsAt).getTime() ||
      a.provider.id.localeCompare(b.provider.id),
  );

  return {
    candidates: candidates.slice(0, criteria.limit ?? 5),
    matchedProviders: eligible.length,
    rejections,
  };
}

/** Confirmed and completed assignments count as workload; cancelled rides never do. */
export function countRecentBookings(
  bookings: { providerId: string; createdAt: string; status: string }[],
  now = new Date(),
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const booking of bookings) {
    if (booking.status !== 'confirmed' && booking.status !== 'completed') continue;
    const createdAt = new Date(booking.createdAt).getTime();
    const age = now.getTime() - createdAt;
    if (!Number.isFinite(createdAt) || age < 0 || age > WEEK_MS) continue;
    counts.set(booking.providerId, (counts.get(booking.providerId) ?? 0) + 1);
  }
  return counts;
}
