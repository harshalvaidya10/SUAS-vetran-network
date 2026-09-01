import { Router } from 'express';
import { config } from '../config.js';
import { store } from '../data/store.js';
import { releaseFinishedDemoRides } from '../demoRelease.js';
import { releaseUnclaimedBlocks } from '../reconcileBlocks.js';
import { isServiceTypeId } from '../domain/serviceCatalog.js';
import { getZipCoordinates, normalizeZipCode } from '../domain/zipGeo.js';
import { PILOT_TERMS_VERSION } from '../domain/pilotTerms.js';
import { ApiError } from '../http/errors.js';
import { providerWithContact, publicProvider, serializeBooking, serializeSlot } from '../http/serialize.js';
import { parse, providerCreateSchema, providerUpdateSchema, slotCreateSchema } from '../http/validation.js';
import { normalizePhone } from './auth.js';

export const providersRouter: Router = Router();

async function requireProvider(id: string | undefined) {
  const provider = id ? await store.getProvider(id) : undefined;
  if (!provider) throw ApiError.notFound('No such veteran on the network.');
  return provider;
}

/**
 * Turns a ZIP into the point we match from. Everything downstream still works
 * in coordinates; this is only about what we ask a person to type.
 */
function baseFromZip(zipCode: string) {
  const point = getZipCoordinates(zipCode);
  if (!point) {
    throw ApiError.badRequest(
      `ZIP code ${zipCode} isn't in our San Diego or Bay Area demo service area yet.`,
    );
  }
  return point;
}

/**
 * Records acceptance of the pilot terms, refusing a version we no longer serve
 * so nobody is enrolled against wording they were never shown.
 */
function consentFor(version: string) {
  if (version !== PILOT_TERMS_VERSION) {
    throw ApiError.badRequest(
      'The pilot terms have been updated. Reload the page and read them again before continuing.',
    );
  }
  return { version, acceptedAt: new Date().toISOString() };
}

/** POST /api/v1/providers — a veteran joins the network. */
providersRouter.post('/', async (req, res) => {
  const input = parse(providerCreateSchema, req.body);
  const zipCode = normalizeZipCode(input.zipCode);
  const point = baseFromZip(zipCode);
  const duplicatePhone = (await store.listProviders()).some(
    (provider) => normalizePhone(provider.phone) === normalizePhone(input.phone),
  );
  if (duplicatePhone) {
    throw ApiError.conflict('That phone number is already enrolled. Log in to manage its commitments.');
  }

  let provider;
  try {
    provider = await store.createProvider({
      ...input,
      pilotConsent: consentFor(input.pilotTermsVersion),
      zipCode,
      // An explicit base still wins if a caller sends one; otherwise the ZIP
      // centroid is the origin, and the ZIP is all the sign-up form collects.
      base: input.base ?? { ...point, address: zipCode },
      rating: null,
      completedJobs: 0,
      // Real deployments verify service (DD-214 / ID.me) before anyone is matched.
      // The bootstrap can auto-verify so the demo flow works end to end.
      verified: config.autoVerifyProviders,
      active: true,
    });
  } catch (error) {
    const databaseCode = (error as { code?: string }).code;
    if (databaseCode === '23505' || databaseCode === 'SQLITE_CONSTRAINT_UNIQUE') {
      throw ApiError.conflict('That phone number is already enrolled. Log in to manage its commitments.');
    }
    throw error;
  }

  res.status(201).json({ provider: providerWithContact(provider) });
});

/** GET /api/v1/providers?serviceType=rides — the roster. */
providersRouter.get('/', async (req, res) => {
  const serviceType = typeof req.query.serviceType === 'string' ? req.query.serviceType : undefined;
  if (serviceType && !isServiceTypeId(serviceType)) {
    throw ApiError.badRequest(`Unknown serviceType "${serviceType}".`);
  }

  const providers = (await store.listProviders())
    .filter((provider) => provider.active)
    .filter((provider) =>
      serviceType ? provider.offerings.some((o) => o.serviceType === serviceType) : true,
    );

  res.json({ providers: providers.map(publicProvider), count: providers.length });
});

providersRouter.get('/:id', async (req, res) => {
  const provider = await requireProvider(req.params.id);
  const slots = await store.listSlots({ providerId: provider.id, status: 'open' });
  res.json({ provider: publicProvider(provider), openSlots: slots.map(serializeSlot) });
});

