import { Router } from 'express';
import { store } from '../data/store.js';
import { countRecentBookings, findMatchesTiered, type MatchCriteria } from '../domain/matching.js';
import { getServiceType } from '../domain/serviceCatalog.js';
import { MAX_PICKUP_MILES } from '../domain/distancePolicy.js';
import { ApiError } from '../http/errors.js';
import { parse, serviceRequestSchema } from '../http/validation.js';
import { serializeBooking, serializeCandidate } from '../http/serialize.js';

const DEFAULT_WINDOW_DAYS = 7;

export const serviceRequestsRouter: Router = Router();

/**
 * POST /api/v1/service-requests
 *
 * The single entry point for the requester side. One call searches the whole
 * veteran roster, intersects it with committed availability, ranks the matches
 * and (by default) books the best one — so the client never has to orchestrate
 * a search-then-book handshake of its own.
 */
serviceRequestsRouter.post('/', (req, res) => {
  const idempotencyKey = req.header('Idempotency-Key');
  if (idempotencyKey) {
    const previous = store.findIdempotentRequest(idempotencyKey);
    if (previous) {
      const booking = previous.bookingId ? store.getBooking(previous.bookingId) : undefined;
      res.status(200).json({
        requestId: previous.id,
        status: previous.status,
        replayed: true,
        booking: booking ? serializeBooking(booking, store.getProvider(booking.providerId)) : null,
        match: null,
        alternatives: [],
      });
      return;
    }
  }

  const input = parse(serviceRequestSchema, req.body);
  const now = new Date();

  const windowStartsAt = input.window?.startsAt ? new Date(input.window.startsAt) : now;
  const windowEndsAt = input.window?.endsAt
    ? new Date(input.window.endsAt)
    : new Date(windowStartsAt.getTime() + DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  if (windowEndsAt <= windowStartsAt) {
    throw ApiError.badRequest('window.endsAt must be after window.startsAt');
  }

  const durationMinutes =
    input.durationMinutes ?? getServiceType(input.serviceType).defaultDurationMinutes;

  if (windowEndsAt.getTime() - windowStartsAt.getTime() < durationMinutes * 60_000) {
    throw ApiError.badRequest(
      `The window is shorter than the ${durationMinutes} minutes this service needs.`,
    );
  }

  const criteria: MatchCriteria = {
    serviceType: input.serviceType,
    location: input.location,
    windowStartsAt: windowStartsAt.toISOString(),
    windowEndsAt: windowEndsAt.toISOString(),
    durationMinutes,
    maxDistanceKm: input.maxDistanceKm,
    limit: input.limit,
    ...(input.preferences.minRating !== undefined ? { minRating: input.preferences.minRating } : {}),
    ...(input.preferences.branch ? { preferredBranch: input.preferences.branch } : {}),
    ...(input.preferences.maxHourlyRateUsd !== undefined
      ? { maxHourlyRateUsd: input.preferences.maxHourlyRateUsd }
      : {}),
    ...(input.preferences.volunteerOnly !== undefined
      ? { volunteerOnly: input.preferences.volunteerOnly }
      : {}),
    ...(input.preferences.providerId ? { providerId: input.preferences.providerId } : {}),
  };

  const providers = store.listProviders();
  const result = findMatchesTiered(criteria, {
    providers,
    slots: store.listSlots({ status: 'open' }),
    recentBookingCounts: countRecentBookings(store.listBookings(), now),
    now,
  });

  const diagnostics = {
    providersConsidered: providers.length,
    matchedProviders: result.matchedProviders,
    // How far out we had to look before finding anyone.
    searchRadiusMiles: result.searchRadiusMiles,
    rejections: result.rejections,
  };

  if (result.candidates.length === 0) {
    const record = store.createRequest({
      serviceType: input.serviceType,
      requester: input.requester,
      location: input.location,
      windowStartsAt: criteria.windowStartsAt,
      windowEndsAt: criteria.windowEndsAt,
      durationMinutes,
      status: 'no_match',
      candidatesConsidered: 0,
    });
    if (idempotencyKey) store.rememberIdempotentRequest(idempotencyKey, record.id);

    res.status(200).json({
      requestId: record.id,
      status: 'no_match',
      message: noMatchAdvice(result.rejections),
      booking: null,
      match: null,
      alternatives: [],
      diagnostics,
    });
    return;
  }

  const [best, ...rest] = result.candidates;

  if (!input.autoBook) {
    const record = store.createRequest({
      serviceType: input.serviceType,
      requester: input.requester,
      location: input.location,
      windowStartsAt: criteria.windowStartsAt,
      windowEndsAt: criteria.windowEndsAt,
      durationMinutes,
      status: 'matched',
      candidatesConsidered: result.candidates.length,
    });
    if (idempotencyKey) store.rememberIdempotentRequest(idempotencyKey, record.id);

    res.status(200).json({
      requestId: record.id,
      status: 'matched',
      booking: null,
      match: serializeCandidate(best!),
      alternatives: rest.map(serializeCandidate),
      diagnostics,
    });
    return;
  }

  // Re-read the slot before claiming it: another request may have taken it
  // between the match pass and now.
  const slot = store.getSlot(best!.slot.id);
  if (!slot || slot.status !== 'open') {
    throw ApiError.conflict('That veteran was just booked. Retry the request for a new match.');
  }
  store.updateSlot(slot.id, { status: 'booked' });

  const record = store.createRequest({
    serviceType: input.serviceType,
    requester: input.requester,
    location: input.location,
    windowStartsAt: criteria.windowStartsAt,
    windowEndsAt: criteria.windowEndsAt,
    durationMinutes,
    status: 'matched',
    candidatesConsidered: result.candidates.length,
  });

  const booking = store.createBooking({
    requestId: record.id,
    slotId: slot.id,
    providerId: best!.provider.id,
    serviceType: input.serviceType,
    requester: input.requester,
    location: input.location,
    startsAt: best!.startsAt,
    endsAt: best!.endsAt,
    status: 'confirmed',
    estimatedCostUsd: best!.estimatedCostUsd,
    matchScore: best!.score,
    ...(input.notes ? { notes: input.notes } : {}),
  });

  store.updateRequest(record.id, { bookingId: booking.id });
  if (idempotencyKey) store.rememberIdempotentRequest(idempotencyKey, record.id);

  res.status(201).json({
    requestId: record.id,
    status: 'matched',
    booking: serializeBooking(booking, best!.provider),
    match: serializeCandidate(best!),
    alternatives: rest.map(serializeCandidate),
    diagnostics,
  });
});

/** GET /api/v1/service-requests/:id — what happened to an earlier request. */
serviceRequestsRouter.get('/:id', (req, res) => {
  const record = store.getRequest(String(req.params.id));
  if (!record) throw ApiError.notFound('No such service request.');

  const booking = record.bookingId ? store.getBooking(record.bookingId) : undefined;
  res.json({
    request: record,
    booking: booking ? serializeBooking(booking, store.getProvider(booking.providerId)) : null,
  });
});

/**
 * Turns the rejection tally into one sentence a person can act on. Reasons are
 * ranked by how fixable they are, not by how many veterans hit them: "nobody
 * within 20km" is more useful to the requester than "most of the roster does
 * something else for a living".
 */
const ADVICE_PRECEDENCE = [
  'no_overlapping_slot',
  'out_of_range',
  'rating_below_minimum',
  'branch_mismatch',
  'rate_too_high',
  'service_not_offered',
  'inactive_or_unverified',
] as const;

function noMatchAdvice(rejections: Record<string, number>): string {
  const top = ADVICE_PRECEDENCE.find((reason) => (rejections[reason] ?? 0) > 0);

  switch (top) {
    case 'no_overlapping_slot':
      return 'Veterans nearby offer this, but nobody has committed to a slot in your window. Try widening the time range.';
    case 'out_of_range':
      // The ceiling is ours, not theirs — don't suggest a knob they can't turn.
      return `The nearest veteran is further than ${MAX_PICKUP_MILES} miles away, which is past how far we will ask someone to drive to a pickup.`;
    case 'service_not_offered':
      return 'No one on the network offers this service yet.';
    case 'rating_below_minimum':
    case 'branch_mismatch':
    case 'rate_too_high':
      return 'Your preferences ruled out every available veteran. Try relaxing them.';
    default:
      return 'No veteran is available for that request right now.';
  }
}
