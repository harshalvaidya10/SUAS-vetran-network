import assert from 'node:assert/strict';
import { test } from 'node:test';
import { store } from './data/store.js';
import { releaseUnclaimedBlocks } from './reconcileBlocks.js';

async function driver() {
  return store.createProvider({
    name: 'Reconcile Driver',
    branch: 'army',
    yearsOfService: 6,
    bio: '',
    email: 'reconcile@example.com',
    phone: '+1-619-555-0311',
    base: { lat: 32.719, lng: -117.1628 },
    zipCode: '92101',
    serviceRadiusKm: 40,
    vehicle: { model: 'Toyota Camry', licensePlate: 'RECON01' },
    offerings: [{ serviceType: 'rides', rateType: 'volunteer', hourlyRateUsd: 0 }],
    rating: null,
    completedJobs: 0,
    verified: true,
    active: true,
  });
}

async function heldBlockWithRide(status: 'confirmed' | 'completed' | 'cancelled') {
  const provider = await driver();
  const startsAt = new Date(Date.now() - 3_600_000).toISOString();
  const endsAt = new Date(Date.now() + 3 * 3_600_000).toISOString();
  const slot = await store.createSlot({
    providerId: provider.id,
    startsAt,
    endsAt,
    serviceTypes: ['rides'],
    // The state a pre-fix completion left behind.
    status: 'booked',
  });
  const request = await store.createRequest({
    serviceType: 'rides',
    requester: { name: 'Rider', veteran: true, phone: '+1-619-555-0322' },
    location: { lat: 32.719, lng: -117.1628 },
    pickupZip: '92101',
    windowStartsAt: startsAt,
    windowEndsAt: endsAt,
    durationMinutes: 60,
    status: 'matched',
    candidatesConsidered: 1,
  });
  await store.createBooking({
    requestId: request.id,
    slotId: slot.id,
    providerId: provider.id,
    serviceType: 'rides',
    requester: { name: 'Rider', veteran: true, phone: '+1-619-555-0322' },
    location: { lat: 32.719, lng: -117.1628 },
    startsAt,
    endsAt: new Date(Date.now()).toISOString(),
    status,
    estimatedCostUsd: 0,
    matchScore: 90,
  });
  return slot;
}

test('a block held for a finished ride is handed back', async () => {
  await store.reset();
  const slot = await heldBlockWithRide('completed');

  assert.equal(await releaseUnclaimedBlocks(), 1);
  assert.equal((await store.getSlot(slot.id))?.status, 'open');
});

test('a block held for a cancelled ride is handed back', async () => {
  await store.reset();
  const slot = await heldBlockWithRide('cancelled');

  assert.equal(await releaseUnclaimedBlocks(), 1);
  assert.equal((await store.getSlot(slot.id))?.status, 'open');
});

test('a block someone is still waiting on stays held', async () => {
  await store.reset();
  const slot = await heldBlockWithRide('confirmed');

  assert.equal(await releaseUnclaimedBlocks(), 0);
  assert.equal((await store.getSlot(slot.id))?.status, 'booked');
});

test('a block that has already ended is left alone as history', async () => {
  await store.reset();
  const provider = await driver();
  const slot = await store.createSlot({
    providerId: provider.id,
    startsAt: new Date(Date.now() - 5 * 3_600_000).toISOString(),
    endsAt: new Date(Date.now() - 3_600_000).toISOString(),
    serviceTypes: ['rides'],
    status: 'booked',
  });

  assert.equal(await releaseUnclaimedBlocks(), 0);
  assert.equal((await store.getSlot(slot.id))?.status, 'booked', 'past blocks are not rewritten');
  await store.reset();
});
