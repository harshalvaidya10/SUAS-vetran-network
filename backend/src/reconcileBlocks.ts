import { store } from './data/store.js';

/**
 * Returns any block to its driver that nobody is actually waiting on.
 *
 * A block is marked `booked` when a ride is assigned. If that ride later ends —
 * completed or cancelled — the block should come back. The completion path does
 * that now, but blocks whose rides finished before it did are still sitting at
 * `booked`, and a `booked` block is excluded from matching: the driver is
 * silently unavailable for the rest of their own committed hours, with no way to
 * tell from the dashboard beyond a status that reads wrong.
 *
 * So this reconciles on read rather than only at the moment a ride ends, which
 * is what heals the blocks already stuck. It is not demo behaviour and is always
 * on: an unclaimed block being unmatchable is simply incorrect.
 */
export async function releaseUnclaimedBlocks(now: Date = new Date()): Promise<number> {
  const heldBlocks = (await store.listSlots({ status: 'booked' })).filter(
    (slot) => new Date(slot.endsAt).getTime() > now.getTime(),
  );
  if (heldBlocks.length === 0) return 0;

  const bookings = await store.listBookings({ status: 'confirmed' });
  const awaited = new Set(bookings.map((booking) => booking.slotId));

  let released = 0;
  for (const slot of heldBlocks) {
    if (awaited.has(slot.id)) continue;
    await store.updateSlot(slot.id, { status: 'open' });
    released += 1;
  }
  return released;
}
