import assert from 'node:assert/strict';
import { test } from 'node:test';
import { store } from './store.js';

const iso = (offsetMs: number) => new Date(Date.now() + offsetMs).toISOString();

test('expired sessions and codes are swept, live ones are left alone', async () => {
  await store.reset();

  await store.saveSession({
    tokenHash: 'lapsed',
    providerId: 'p1',
    expiresAt: iso(-60_000),
    createdAt: iso(-120_000),
  });
  await store.saveSession({
    tokenHash: 'live',
    providerId: 'p1',
    expiresAt: iso(60 * 60_000),
    createdAt: iso(0),
  });
  await store.saveLoginChallenge({
    phoneKey: '6195550001',
    codeHash: 'x',
    expiresAt: iso(-60_000),
    attempts: 0,
    sentAt: iso(-120_000),
  });
  await store.saveLoginChallenge({
    phoneKey: '6195550002',
    codeHash: 'y',
    expiresAt: iso(10 * 60_000),
    attempts: 0,
    sentAt: iso(0),
  });

  const purged = await store.purgeExpired(new Date().toISOString());
  assert.equal(purged.sessions, 1);
  assert.equal(purged.challenges, 1);

  assert.equal(await store.getSession('lapsed'), undefined, 'lapsed session gone');
  assert.ok(await store.getSession('live'), 'live session kept');
  assert.equal(await store.getLoginChallenge('6195550001'), undefined, 'stale code gone');
  assert.ok(await store.getLoginChallenge('6195550002'), 'pending code kept');

  await store.reset();
});

test('purging an empty database is a no-op', async () => {
  await store.reset();
  assert.deepEqual(await store.purgeExpired(new Date().toISOString()), {
    sessions: 0,
    challenges: 0,
  });
});
