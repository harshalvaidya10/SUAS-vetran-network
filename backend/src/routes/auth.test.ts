import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../app.js';
import { config } from '../config.js';
import { store } from '../data/store.js';

const PHONE = '+1-619-555-0199';

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

async function enrol() {
  return store.createProvider({
    name: 'Login Tester',
    branch: 'army',
    yearsOfService: 5,
    bio: '',
    email: 'login.tester@example.com',
    phone: PHONE,
    zipCode: '92101',
    base: { lat: 32.719, lng: -117.1628 },
    serviceRadiusKm: 40,
    vehicle: { model: 'Toyota Camry', licensePlate: 'LOGIN01' },
    offerings: [{ serviceType: 'rides', rateType: 'volunteer', hourlyRateUsd: 0 }],
    rating: null,
    completedJobs: 0,
    verified: true,
    active: true,
  });
}

const post = (baseUrl: string, path: string, body: unknown) =>
  fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

test('request-code says nothing about whether a number is enrolled', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    await enrol();

    const enrolled = await post(baseUrl, '/api/v1/auth/request-code', { phone: PHONE });
    const stranger = await post(baseUrl, '/api/v1/auth/request-code', { phone: '+1-619-555-9999' });

    assert.equal(enrolled.status, stranger.status);
    assert.deepEqual(await enrolled.json(), await stranger.json());
    // Only the enrolled number gets a challenge stored.
    assert.ok(await store.getLoginChallenge('6195550199'));
    assert.equal(await store.getLoginChallenge('6195559999'), undefined);
  });
});

test('the mock code still logs a veteran in', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    const provider = await enrol();

    await post(baseUrl, '/api/v1/auth/request-code', { phone: PHONE });
    const response = await post(baseUrl, '/api/v1/auth/verify-code', {
      phone: PHONE,
      code: config.mockOtpCode,
    });
    const payload = (await response.json()) as { provider: { id: string; phone: string } };

    assert.equal(response.status, 200);
    assert.equal(payload.provider.id, provider.id);
    assert.equal(payload.provider.phone, PHONE, 'the veteran sees their own contact details');
  });
});

test('a code works without asking first, so existing mock flows keep working', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    await enrol();

    const response = await post(baseUrl, '/api/v1/auth/verify-code', {
      phone: PHONE,
      code: config.mockOtpCode,
    });
    assert.equal(response.status, 200);
  });
});

test('a code is single use', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    await enrol();

    await post(baseUrl, '/api/v1/auth/request-code', { phone: PHONE });
    await post(baseUrl, '/api/v1/auth/verify-code', { phone: PHONE, code: config.mockOtpCode });
    assert.equal(await store.getLoginChallenge('6195550199'), undefined, 'challenge consumed');
  });
});

test('a wrong code is counted and burns out', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    await enrol();
    await post(baseUrl, '/api/v1/auth/request-code', { phone: PHONE });

    const wrong = await post(baseUrl, '/api/v1/auth/verify-code', { phone: PHONE, code: '000000' });
    assert.equal(wrong.status, 401);
    assert.equal((await store.getLoginChallenge('6195550199'))?.attempts, 1);

    for (let i = 1; i < config.otpMaxAttempts; i += 1) {
      await post(baseUrl, '/api/v1/auth/verify-code', { phone: PHONE, code: '000000' });
    }
    const exhausted = await post(baseUrl, '/api/v1/auth/verify-code', {
      phone: PHONE,
      code: '000000',
    });
    assert.equal(exhausted.status, 429);
    assert.equal(await store.getLoginChallenge('6195550199'), undefined, 'challenge destroyed');
  });
});

test('an expired code is refused', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    await enrol();
    await post(baseUrl, '/api/v1/auth/request-code', { phone: PHONE });

    const challenge = (await store.getLoginChallenge('6195550199'))!;
    await store.saveLoginChallenge({
      ...challenge,
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });

    const response = await post(baseUrl, '/api/v1/auth/verify-code', {
      phone: PHONE,
      code: config.mockOtpCode,
    });
    assert.equal(response.status, 401);
    assert.equal(((await response.json()) as { error: { code: string } }).error.code, 'code_expired');
  });
});

test('a resend inside the cooldown does not text again', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    await enrol();

    await post(baseUrl, '/api/v1/auth/request-code', { phone: PHONE });
    const first = (await store.getLoginChallenge('6195550199'))!;

    const again = await post(baseUrl, '/api/v1/auth/request-code', { phone: PHONE });
    const payload = (await again.json()) as { retryAfterSeconds?: number };
    assert.ok((payload.retryAfterSeconds ?? 0) > 0, 'caller is told to wait');
    assert.equal(
      (await store.getLoginChallenge('6195550199'))?.sentAt,
      first.sentAt,
      'the original code is untouched',
    );
  });
});

test('the stored code is hashed, not the code itself', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    await enrol();
    await post(baseUrl, '/api/v1/auth/request-code', { phone: PHONE });

    const challenge = (await store.getLoginChallenge('6195550199'))!;
    assert.notEqual(challenge.codeHash, config.mockOtpCode);
    assert.match(challenge.codeHash, /^[0-9a-f]{64}$/);
  });
});

test('a failed text leaves no challenge and no cooldown behind', async () => {
  const provider = config.smsProvider;
  // Point at Twilio with no credentials, which is the cheapest real failure.
  (config as { smsProvider: string }).smsProvider = 'twilio';
  try {
    await withServer(async (baseUrl) => {
      await store.reset();
      await enrol();

      const response = await post(baseUrl, '/api/v1/auth/request-code', { phone: PHONE });
      assert.equal(response.status, 502);
      assert.equal(
        await store.getLoginChallenge('6195550199'),
        undefined,
        'no code stored that nobody received',
      );
    });
  } finally {
    (config as { smsProvider: string }).smsProvider = provider;
  }
});
