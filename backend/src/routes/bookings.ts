import { Router } from 'express';
import { store } from '../data/store.js';
import { ApiError } from '../http/errors.js';
import { serializeBooking } from '../http/serialize.js';
import { bookingUpdateSchema, parse } from '../http/validation.js';
import { requireOwnership, requireVeteranSession, type AuthedRequest } from '../http/authGuards.js';

export const bookingsRouter: Router = Router();

bookingsRouter.get('/:id', async (req, res) => {
  const booking = await store.getBooking(String(req.params.id));
  if (!booking) throw ApiError.notFound('No such booking.');
  res.json({ booking: serializeBooking(booking, await store.getProvider(booking.providerId)) });
});

/**
 * PATCH /api/v1/bookings/:id — mark the job done or call it off. Completing a
 * job is what grows a veteran's track record; cancelling releases the slot back
 * to the network so someone else can use it.
 */
bookingsRouter.patch('/:id', requireVeteranSession, async (req: AuthedRequest, res) => {
  const booking = await store.getBooking(String(req.params.id));
  if (!booking) throw ApiError.notFound('No such booking.');
  requireOwnership(req, booking.providerId);
  if (booking.status !== 'confirmed') {
    throw ApiError.conflict(`This booking is already ${booking.status}.`);
  }

  const { status } = parse(bookingUpdateSchema, req.body);
  const updated = (await store.updateBooking(booking.id, { status }))!;

  if (status === 'completed') {
    const provider = await store.getProvider(booking.providerId);
    if (provider) {
      await store.updateProvider(provider.id, { completedJobs: provider.completedJobs + 1 });
    }
  }

  // Either way the ride is over, so the rest of the block goes back to the
  // driver: still matchable, and withdrawable again. Without this, finishing a
  // ride left the block held for good -- nobody counting on it, but no way to
  // give it up either.
  const slot = await store.getSlot(booking.slotId);
  if (slot && slot.status === 'booked' && new Date(slot.endsAt).getTime() > Date.now()) {
    await store.updateSlot(slot.id, { status: 'open' });
  }

  res.json({ booking: serializeBooking(updated, await store.getProvider(updated.providerId)) });
});
