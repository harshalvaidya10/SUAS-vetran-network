import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { store } from '../data/store.js';
import { countRecentBookings, findMatches, type MatchCriteria } from '../domain/matching.js';
import { getServiceType } from '../domain/serviceCatalog.js';
import { getZipCoordinates, normalizeZipCode } from '../domain/zipGeo.js';
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
export async function handleServiceRequest(req: Request, res: Response) {
  const idempotencyKey = req.header('Idempotency-Key');
  if (idempotencyKey) {
    const previous = await store.findIdempotentRequest(idempotencyKey);
    if (previous) {
      const booking = previous.bookingId ? await store.getBooking(previous.bookingId) : undefined;
      res.status(200).json({
        requestId: previous.id,
        status: previous.status,
        replayed: true,
        booking: booking ? serializeBooking(booking, await store.getProvider(booking.providerId)) : null,
        veteran: booking ? rideVeteran(await store.getProvider(booking.providerId)) : null,
        match: null,
        alternatives: [],
      });
      return;
    }
  }

  const input = parse(serviceRequestSchema, req.body);
  const now = new Date();
  const pickupZip = normalizeZipCode(input.pickupZip);
  const pickupCoordinates = getZipCoordinates(pickupZip);
  if (!pickupCoordinates) {
    throw ApiError.badRequest(
      `ZIP code ${pickupZip} is not in the demo geography yet. Try a supported San Diego or Bay Area ZIP.`,
      [{ field: 'pickupZip', message: 'Unknown ZIP code' }],
    );
  }
  const location = {
    ...(input.location ?? pickupCoordinates),
    zipCode: pickupZip,
    ...(input.pickupAddress ? { address: input.pickupAddress } : {}),
  };

  const windowStartsAt = input.window?.startsAt ? new Date(input.window.startsAt) : now;
  const windowEndsAt = input.window?.endsAt
    ? new Date(input.window.endsAt)
    : new Date(windowStartsAt.getTime() + DEFAULT_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  if (windowEndsAt <= windowStartsAt) {
    throw ApiError.badRequest('window.endsAt must be after window.startsAt');
  }

  if (windowStartsAt.getTime() < now.getTime()) {
    throw ApiError.badRequest('The requested pickup time cannot be in the past.', [
      { field: 'window.startsAt', message: 'Choose a future pickup time' },
    ]);
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
    pickupZip,
    location,
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

  const providers = await store.listProviders();
  const result = findMatches(criteria, {
    providers,
    slots: await store.listSlots(),
    bookings: await store.listBookings(),
    recentBookingCounts: countRecentBookings(await store.listBookings(), now),
    allowSlotReuse: config.demoReusableSlots,
    now,
  });

  const diagnostics = {
    providersConsidered: providers.length,
    matchedProviders: result.matchedProviders,
    rejections: result.rejections,
  };

  if (result.candidates.length === 0) {
    const record = await store.createRequest({
      serviceType: input.serviceType,
      requester: input.requester,
      location,
      pickupZip,
      ...(input.destination ? { destination: input.destination } : {}),
      windowStartsAt: criteria.windowStartsAt,
      windowEndsAt: criteria.windowEndsAt,
      durationMinutes,
      status: 'no_match',
      candidatesConsidered: 0,
    });
    if (idempotencyKey) await store.rememberIdempotentRequest(idempotencyKey, record.id);

    res.status(200).json({
      requestId: record.id,
      status: 'no_match',
      message: noMatchAdvice(result.rejections),
      booking: null,
      veteran: null,
      match: null,
      alternatives: [],
      diagnostics,
    });
    return;
  }

  const [best, ...rest] = result.candidates;

  if (!input.autoBook) {
    const record = await store.createRequest({
      serviceType: input.serviceType,
      requester: input.requester,
      location,
      pickupZip,
      ...(input.destination ? { destination: input.destination } : {}),
      windowStartsAt: criteria.windowStartsAt,
      windowEndsAt: criteria.windowEndsAt,
      durationMinutes,
      status: 'matched',
      candidatesConsidered: result.candidates.length,
    });
    if (idempotencyKey) await store.rememberIdempotentRequest(idempotencyKey, record.id);

    res.status(200).json({
      requestId: record.id,
      status: 'matched',
      booking: null,
      veteran: null,
      match: serializeCandidate(best!),
      alternatives: rest.map(serializeCandidate),
      diagnostics,
    });
    return;
  }

  // Re-run every hard filter against current state, then claim synchronously.
  // If the top driver changed state, try the next ranked alternative.
  let chosen = best;
  let chosenIndex = -1;
  let slot: Awaited<ReturnType<typeof store.getSlot>>;
  for (const [index, candidate] of result.candidates.entries()) {
    // Keep the original receipt instant for realtime requests. Milliseconds
    // spent reading/revalidating state must not turn "right now" into "past".
    const currentNow = now;
    const currentBookings = await store.listBookings();
    const revalidated = findMatches(
      { ...criteria, providerId: candidate.provider.id, limit: 1 },
      {
        providers: await store.listProviders(),
        slots: await store.listSlots(),
        bookings: currentBookings,
        recentBookingCounts: countRecentBookings(currentBookings, currentNow),
        allowSlotReuse: config.demoReusableSlots,
        now: currentNow,
      },
    ).candidates[0];
    if (!revalidated || revalidated.slot.id !== candidate.slot.id) continue;
    // Demo mode leaves the block open so the next identical request can match
    // the same driver again; otherwise the claim is what stops two riders being
    // promised one veteran.
    const claimed = config.demoReusableSlots
      ? revalidated.slot
      : await store.claimOpenSlot(revalidated.slot.id);
    if (!claimed) continue;
    chosen = revalidated;
    chosenIndex = index;
    slot = claimed;
    break;
  }
  if (!chosen || !slot) {
    throw ApiError.conflict('Driver availability changed before booking. Retry for a fresh match.');
  }

  const record = await store.createRequest({
    serviceType: input.serviceType,
    requester: input.requester,
    location,
    pickupZip,
    ...(input.destination ? { destination: input.destination } : {}),
    windowStartsAt: criteria.windowStartsAt,
    windowEndsAt: criteria.windowEndsAt,
    durationMinutes,
    status: 'matched',
    candidatesConsidered: result.candidates.length,
  });

  const booking = await store.createBooking({
    requestId: record.id,
    slotId: slot.id,
    providerId: chosen.provider.id,
    serviceType: input.serviceType,
    requester: input.requester,
    location,
    ...(input.destination ? { destination: input.destination } : {}),
    startsAt: chosen.startsAt,
    endsAt: chosen.endsAt,
    status: 'confirmed',
    estimatedCostUsd: chosen.estimatedCostUsd,
    matchScore: chosen.score,
    ...(input.notes ? { notes: input.notes } : {}),
  });

  await store.updateRequest(record.id, { bookingId: booking.id });
  if (idempotencyKey) await store.rememberIdempotentRequest(idempotencyKey, record.id);

  res.status(201).json({
    requestId: record.id,
    status: 'matched',
    booking: serializeBooking(booking, chosen.provider),
    veteran: rideVeteran(chosen.provider),
    match: serializeCandidate(chosen),
    alternatives: result.candidates.slice(chosenIndex + 1).map(serializeCandidate),
    diagnostics,
  });
}

serviceRequestsRouter.post('/', handleServiceRequest);

/** GET /api/v1/service-requests/:id — what happened to an earlier request. */
serviceRequestsRouter.get('/:id', async (req, res) => {
  const record = await store.getRequest(String(req.params.id));
  if (!record) throw ApiError.notFound('No such service request.');

  const booking = record.bookingId ? await store.getBooking(record.bookingId) : undefined;
  res.json({
    request: record,
    booking: booking ? serializeBooking(booking, await store.getProvider(booking.providerId)) : null,
  });
});

/**
 * Turns the rejection tally into one sentence a person can act on. Reasons are
 * ranked by how fixable they are, not by how many veterans hit them: "nobody
 * within 20km" is more useful to the requester than "most of the roster does
 * something else for a living".
 */
const ADVICE_PRECEDENCE = [
  'ride_exceeds_slot',
  'no_valid_availability',
  'no_open_slot',
  'overlapping_booking',
  'outside_search_radius',
  'invalid_zip',
  'rating_below_minimum',
  'branch_mismatch',
  'rate_too_high',
  'service_not_offered',
  'inactive_or_unverified',
] as const;

function noMatchAdvice(rejections: Record<string, number>): string {
  const top = ADVICE_PRECEDENCE.find((reason) => (rejections[reason] ?? 0) > 0);

  switch (top) {
    case 'ride_exceeds_slot':
      return 'A driver is available at pickup time, but the ride would end after their committed availability block.';
    case 'no_valid_availability':
      return 'No verified veteran driver has an availability block that fully covers the requested ride.';
    case 'no_open_slot':
      return 'Drivers offer rides, but none has an open availability block for that pickup time.';
    case 'overlapping_booking':
      return 'Nearby drivers are already committed to another ride at that time.';
    case 'outside_search_radius':
      return 'The veterans who offer this are outside your distance limit. Try searching a wider radius.';
    case 'invalid_zip':
      return 'A driver location could not be mapped safely. Try another pickup ZIP.';
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

function rideVeteran(provider: Awaited<ReturnType<typeof store.getProvider>>) {
  if (!provider) return null;
  return {
    name: provider.name,
    carModel: provider.vehicle?.model ?? null,
    licensePlate: provider.vehicle?.licensePlate ?? null,
    zipCode: provider.zipCode ?? provider.base.zipCode ?? null,
  };
}
