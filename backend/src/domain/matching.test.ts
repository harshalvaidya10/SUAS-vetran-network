import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  countRecentBookings,
  findMatches,
  findMatchesTiered,
  type MatchCriteria,
  type MatchContext,
} from './matching.js';
import { MAX_PICKUP_KM, milesToKm } from './distancePolicy.js';
import type { AvailabilitySlot, Provider } from '../types.js';

const NOW = new Date('2026-03-02T08:00:00.000Z');
const DOWNTOWN = { lat: 32.7157, lng: -117.1611 };

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'p1',
    name: 'Test Veteran',
    branch: 'army',
    yearsOfService: 6,
    bio: '',
    email: 'v@example.com',
    phone: '+1-619-555-0100',
    zip: '92101',
    base: DOWNTOWN,
    serviceRadiusKm: MAX_PICKUP_KM,
    offerings: [{ serviceType: 'rides', rateType: 'volunteer', hourlyRateUsd: 0 }],
    rating: 4.5,
    completedJobs: 10,
    verified: true,
    active: true,
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

function slot(overrides: Partial<AvailabilitySlot> = {}): AvailabilitySlot {
  return {
    id: 's1',
    providerId: 'p1',
    startsAt: '2026-03-02T09:00:00.000Z',
    endsAt: '2026-03-02T13:00:00.000Z',
    serviceTypes: ['rides'],
    status: 'open',
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

const criteria: MatchCriteria = {
  serviceType: 'rides',
  location: DOWNTOWN,
  windowStartsAt: '2026-03-02T09:00:00.000Z',
  windowEndsAt: '2026-03-02T17:00:00.000Z',
  durationMinutes: 60,
  maxDistanceKm: 40,
};

function context(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    providers: [provider()],
    slots: [slot()],
    recentBookingCounts: new Map(),
    now: NOW,
    ...overrides,
  };
}

test('matches a verified veteran with an overlapping committed slot', () => {
  const result = findMatches(criteria, context());

  assert.equal(result.candidates.length, 1);
  const match = result.candidates[0]!;
  assert.equal(match.provider.id, 'p1');
  assert.equal(match.startsAt, '2026-03-02T09:00:00.000Z');
  assert.equal(match.endsAt, '2026-03-02T10:00:00.000Z');
  assert.equal(match.estimatedCostUsd, 0);
});

test('never matches unverified or deactivated veterans', () => {
  for (const patch of [{ verified: false }, { active: false }]) {
    const result = findMatches(criteria, context({ providers: [provider(patch)] }));
    assert.equal(result.candidates.length, 0);
    assert.equal(result.rejections.inactive_or_unverified, 1);
  }
});

test('skips veterans whose slot does not cover the requested service', () => {
  // A slot that covers nothing the requester asked for is invisible to the
  // matcher — the mechanism that will matter again when the catalog grows.
  const result = findMatches(criteria, context({ slots: [slot({ serviceTypes: [] })] }));
  assert.equal(result.candidates.length, 0);
  assert.equal(result.rejections.no_overlapping_slot, 1);
});

test('skips a slot too short for the job', () => {
  const result = findMatches(
    { ...criteria, durationMinutes: 300 },
    context({ slots: [slot({ endsAt: '2026-03-02T11:00:00.000Z' })] }),
  );
  assert.equal(result.candidates.length, 0);
  assert.equal(result.rejections.no_overlapping_slot, 1);
});

test('respects both the requester distance cap and the veteran service radius', () => {
  const farAway = provider({ base: { lat: 33.1959, lng: -117.3795 } }); // ~60km out
  const outOfRange = findMatches(criteria, context({ providers: [farAway] }));
  assert.equal(outOfRange.candidates.length, 0);
  assert.equal(outOfRange.rejections.out_of_range, 1);

  const narrowRequester = findMatches({ ...criteria, maxDistanceKm: 1 }, context());
  assert.equal(narrowRequester.candidates.length, 1, 'provider is at the request location');
});

test('ranks the closer veteran above the farther one', () => {
  const near = provider({ id: 'near', base: { lat: 32.72, lng: -117.16 } });
  const far = provider({ id: 'far', base: { lat: 32.95, lng: -117.05 } });
  const result = findMatches(
    criteria,
    context({
      providers: [far, near],
      slots: [slot({ id: 'sf', providerId: 'far' }), slot({ id: 'sn', providerId: 'near' })],
    }),
  );

  assert.deepEqual(
    result.candidates.map((c) => c.provider.id),
    ['near', 'far'],
  );
});

test('spreads work toward the veteran who has not been booked lately', () => {
  const busy = provider({ id: 'busy' });
  const idle = provider({ id: 'idle' });
  const result = findMatches(
    criteria,
    context({
      providers: [busy, idle],
      slots: [slot({ id: 'sb', providerId: 'busy' }), slot({ id: 'si', providerId: 'idle' })],
      recentBookingCounts: new Map([['busy', 5]]),
    }),
  );

  assert.equal(result.candidates[0]!.provider.id, 'idle');
});

test('preference filters are honoured', () => {
  const navy = provider({ id: 'navy', branch: 'navy' });
  const ctx = context({
    providers: [provider(), navy],
    slots: [slot(), slot({ id: 's2', providerId: 'navy' })],
  });

  const branchFiltered = findMatches({ ...criteria, preferredBranch: 'navy' }, ctx);
  assert.deepEqual(branchFiltered.candidates.map((c) => c.provider.id), ['navy']);

  const paid = provider({
    id: 'paid',
    offerings: [{ serviceType: 'rides', rateType: 'hourly', hourlyRateUsd: 60 }],
  });
  const volunteerOnly = findMatches(
    { ...criteria, volunteerOnly: true },
    context({ providers: [paid], slots: [slot({ providerId: 'paid' })] }),
  );
  assert.equal(volunteerOnly.candidates.length, 0);
  assert.equal(volunteerOnly.rejections.rate_too_high, 1);
});

test('returns one candidate per veteran, best slot first', () => {
  const result = findMatches(
    criteria,
    context({
      slots: [
        slot({ id: 'later', startsAt: '2026-03-02T14:00:00.000Z', endsAt: '2026-03-02T16:00:00.000Z' }),
        slot({ id: 'sooner' }),
      ],
    }),
  );

  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]!.slot.id, 'sooner');
});

