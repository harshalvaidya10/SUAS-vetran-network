import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../app.js';
import { store } from '../data/store.js';

async function withServer(run: (baseUrl: string) => Promise<void>): Promise<void> {
  const server = createApp().listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    store.reset();
  }
}

function requestBody(startsAt: string, endsAt: string) {
  return {
    serviceType: 'rides',
    pickupZip: '92101',
    location: { lat: 32.719, lng: -117.1628, address: 'Downtown San Diego' },
    requester: { name: 'Test Rider', veteran: true, phone: '+1-619-555-0199' },
    window: { startsAt, endsAt },
    durationMinutes: 60,
    maxDistanceKm: 40,
    autoBook: true,
  };
}

test('route validates pickup ZIP cleanly', async () => {
  await withServer(async (baseUrl) => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const end = new Date(Date.now() + 7_200_000).toISOString();

    for (const body of [
      { ...requestBody(future, end), pickupZip: undefined },
      { ...requestBody(future, end), pickupZip: '00000' },
      {
        ...requestBody(future, end),
        requester: { name: 'Test Rider', veteran: false, phone: '+1-619-555-0199' },
      },
    ]) {
      const response = await fetch(`${baseUrl}/api/v1/service-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      assert.equal(response.status, 400);
      const payload = (await response.json()) as { error: { message: string } };
      assert.ok(payload.error.message.length > 0);
    }
  });
});

test('idempotency and synchronous slot claiming prevent double booking', async () => {
  await withServer(async (baseUrl) => {
    store.reset();
    const startsAt = new Date(Date.now() + 2 * 3_600_000);
    startsAt.setMilliseconds(0);
    const rideEndsAt = new Date(startsAt.getTime() + 3_600_000);
    const slotEndsAt = new Date(startsAt.getTime() + 2 * 3_600_000);
    const provider = store.createProvider({
      name: 'Driver One',
      branch: 'army',
      yearsOfService: 8,
      bio: '',
      email: 'driver@example.com',
      phone: '+1-619-555-0100',
      base: { lat: 32.719, lng: -117.1628 },
      zipCode: '92101',
      serviceRadiusKm: 40,
      offerings: [{ serviceType: 'rides', rateType: 'volunteer', hourlyRateUsd: 0 }],
      rating: 4.8,
      completedJobs: 5,
      verified: true,
      active: true,
    });
    const slot = store.createSlot({
      providerId: provider.id,
      startsAt: new Date(startsAt.getTime() - 3_600_000).toISOString(),
      endsAt: slotEndsAt.toISOString(),
      serviceTypes: ['rides'],
      status: 'open',
    });

    const body = requestBody(startsAt.toISOString(), rideEndsAt.toISOString());
    const send = (key: string) =>
      fetch(`${baseUrl}/api/v1/service-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
        body: JSON.stringify(body),
      });

    const first = await send('same-ride-request');
    assert.equal(first.status, 201);
    const firstPayload = (await first.json()) as { booking: { id: string } };

    const replay = await send('same-ride-request');
    assert.equal(replay.status, 200);
    const replayPayload = (await replay.json()) as { replayed: boolean; booking: { id: string } };
    assert.equal(replayPayload.replayed, true);
    assert.equal(replayPayload.booking.id, firstPayload.booking.id);
    assert.equal(store.listBookings().length, 1);
    assert.equal(store.getSlot(slot.id)?.status, 'booked');

    const competing = await send('different-request');
    const competingPayload = (await competing.json()) as { status: string; booking: unknown };
    assert.equal(competing.status, 200);
    assert.equal(competingPayload.status, 'no_match');
    assert.equal(competingPayload.booking, null);
    assert.equal(store.listBookings().length, 1);
  });
});
