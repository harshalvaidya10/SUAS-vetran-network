import { distanceKm } from './geo.js';
import { kmToMiles, pickupTiersKm } from './distancePolicy.js';
import type { MilitaryBranch, ServiceTypeId } from './serviceCatalog.js';
import type { AvailabilitySlot, Place, Provider, ServiceOffering } from '../types.js';

/** Unrated providers aren't punished for being new, but don't outrank proven ones. */
const DEFAULT_RATING = 4.5;
/** Completed jobs at which the reliability component saturates. */
const RELIABILITY_CEILING = 25;
/** Bookings in the trailing week at which a provider stops getting the spread-the-work boost. */
const LOAD_CEILING = 5;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Weights sum to 1. They encode the network's priorities, in order: send the
 * closest capable veteran, prefer the ones the community rates well, and spread
 * work across the roster instead of burning out the same three people.
 */
export const SCORE_WEIGHTS = {
  proximity: 0.3,
  rating: 0.2,
  promptness: 0.15,
  workloadBalance: 0.15,
  reliability: 0.1,
  slotFit: 0.1,
} as const;

export type ScoreComponent = keyof typeof SCORE_WEIGHTS;

export interface MatchCriteria {
  serviceType: ServiceTypeId;
  location: Place;
  windowStartsAt: string;
  windowEndsAt: string;
  durationMinutes: number;
  maxDistanceKm: number;
  minRating?: number;
  preferredBranch?: MilitaryBranch;
  maxHourlyRateUsd?: number;
  volunteerOnly?: boolean;
  /** Ask for a specific veteran; everything else still has to check out. */
  providerId?: string;
  limit?: number;
}

