import { Router } from 'express';
import { config } from '../config.js';
import { store } from '../data/store.js';
import { isServiceTypeId } from '../domain/serviceCatalog.js';
import { getZipCoordinates, normalizeZipCode } from '../domain/zipGeo.js';
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
      `We're only running in San Diego County right now, and ${zipCode} isn't in our service area yet.`,
    );
  }
  return point;
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
  const patch = parse(providerUpdateSchema, req.body);

  // Changing ZIP moves the point they're matched from.
  const zipCode = patch.zipCode ? normalizeZipCode(patch.zipCode) : null;
  const updated = (await store.updateProvider(provider.id, {
    ...patch,
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
  if (slot.status === 'booked') {
    throw ApiError.conflict('Someone is counting on that slot. Cancel the booking instead.');
  }

  const cancelled = (await store.updateSlot(slot.id, { status: 'cancelled' }))!;
  res.json({ slot: serializeSlot(cancelled) });
});

providersRouter.get('/:id/bookings', async (req, res) => {
  const provider = await requireProvider(req.params.id);
  const bookings = (await store.listBookings({ providerId: provider.id }))
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));

  res.json({ bookings: bookings.map((booking) => serializeBooking(booking)) });
});