providersRouter.patch('/:id', async (req, res) => {
  const provider = await requireProvider(req.params.id);

  // The phone number identifies the enrolment, so it can't be edited in place.
  // Say so rather than letting the schema drop it and reporting success.
  if (req.body && typeof req.body === 'object' && 'phone' in req.body) {
    throw ApiError.badRequest(
      'A phone number can\u2019t be changed here — it identifies this enrolment. ' +
        'Sign up again with the new number for now.',
    );
  }

  const patch = parse(providerUpdateSchema, req.body);

  // Changing ZIP moves the point they're matched from.
  const zipCode = patch.zipCode ? normalizeZipCode(patch.zipCode) : null;
  const updated = (await store.updateProvider(provider.id, {
    ...patch,
    ...(patch.pilotTermsVersion ? { pilotConsent: consentFor(patch.pilotTermsVersion) } : {}),
    ...(zipCode ? { zipCode, base: { ...baseFromZip(zipCode), address: zipCode } } : {}),
  }))!;
  res.json({ provider: providerWithContact(updated) });
});

/**
 * POST /api/v1/providers/:id/slots — the commitment. A slot is a promise to be
 * available, so it can only cover services the veteran actually offers and can't
 * overlap another commitment.
 */
providersRouter.post('/:id/slots', async (req, res) => {
  const provider = await requireProvider(req.params.id);
  const input = parse(slotCreateSchema, req.body);

  if (new Date(input.startsAt).getTime() < Date.now()) {
    throw ApiError.badRequest('Slots have to start in the future.');
  }

  const offered = new Set(provider.offerings.map((o) => o.serviceType));
  const unsupported = input.serviceTypes.filter((type) => !offered.has(type));
  if (unsupported.length > 0) {
    throw ApiError.badRequest(
      `Add these to your profile before committing slots for them: ${unsupported.join(', ')}.`,
    );
  }

  const startsAt = new Date(input.startsAt).getTime();
  const endsAt = new Date(input.endsAt).getTime();
  const clash = (await store.listSlots({ providerId: provider.id }))
    .filter((slot) => slot.status !== 'cancelled')
    .find(
      (slot) =>
        startsAt < new Date(slot.endsAt).getTime() && endsAt > new Date(slot.startsAt).getTime(),
    );
  if (clash) {
    throw ApiError.conflict(`That overlaps a slot you already committed to (${clash.startsAt}).`);
  }

  const slot = await store.createSlot({
    providerId: provider.id,
    startsAt: new Date(input.startsAt).toISOString(),
    endsAt: new Date(input.endsAt).toISOString(),
    serviceTypes: input.serviceTypes,
    status: 'open',
    ...(input.origin ? { origin: input.origin } : {}),
    ...(input.note ? { note: input.note } : {}),
  });

  res.status(201).json({ slot: serializeSlot(slot) });
});

providersRouter.get('/:id/slots', async (req, res) => {
  // So the dashboard shows blocks that came back when a demo ride finished.
  await releaseFinishedDemoRides();
  await releaseUnclaimedBlocks();
  const provider = await requireProvider(req.params.id);
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  if (status && !['open', 'booked', 'cancelled'].includes(status)) {
    throw ApiError.badRequest('status must be one of open, booked, cancelled.');
  }

  const slots = (await store.listSlots({
      providerId: provider.id,
      ...(status ? { status: status as 'open' | 'booked' | 'cancelled' } : {}),
    }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  res.json({ slots: slots.map(serializeSlot) });
});

/** DELETE /api/v1/providers/:id/slots/:slotId — withdraw an unbooked commitment. */
providersRouter.delete('/:id/slots/:slotId', async (req, res) => {
  const provider = await requireProvider(req.params.id);
  const slot = await store.getSlot(String(req.params.slotId));
  if (!slot || slot.providerId !== provider.id) throw ApiError.notFound('No such slot.');
  // What matters is whether a rider is still waiting on it, not the slot's
  // status: a block whose rides are all finished or cancelled is nobody's
  // expectation, and blocking on status alone stranded those blocks for good.
  const committedRides = (await store.listBookings({ providerId: provider.id })).filter(
    (booking) => booking.slotId === slot.id && booking.status === 'confirmed',
  );
  if (committedRides.length > 0) {
    throw ApiError.conflict(
      `${committedRides.length === 1 ? 'A rider is' : `${committedRides.length} riders are`} still counting on that block. Cancel the ride first.`,
    );
  }

  const cancelled = (await store.updateSlot(slot.id, { status: 'cancelled' }))!;
  res.json({ slot: serializeSlot(cancelled) });
});

providersRouter.get('/:id/bookings', async (req, res) => {
  // So the dashboard shows blocks that came back when a demo ride finished.
  await releaseFinishedDemoRides();
  await releaseUnclaimedBlocks();
  const provider = await requireProvider(req.params.id);
  const bookings = (await store.listBookings({ providerId: provider.id }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  res.json({ bookings: bookings.map((booking) => serializeBooking(booking)) });
});
