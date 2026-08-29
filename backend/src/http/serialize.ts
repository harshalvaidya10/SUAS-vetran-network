import type { Candidate } from '../domain/matching.js';
import { getServiceType } from '../domain/serviceCatalog.js';
import type { AvailabilitySlot, Booking, Provider } from '../types.js';

/**
 * What a requester sees before booking. Contact details are deliberately
 * withheld until a booking exists — the network shouldn't leak a roster of
 * veterans' phone numbers to anyone who can POST a search.
 */
export function publicProvider(provider: Provider) {
  return {
    id: provider.id,
    name: provider.name,
    branch: provider.branch,
    yearsOfService: provider.yearsOfService,
    bio: provider.bio,
    rating: provider.rating,
    completedJobs: provider.completedJobs,
    verified: provider.verified,
    // ZIP is useful for a coarse service area; exact base coordinates stay private.
    servesFrom: provider.zipCode ?? provider.base.zipCode ?? null,
    offerings: provider.offerings,
  };
}

/** Adds contact details; only used once a booking ties the two people together. */
export function providerWithContact(provider: Provider) {
  return { ...publicProvider(provider), email: provider.email, phone: provider.phone };
}

export function serializeSlot(slot: AvailabilitySlot) {
  return {
    id: slot.id,
    providerId: slot.providerId,
    startsAt: slot.startsAt,
    endsAt: slot.endsAt,
    serviceTypes: slot.serviceTypes,
    status: slot.status,
    origin: slot.origin
      ? { zipCode: slot.origin.zipCode ?? null, address: slot.origin.address ?? null }
      : null,
    note: slot.note ?? null,
  };
}

export function serializeBooking(booking: Booking, provider?: Provider) {
  return {
    ...booking,
    serviceLabel: getServiceType(booking.serviceType).label,
    ...(provider ? { provider: providerWithContact(provider) } : {}),
  };
}

export function serializeCandidate(candidate: Candidate) {
  return {
    provider: publicProvider(candidate.provider),
    slotId: candidate.slot.id,
    startsAt: candidate.startsAt,
    endsAt: candidate.endsAt,
    distanceKm: Math.round(candidate.distanceKm * 10) / 10,
    rateType: candidate.offering.rateType,
    estimatedCostUsd: candidate.estimatedCostUsd,
    score: candidate.score,
    recentRideCount: candidate.recentRideCount,
    withinFairnessGuardrail: candidate.withinFairnessGuardrail,
    scoreBreakdown: candidate.scoreBreakdown,
  };
}