export interface MatchContext {
  providers: Provider[];
  slots: AvailabilitySlot[];
  /** providerId -> bookings created in the trailing 7 days. */
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
  | 'out_of_range'
  | 'no_overlapping_slot';

export interface MatchResult {
  candidates: Candidate[];
  /** Providers that cleared every filter and produced at least one candidate. */
  matchedProviders: number;
  /** Why the rest dropped out — the honest answer to "why did nobody match?". */
  rejections: Record<RejectionReason, number>;
}

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

function emptyRejections(): Record<RejectionReason, number> {
  return {
    inactive_or_unverified: 0,
    service_not_offered: 0,
    rating_below_minimum: 0,
    branch_mismatch: 0,
    rate_too_high: 0,
    out_of_range: 0,
    no_overlapping_slot: 0,
  };
}

function effectiveRating(provider: Provider): number {
  return provider.rating ?? DEFAULT_RATING;
}

function hourlyRate(offering: ServiceOffering): number {
  return offering.rateType === 'volunteer' ? 0 : offering.hourlyRateUsd;
}

/**
 * Finds the earliest sub-window of `durationMinutes` that fits inside both the
 * committed slot and the requester's window, never starting in the past.
 */
function fitWithinSlot(
  slot: AvailabilitySlot,
  criteria: MatchCriteria,
  now: Date,
): { startsAt: Date; endsAt: Date } | null {
  const durationMs = criteria.durationMinutes * 60_000;
  const earliest = Math.max(
    new Date(slot.startsAt).getTime(),
    new Date(criteria.windowStartsAt).getTime(),
    now.getTime(),
  );
  const latest = Math.min(new Date(slot.endsAt).getTime(), new Date(criteria.windowEndsAt).getTime());

  if (!Number.isFinite(earliest) || !Number.isFinite(latest)) return null;
  if (latest - earliest < durationMs) return null;

  return { startsAt: new Date(earliest), endsAt: new Date(earliest + durationMs) };
}

/**
 * Pure matching pass: given the roster, the open slots and the ask, return the
 * ranked candidates. No I/O, so the ranking is straightforward to test and to
 * reason about when someone asks why they got the veteran they got.
 */
export function findMatches(criteria: MatchCriteria, context: MatchContext): MatchResult {
  const now = context.now ?? new Date();
  const rejections = emptyRejections();
  const candidates: Candidate[] = [];
  const matched = new Set<string>();

  const openSlotsByProvider = new Map<string, AvailabilitySlot[]>();
  for (const slot of context.slots) {
    if (slot.status !== 'open') continue;
    if (!slot.serviceTypes.includes(criteria.serviceType)) continue;
    const list = openSlotsByProvider.get(slot.providerId);
    if (list) list.push(slot);
    else openSlotsByProvider.set(slot.providerId, [slot]);
  }

  const windowStart = new Date(criteria.windowStartsAt).getTime();
  const windowEnd = new Date(criteria.windowEndsAt).getTime();
  const windowSpanMs = Math.max(1, windowEnd - windowStart);

  for (const provider of context.providers) {
    if (criteria.providerId && provider.id !== criteria.providerId) continue;

    if (!provider.active || !provider.verified) {
      rejections.inactive_or_unverified += 1;
      continue;
    }

    const offering = provider.offerings.find((o) => o.serviceType === criteria.serviceType);
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
    if (criteria.volunteerOnly && offering.rateType !== 'volunteer') {
      rejections.rate_too_high += 1;
      continue;
    }
    if (criteria.maxHourlyRateUsd !== undefined && rate > criteria.maxHourlyRateUsd) {
      rejections.rate_too_high += 1;
      continue;
    }

    const slots = openSlotsByProvider.get(provider.id) ?? [];
    if (slots.length === 0) {
      rejections.no_overlapping_slot += 1;
      continue;
    }

    let anyInRange = false;
    let anyFits = false;

    for (const slot of slots) {
      const origin = slot.origin ?? provider.base;
      const distance = distanceKm(origin, criteria.location);
      const reach = Math.min(provider.serviceRadiusKm, criteria.maxDistanceKm);
      if (distance > reach) continue;
      anyInRange = true;

      const fit = fitWithinSlot(slot, criteria, now);
      if (!fit) continue;
      anyFits = true;

      const slotMinutes = Math.max(
        1,
        (new Date(slot.endsAt).getTime() - new Date(slot.startsAt).getTime()) / 60_000,
      );
      const recentBookings = context.recentBookingCounts.get(provider.id) ?? 0;

      const breakdown: Record<ScoreComponent, number> = {
        // Closer is better, measured against how far we were willing to look.
        proximity: clamp01(1 - distance / Math.max(reach, 0.001)),
        // 3.0 stars is the floor of usefulness, 5.0 the ceiling.
        rating: clamp01((effectiveRating(provider) - 3) / 2),
        // Sooner inside the requester's window is better.
        promptness: clamp01(1 - (fit.startsAt.getTime() - windowStart) / windowSpanMs),
        // Veterans who haven't worked lately go first.
        workloadBalance: clamp01(1 - recentBookings / LOAD_CEILING),
        reliability: clamp01(provider.completedJobs / RELIABILITY_CEILING),
        // Prefer the slot the job actually fills, so long slots stay free for long jobs.
        slotFit: clamp01(criteria.durationMinutes / slotMinutes),
      };

      const score = (Object.keys(SCORE_WEIGHTS) as ScoreComponent[]).reduce(
        (total, key) => total + breakdown[key] * SCORE_WEIGHTS[key],
        0,
      );

      matched.add(provider.id);
      candidates.push({
        provider,
        slot,
        offering,
        distanceKm: Math.round(distance * 10) / 10,
        startsAt: fit.startsAt.toISOString(),
        endsAt: fit.endsAt.toISOString(),
        estimatedCostUsd: Math.round(((rate * criteria.durationMinutes) / 60) * 100) / 100,
        score: Math.round(score * 1000) / 10,
        scoreBreakdown: breakdown,
      });
    }

    if (!anyInRange) rejections.out_of_range += 1;
    else if (!anyFits) rejections.no_overlapping_slot += 1;
  }

  candidates.sort(
    (a, b) =>
      b.score - a.score ||
      new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime() ||
      a.distanceKm - b.distanceKm ||
      a.provider.id.localeCompare(b.provider.id),
  );

  // One candidate per veteran — their best slot — so the shortlist shows choice.
  const seen = new Set<string>();
  const deduped = candidates.filter((candidate) => {
    if (seen.has(candidate.provider.id)) return false;
    seen.add(candidate.provider.id);
    return true;
  });

  return {
    candidates: deduped.slice(0, criteria.limit ?? 5),
    matchedProviders: matched.size,
    rejections,
  };
}

/** Bookings a provider took in the trailing week, used for the workload nudge. */
export function countRecentBookings(
  bookings: { providerId: string; createdAt: string; status: string }[],
  now = new Date(),
): Map<string, number> {
  const counts = new Map<string, number>();
  for (const booking of bookings) {
    if (booking.status === 'cancelled') continue;
    if (now.getTime() - new Date(booking.createdAt).getTime() > WEEK_MS) continue;
    counts.set(booking.providerId, (counts.get(booking.providerId) ?? 0) + 1);
  }
  return counts;
}

export interface TieredMatchResult extends MatchResult {
  /** How far out we ended up having to look, in miles. */
  searchRadiusMiles: number;
}

/**
 * Closest-first matching. Runs the ranking inside a tight radius and widens
 * only when that radius came up empty, so proximity can't be outvoted by a
 * high rating twenty miles away. The rejection tally returned on a miss is the
 * one from the widest search, since that's the honest picture.
 */
export function findMatchesTiered(
  criteria: MatchCriteria,
  context: MatchContext,
): TieredMatchResult {
  const tiers = pickupTiersKm(criteria.maxDistanceKm);
  let widest: MatchResult | null = null;

  for (const tierKm of tiers) {
    const result = findMatches({ ...criteria, maxDistanceKm: tierKm }, context);
    if (result.candidates.length > 0) {
      return { ...result, searchRadiusMiles: Math.round(kmToMiles(tierKm)) };
    }
    widest = result;
  }

  return {
    ...widest!,
    searchRadiusMiles: Math.round(kmToMiles(tiers[tiers.length - 1]!)),
  };
}
