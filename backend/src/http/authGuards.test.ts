import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../app.js';
import { config } from '../config.js';
import { store } from '../data/store.js';
import { issueSession } from './authGuards.js';
import { PILOT_TERMS_VERSION } from '../domain/pilotTerms.js';

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

async function enrol(phone: string) {
  return store.createProvider({
    name: 'Guarded Driver',
    branch: 'army',
    yearsOfService: 5,
    bio: '',
    email: `guarded.${phone.replace(/\D/g, '')}@example.com`,
    phone,
    base: { lat: 32.719, lng: -117.1628 },
    zipCode: '92101',
    serviceRadiusKm: 40,
    vehicle: { model: 'Toyota Camry', licensePlate: 'GUARD01' },
    offerings: [{ serviceType: 'rides', rateType: 'volunteer', hourlyRateUsd: 0 }],
    rating: null,
    completedJobs: 0,
    verified: true,
    active: true,
  });
}

const rideBody = {
  rider: { name: 'Some Rider', veteran: true, phone: '+1-619-555-0777' },
  currentAddress: { address: 'Downtown San Diego', zipCode: '92101' },
  destinationAddress: { address: 'VA Medical Center La Jolla', zipCode: '92037' },
  durationMinutes: 60,
};

// --- layer 1: which application is calling ---------------------------------

test('the demand side is open when no service token is configured', async () => {
  const tokens = config.serviceTokens;
  config.serviceTokens = [];
  try {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/v1/ride-requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(rideBody),
      });
      assert.notEqual(response.status, 401, 'local development needs no credential');
    });
  } finally {
    config.serviceTokens = tokens;
  }
});

test('a configured service token is required, and a wrong one refused', async () => {
  const tokens = config.serviceTokens;
  config.serviceTokens = ['rider-app-secret'];
  try {
    await withServer(async (baseUrl) => {
      const send = (headers: Record<string, string>) =>
        fetch(`${baseUrl}/api/v1/ride-requests`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...headers },
          body: JSON.stringify(rideBody),
        });

      assert.equal((await send({})).status, 401, 'no token');
      assert.equal((await send({ Authorization: 'Bearer nope' })).status, 401, 'wrong token');
      assert.notEqual(
        (await send({ Authorization: 'Bearer rider-app-secret' })).status,
        401,
        'the right token gets through',
      );
    });
  } finally {
    config.serviceTokens = tokens;
  }
});

test('reads a browser needs stay public even with a service token set', async () => {
  const tokens = config.serviceTokens;
  config.serviceTokens = ['rider-app-secret'];
  try {
    await withServer(async (baseUrl) => {
      for (const path of ['/health', '/api/v1/catalog', '/api/v1/providers']) {
        assert.equal((await fetch(`${baseUrl}${path}`)).status, 200, path);
      }
    });
  } finally {
    config.serviceTokens = tokens;
  }
});

// --- layer 2: which person is acting --------------------------------------

test('a veteran-owned write needs a session', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    const provider = await enrol('+1-619-555-0411');

    const response = await fetch(`${baseUrl}/api/v1/providers/${provider.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bio: 'no session' }),
    });
    assert.equal(response.status, 401);
    assert.equal((await store.getProvider(provider.id))?.bio, '', 'nothing changed');
  });
});

test('a session cannot act on another veteran', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    const mine = await enrol('+1-619-555-0422');
    const theirs = await enrol('+1-619-555-0433');
    const { token } = await issueSession(mine.id);

    const response = await fetch(`${baseUrl}/api/v1/providers/${theirs.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bio: 'not mine to edit' }),
    });
    assert.equal(response.status, 403);
    assert.equal((await store.getProvider(theirs.id))?.bio, '', 'their record untouched');
  });
});

test('an expired session is refused and cleaned up', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    const provider = await enrol('+1-619-555-0444');
    const { token } = await issueSession(provider.id);

    const hash = (await import('node:crypto'))
      .createHash('sha256')
      .update(token)
      .digest('hex');
    const session = (await store.getSession(hash))!;
    await store.saveSession({ ...session, expiresAt: new Date(Date.now() - 1000).toISOString() });

    const response = await fetch(`${baseUrl}/api/v1/providers/${provider.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ bio: 'too late' }),
    });
    assert.equal(response.status, 401);
    assert.equal(await store.getSession(hash), undefined, 'expired session discarded');
  });
});

test('signing in returns a session token', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    await enrol('+1-619-555-0455');

    const response = await fetch(`${baseUrl}/api/v1/auth/verify-code`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone: '+1-619-555-0455', code: config.mockOtpCode }),
    });
    const payload = (await response.json()) as {
      session?: { token: string; expiresAt: string };
    };
    assert.ok(payload.session?.token, 'a token comes back');
    assert.ok(Date.parse(payload.session!.expiresAt) > Date.now(), 'and an expiry');
  });
});

test('enrolling stays open, since a new veteran has no session yet', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    const response = await fetch(`${baseUrl}/api/v1/providers`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: 'Newcomer',
        branch: 'navy',
        yearsOfService: 3,
        bio: '',
        email: 'newcomer@example.com',
        phone: '+1-619-555-0466',
        zipCode: '92101',
        vehicle: { model: 'Civic', licensePlate: 'NEW001' },
        offerings: [{ serviceType: 'rides', rateType: 'volunteer', hourlyRateUsd: 0 }],
        pilotTermsVersion: PILOT_TERMS_VERSION,
      }),
    });
    assert.equal(response.status, 201);
  });
});
