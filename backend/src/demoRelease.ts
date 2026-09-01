import { config } from './config.js';
import { store } from './data/store.js';

/**
 * Demo housekeeping: a ride is treated as finished `demoSlotReleaseMinutes`
 * after it was booked. The booking is completed and the availability block goes
 * back to the driver, so a demo can fire the same request over and over and
 * keep getting a real match instead of exhausting the roster after one ride.
 *
 * The point of doing it this way is that the locking stays honest. A booking
 * still claims its block atomically and a driver still can't be promised to two
 * riders at once — the block simply comes back when the simulated ride is over,
 * exactly as it would when a real driver marks the job done.
 *
 * Swept lazily on request rather than on a timer: this API runs as serverless
 * functions, where a `setTimeout` does not outlive the response that scheduled
 * it.
 */
export async function releaseFinishedDemoRides(now: Date = new Date()): Promise<number> {
  const minutes = config.demoSlotReleaseMinutes;
  if (minutes <= 0) return 0;

  const cutoff = now.getTime() - minutes * 60_000;
  const confirmed = await store.listBookings({ status: 'confirmed' });
  let released = 0;

  for (const booking of confirmed) {
    const bookedAt = new Date(booking.createdAt).getTime();
    if (!Number.isFinite(bookedAt) || bookedAt > cutoff) continue;

    // Same end state the driver's own "mark it done" produces.
    await store.updateBooking(booking.id, { status: 'completed' });
    const provider = await store.getProvider(booking.providerId);
    if (provider) {
      await store.updateProvider(provider.id, { completedJobs: provider.completedJobs + 1 });
    }

    const slot = await store.getSlot(booking.slotId);
    if (slot?.status === 'booked') {
      await store.updateSlot(slot.id, { status: 'open' });
    }
    released += 1;
  }

  return released;
}