test('countRecentBookings ignores cancelled and stale bookings', () => {
  const counts = countRecentBookings(
    [
      { providerId: 'p1', createdAt: NOW.toISOString(), status: 'confirmed' },
      { providerId: 'p1', createdAt: NOW.toISOString(), status: 'cancelled' },
      { providerId: 'p1', createdAt: '2026-01-01T00:00:00.000Z', status: 'completed' },
    ],
    NOW,
  );

  assert.equal(counts.get('p1'), 1);
});

// --- closest-first tiering -------------------------------------------------

/** ~`miles` due east of downtown, which is close enough for these tests. */
function milesEast(miles: number) {
  return { lat: DOWNTOWN.lat, lng: DOWNTOWN.lng + (miles * 1.609344) / 93.5 };
}

const wideCriteria: MatchCriteria = { ...criteria, maxDistanceKm: MAX_PICKUP_KM };

test('takes the nearby veteran over a better-rated one far away', () => {
  // Left to a single flat search, the 25-mile driver wins on rating and track
  // record. Tiering means we never look that far while someone is 4 miles out.
  const near = provider({ id: 'near', base: milesEast(4), rating: 3.4, completedJobs: 0 });
  const far = provider({ id: 'far', base: milesEast(25), rating: 5, completedJobs: 40 });
  const context_ = context({
    providers: [near, far],
    slots: [slot({ id: 'sn', providerId: 'near' }), slot({ id: 'sf', providerId: 'far' })],
  });

  const flat = findMatches(wideCriteria, context_);
  assert.equal(flat.candidates[0]!.provider.id, 'far', 'a single wide search prefers the ratings');

  const tiered = findMatchesTiered(wideCriteria, context_);
  assert.equal(tiered.candidates[0]!.provider.id, 'near');
  assert.equal(tiered.searchRadiusMiles, 10);
});

test('widens only when the tight radius is empty', () => {
  const far = provider({ id: 'far', base: milesEast(24) });
  const result = findMatchesTiered(
    wideCriteria,
    context({ providers: [far], slots: [slot({ providerId: 'far' })] }),
  );

  assert.equal(result.candidates.length, 1);
  assert.equal(result.searchRadiusMiles, 30, 'escalated past the 10 and 20 mile tiers');
});

test('never matches a pickup beyond the ceiling', () => {
  const tooFar = provider({ id: 'toofar', base: milesEast(45), serviceRadiusKm: 500 });
  const result = findMatchesTiered(
    wideCriteria,
    context({ providers: [tooFar], slots: [slot({ providerId: 'toofar' })] }),
  );

  assert.equal(result.candidates.length, 0);
  assert.equal(result.rejections.out_of_range, 1);
  assert.equal(result.searchRadiusMiles, 30);
});

test('a requester asking to look less far is obeyed', () => {
  const eightMiles = provider({ id: 'eight', base: milesEast(8) });
  const context_ = context({
    providers: [eightMiles],
    slots: [slot({ providerId: 'eight' })],
  });

  assert.equal(findMatchesTiered(wideCriteria, context_).candidates.length, 1);

  const tight = findMatchesTiered({ ...criteria, maxDistanceKm: milesToKm(5) }, context_);
  assert.equal(tight.candidates.length, 0, 'a 5-mile cap rules out the 8-mile driver');
  assert.equal(tight.searchRadiusMiles, 5);
});
