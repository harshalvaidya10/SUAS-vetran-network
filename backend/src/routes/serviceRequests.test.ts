import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../app.js';
import { config } from '../config.js';
import { store } from '../data/store.js';
import { issueSession } from '../http/authGuards.js';
import { releaseFinishedDemoRides } from '../demoRelease.js';

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
});

test('a demo ride finishes on a timer and hands the block back', async () => {
  const release = config.demoSlotReleaseMinutes;
  config.demoSlotReleaseMinutes = 5;
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

      const first = (await (await send('ride-one')).json()) as {
        status: string;
        booking: { id: string; providerId: string };
      };
      assert.equal(first.status, 'matched');

      // The lock is still real: while the ride is live nobody else gets it.
      assert.equal((await store.getSlot(slot.id))?.status, 'booked');
      const blocked = (await (await send('ride-two')).json()) as { status: string };
      assert.equal(blocked.status, 'no_match', 'block is held while the ride is running');

      // Five minutes on, the ride counts as finished.
      const released = await releaseFinishedDemoRides(new Date(Date.now() + 6 * 60_000));
      assert.equal(released, 1);
      assert.equal((await store.getSlot(slot.id))?.status, 'open', 'block came back');
      assert.equal((await store.getBooking(first.booking.id))?.status, 'completed');
      assert.equal((await store.getProvider(provider.id))?.completedJobs, 6, 'ride counted');

      const again = (await (await send('ride-three')).json()) as {
        status: string;
        booking: { id: string; providerId: string };
      };
      assert.equal(again.status, 'matched');
      assert.equal(again.booking.providerId, first.booking.providerId, 'same driver again');
      assert.notEqual(again.booking.id, first.booking.id);
    });
  } finally {
    config.demoSlotReleaseMinutes = release;
  }
});

test('the release is off when the interval is zero', async () => {
  const release = config.demoSlotReleaseMinutes;
  config.demoSlotReleaseMinutes = 0;
  try {
    assert.equal(await releaseFinishedDemoRides(new Date(Date.now() + 86_400_000)), 0);
  } finally {
    config.demoSlotReleaseMinutes = release;
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

test('finishing a ride hands the rest of the block back to the driver', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    const startsAt = new Date(Date.now() + 2 * 3_600_000);
    startsAt.setMilliseconds(0);
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

    const booked = (await (
      await fetch(`${baseUrl}/api/v1/service-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': 'finish-ride' },
        body: JSON.stringify(
          requestBody(startsAt.toISOString(), new Date(startsAt.getTime() + 3_600_000).toISOString()),
        ),
      })
    ).json()) as { booking: { id: string } };
    assert.equal((await store.getSlot(slot.id))?.status, 'booked');

    const { token } = await issueSession(provider.id);
    const signedIn = { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` };

    // A rider is still waiting, so the block is not the driver's to give up.
    const blocked = await fetch(`${baseUrl}/api/v1/providers/${provider.id}/slots/${slot.id}`, {
      method: 'DELETE',
      headers: signedIn,
    });
    assert.equal(blocked.status, 409);

    await fetch(`${baseUrl}/api/v1/bookings/${booked.booking.id}`, {
      method: 'PATCH',
      headers: signedIn,
      body: JSON.stringify({ status: 'completed' }),
    });

    assert.equal((await store.getSlot(slot.id))?.status, 'open', 'block came back');
    const withdrawn = await fetch(`${baseUrl}/api/v1/providers/${provider.id}/slots/${slot.id}`, {
      method: 'DELETE',
      headers: signedIn,
    });
    assert.equal(withdrawn.status, 200, 'and can now be withdrawn');
  });
});
