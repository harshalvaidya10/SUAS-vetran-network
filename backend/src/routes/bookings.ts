import { Router } from 'express';
import { store } from '../data/store.js';
import { ApiError } from '../http/errors.js';
import { serializeBooking } from '../http/serialize.js';
import { bookingUpdateSchema, parse } from '../http/validation.js';

export const bookingsRouter: Router = Router();

bookingsRouter.get('/:id', (req, res) => {
  const booking = store.getBooking(String(req.params.id));
  if (!booking) throw ApiError.notFound('No such booking.');
  res.json({ booking: serializeBooking(booking, store.getProvider(booking.providerId)) });
});

/**
 * PATCH /api/v1/bookings/:id — mark the job done or call it off. Completing a
 * job is what grows a veteran's track record; cancelling releases the slot back
 * to the network so someone else can use it.
 */
bookingsRouter.patch('/:id', (req, res) => {
  const booking = store.getBooking(String(req.params.id));
  if (!booking) throw ApiError.notFound('No such booking.');
  if (booking.status !== 'confirmed') {
    throw ApiError.conflict(`This booking is already ${booking.status}.`);
  }

  const { status } = parse(bookingUpdateSchema, req.body);
  const updated = store.updateBooking(booking.id, { status })!;

  if (status === 'completed') {
    const provider = store.getProvider(booking.providerId);
    if (provider) {
      store.updateProvider(provider.id, { completedJobs: provider.completedJobs + 1 });
    }
  } else {
    const slot = store.getSlot(booking.slotId);
    if (slot && slot.status === 'booked' && new Date(slot.endsAt).getTime() > Date.now()) {
      store.updateSlot(slot.id, { status: 'open' });
    }
  }

  res.json({ booking: serializeBooking(updated, store.getProvider(updated.providerId)) });
});
