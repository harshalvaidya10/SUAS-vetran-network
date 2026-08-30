import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../app.js';
import { config } from '../config.js';
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
    await store.reset();
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
  // The claim is what stops two riders being promised one veteran, so this
  // asserts the real behaviour even when the demo default is relaxed.
  const demo = config.demoReusableSlots;
  config.demoReusableSlots = false;
  try {
  await withServer(async (baseUrl) => {
    await store.reset();
    const startsAt = new Date(Date.now() + 2 * 3_600_000);
    startsAt.setMilliseconds(0);
    const rideEndsAt = new Date(startsAt.getTime() + 3_600_000);
    const slotEndsAt = new Date(startsAt.getTime() + 2 * 3_600_000);
    const provider = await store.createProvider({
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
    const slot = await store.createSlot({
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
    assert.equal((await store.listBookings()).length, 1);
    assert.equal((await store.getSlot(slot.id))?.status, 'booked');

    const competing = await send('different-request');
    const competingPayload = (await competing.json()) as { status: string; booking: unknown };
    assert.equal(competing.status, 200);
    assert.equal(competingPayload.status, 'no_match');
    assert.equal(competingPayload.booking, null);
    assert.equal((await store.listBookings()).length, 1);
  });
  } finally {
    config.demoReusableSlots = demo;
  }
});

test('demo mode keeps the block open so the same driver can be matched again', async () => {
  const demo = config.demoReusableSlots;
  config.demoReusableSlots = true;
  try {
    await withServer(async (baseUrl) => {
      await store.reset();
      const startsAt = new Date(Date.now() + 2 * 3_600_000);
      startsAt.setMilliseconds(0);
      const rideEndsAt = new Date(startsAt.getTime() + 3_600_000);
      const provider = await store.createProvider({
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
      const slot = await store.createSlot({
        providerId: provider.id,
        startsAt: new Date(startsAt.getTime() - 3_600_000).toISOString(),
        endsAt: new Date(startsAt.getTime() + 2 * 3_600_000).toISOString(),
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

      const first = (await (await send('demo-one')).json()) as {
        status: string;
        booking: { id: string; providerId: string };
      };
      assert.equal(first.status, 'matched');

      // A brand-new key, so no idempotent replay: this has to be a fresh match.
      const second = (await (await send('demo-two')).json()) as {
        status: string;
        replayed?: boolean;
        booking: { id: string; providerId: string };
      };
      assert.equal(second.status, 'matched');
      assert.notEqual(second.replayed, true);
      assert.notEqual(second.booking.id, first.booking.id);
      assert.equal(second.booking.providerId, first.booking.providerId, 'same driver again');

      assert.equal((await store.listBookings()).length, 2);
      assert.equal((await store.getSlot(slot.id))?.status, 'open', 'block was never consumed');
    });
  } finally {
    config.demoReusableSlots = demo;
  }
});

test('realtime ride request matches current ZIP and returns vehicle identity', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    const now = Date.now();
    const provider = await store.createProvider({
      name: 'Realtime Driver',
      branch: 'navy',
      yearsOfService: 6,
      bio: '',
      email: 'realtime@example.com',
      phone: '+1-619-555-0123',
      vehicle: { model: '2022 Toyota RAV4', licensePlate: '8VET123' },
      base: { lat: 32.7157, lng: -117.1611 },
      zipCode: '92101',
      serviceRadiusKm: 40,
      offerings: [{ serviceType: 'rides', rateType: 'volunteer', hourlyRateUsd: 0 }],
      rating: 4.9,
      completedJobs: 2,
      verified: true,
      active: true,
    });
    await store.createSlot({
      providerId: provider.id,
      startsAt: new Date(now - 30 * 60_000).toISOString(),
      endsAt: new Date(now + 2 * 60 * 60_000).toISOString(),
      serviceTypes: ['rides'],
      status: 'open',
    });

    const response = await fetch(`${baseUrl}/api/v1/ride-requests`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rider: { name: 'Realtime Rider', veteran: true, phone: '+1-619-555-0999' },
        currentAddress: { address: '100 Broadway', zipCode: '92101' },
        destinationAddress: { address: '3350 La Jolla Village Drive', zipCode: '92161' },
        durationMinutes: 60,
      }),
    });
    assert.equal(response.status, 201);
    const payload = (await response.json()) as {
      veteran: { name: string; carModel: string; licensePlate: string; zipCode: string };
      booking: { destination: { zipCode: string } };
    };
    assert.deepEqual(payload.veteran, {
      name: 'Realtime Driver',
      carModel: '2022 Toyota RAV4',
      licensePlate: '8VET123',
      zipCode: '92101',
    });
    assert.equal(payload.booking.destination.zipCode, '92161');
  });
});
