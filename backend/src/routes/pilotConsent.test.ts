import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { createApp } from '../app.js';
import { store } from '../data/store.js';
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

const signup = (baseUrl: string, extra: Record<string, unknown>) =>
  fetch(`${baseUrl}/api/v1/providers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'Consent Tester',
      branch: 'army',
      yearsOfService: 4,
      bio: '',
      email: 'consent.tester@example.com',
      phone: '+1-619-555-0288',
      zipCode: '92101',
      vehicle: { model: 'Toyota Camry', licensePlate: 'CONSENT1' },
      offerings: [{ serviceType: 'rides', rateType: 'volunteer', hourlyRateUsd: 0 }],
      ...extra,
    }),
  });

test('enrolling without accepting the pilot terms is refused', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    const response = await signup(baseUrl, {});
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { error: { details: { field: string }[] } };
    assert.ok(payload.error.details.some((d) => d.field === 'pilotTermsVersion'));
    assert.equal((await store.listProviders()).length, 0, 'nobody enrolled');
  });
});

test('a stale terms version is refused, so nobody agrees to wording they never saw', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    const response = await signup(baseUrl, { pilotTermsVersion: '1999-01-01' });
    assert.equal(response.status, 400);
    assert.match(
      ((await response.json()) as { error: { message: string } }).error.message,
      /updated/i,
    );
    assert.equal((await store.listProviders()).length, 0);
  });
});

test('accepting the current terms is recorded against the enrolment', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    const response = await signup(baseUrl, { pilotTermsVersion: PILOT_TERMS_VERSION });
    assert.equal(response.status, 201);

    const payload = (await response.json()) as {
      provider: { id: string; pilotConsent: { version: string; acceptedAt: string } | null };
    };
    assert.equal(payload.provider.pilotConsent?.version, PILOT_TERMS_VERSION);
    assert.ok(Date.parse(payload.provider.pilotConsent!.acceptedAt) > 0, 'timestamped');

    const stored = await store.getProvider(payload.provider.id);
    assert.equal(stored?.pilotConsent?.version, PILOT_TERMS_VERSION, 'persisted, not just echoed');
  });
});

test('someone enrolled before the terms existed can accept them afterwards', async () => {
  await withServer(async (baseUrl) => {
    await store.reset();
    // Straight into the store, so there is no consent on the record.
    const provider = await store.createProvider({
      name: 'Early Bird',
      branch: 'navy',
      yearsOfService: 9,
      bio: '',
      email: 'early@example.com',
      phone: '+1-619-555-0277',
      zipCode: '92101',
      base: { lat: 32.719, lng: -117.1628 },
      serviceRadiusKm: 40,
      vehicle: { model: 'Ford F-150', licensePlate: 'EARLY01' },
      offerings: [{ serviceType: 'rides', rateType: 'volunteer', hourlyRateUsd: 0 }],
      rating: null,
      completedJobs: 0,
      verified: true,
      active: true,
    });
    assert.equal(provider.pilotConsent, undefined);

    const response = await fetch(`${baseUrl}/api/v1/providers/${provider.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pilotTermsVersion: PILOT_TERMS_VERSION }),
    });
    assert.equal(response.status, 200);
    assert.equal((await store.getProvider(provider.id))?.pilotConsent?.version, PILOT_TERMS_VERSION);
  });
});

test('the terms are served so the client cannot drift from what is recorded', async () => {
  await withServer(async (baseUrl) => {
    const catalog = (await (await fetch(`${baseUrl}/api/v1/catalog`)).json()) as {
      pilotTerms: { version: string; points: unknown[]; acknowledgement: string };
    };
    assert.equal(catalog.pilotTerms.version, PILOT_TERMS_VERSION);
    assert.ok(catalog.pilotTerms.points.length >= 5, 'the disclosures are there');
    assert.ok(catalog.pilotTerms.acknowledgement.length > 0);
  });
});
