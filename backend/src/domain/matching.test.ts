import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  FAIRNESS_MAX_EXTRA_KM,
  countRecentBookings,
  findMatches,
  type MatchContext,
  type MatchCriteria,
} from './matching.js';
import { distanceBetweenZipCodes, getZipCoordinates } from './zipGeo.js';
import type { AvailabilitySlot, Booking, Provider } from '../types.js';

const NOW = new Date('2026-03-02T08:00:00.000Z');
const PICKUP = getZipCoordinates('92101')!;

function provider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 'p1',
    name: 'Test Veteran',
    branch: 'army',
    yearsOfService: 6,
    bio: '',
    email: 'v@example.com',
    phone: '+1-619-555-0100',
    base: PICKUP,
    zipCode: '92101',
    serviceRadiusKm: 40,
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
    endsAt: '2026-03-02T13:30:00.000Z',
    serviceTypes: ['rides'],
    status: 'open',
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

function booking(overrides: Partial<Booking> = {}): Booking {
  return {
    id: 'b1',
    requestId: 'r1',
    slotId: 'other-slot',
    providerId: 'p1',
    serviceType: 'rides',
    requester: { name: 'Rider', veteran: true, phone: '+1-619-555-0199' },
    location: { ...PICKUP, zipCode: '92101' },
    startsAt: '2026-03-02T12:45:00.000Z',
    endsAt: '2026-03-02T13:15:00.000Z',
    status: 'confirmed',
    estimatedCostUsd: 0,
    matchScore: 90,
    createdAt: NOW.toISOString(),
    ...overrides,
  };
}

const criteria: MatchCriteria = {
  serviceType: 'rides',
  pickupZip: '92101',
  location: PICKUP,
  windowStartsAt: '2026-03-02T12:30:00.000Z',
  windowEndsAt: '2026-03-02T14:00:00.000Z',
  durationMinutes: 60,
  maxDistanceKm: 40,
};

function context(overrides: Partial<MatchContext> = {}): MatchContext {
  return {
    providers: [provider()],
    slots: [slot()],
    bookings: [],
    recentBookingCounts: new Map(),
    now: NOW,
    ...overrides,
  };
}

function roster(
  providers: Provider[],
  counts: [string, number][] = [],
  slots = providers.map((item) => slot({ id: `s-${item.id}`, providerId: item.id })),
): MatchContext {
  return context({ providers, slots, recentBookingCounts: new Map(counts) });
}

test('exact pickup and end times must be fully contained by an open slot', () => {
  const exact = findMatches(criteria, context());
  assert.equal(exact.candidates[0]?.startsAt, criteria.windowStartsAt);
  assert.equal(exact.candidates[0]?.endsAt, '2026-03-02T13:30:00.000Z');

  const exactStart = findMatches(
    { ...criteria, windowStartsAt: '2026-03-02T09:00:00.000Z', windowEndsAt: '2026-03-02T10:00:00.000Z' },
    context(),
  );
  assert.equal(exactStart.candidates.length, 1);

  const tooLong = findMatches({ ...criteria, durationMinutes: 61 }, context());
  assert.equal(tooLong.candidates.length, 0);
  assert.equal(tooLong.rejections.ride_exceeds_slot, 1);
});

test('closest unavailable driver loses to the next closest eligible driver', () => {
  const closest = provider({ id: 'closest' });
  const next = provider({
    id: 'next',
    zipCode: undefined,
    base: { lat: PICKUP.lat + 0.01, lng: PICKUP.lng },
  });
  const result = findMatches(
    criteria,
    roster(
      [closest, next],
      [],
      [
        slot({ id: 'too-late', providerId: 'closest', startsAt: '2026-03-02T14:00:00.000Z' }),
        slot({ id: 'valid', providerId: 'next' }),
      ],
    ),
  );
  assert.deepEqual(result.candidates.map((item) => item.provider.id), ['next']);
  assert.equal(result.rejections.no_valid_availability, 1);
});

test('multiple and overlapping slots yield only the best valid slot per driver', () => {
  const result = findMatches(
    criteria,
    context({
      slots: [
        slot({ id: 'invalid', startsAt: '2026-03-02T14:00:00.000Z' }),
        slot({ id: 'later-commit', startsAt: '2026-03-02T10:00:00.000Z' }),
        slot({ id: 'earlier-commit', startsAt: '2026-03-02T09:00:00.000Z' }),
      ],
    }),
  );
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.slot.id, 'earlier-commit');
});

test('booked and cancelled slots are never eligible', () => {
  for (const status of ['booked', 'cancelled'] as const) {
    const result = findMatches(criteria, context({ slots: [slot({ status })] }));
    assert.equal(result.candidates.length, 0);
    assert.equal(result.rejections.no_open_slot, 1);
  }
});

test('confirmed overlap blocks a driver; cancelled and completed bookings do not', () => {
  const blocked = findMatches(criteria, context({ bookings: [booking()] }));
  assert.equal(blocked.candidates.length, 0);
  assert.equal(blocked.rejections.overlapping_booking, 1);

  for (const status of ['cancelled', 'completed'] as const) {
    const allowed = findMatches(criteria, context({ bookings: [booking({ status })] }));
    assert.equal(allowed.candidates.length, 1);
  }
});

test('non-overlapping confirmed bookings do not block a future ride', () => {
  const before = booking({ startsAt: '2026-03-02T10:00:00.000Z', endsAt: '2026-03-02T11:00:00.000Z' });
  const result = findMatches(criteria, context({ bookings: [before] }));
  assert.equal(result.candidates.length, 1);
});

test('inactive and unverified drivers are hard-rejected', () => {
  for (const patch of [{ active: false }, { verified: false }]) {
    const result = findMatches(criteria, context({ providers: [provider(patch)] }));
    assert.equal(result.candidates.length, 0);
    assert.equal(result.rejections.inactive_or_unverified, 1);
  }
});

test('future slots outside the exact pickup time are not matched', () => {
  const result = findMatches(
    criteria,
    context({ slots: [slot({ startsAt: '2026-03-03T09:00:00.000Z', endsAt: '2026-03-03T17:00:00.000Z' })] }),
  );
  assert.equal(result.candidates.length, 0);
  assert.equal(result.rejections.no_valid_availability, 1);
});

test('unknown or missing pickup ZIP returns a clean diagnostic', () => {
  for (const pickupZip of ['00000', undefined]) {
    const result = findMatches({ ...criteria, pickupZip } as MatchCriteria, context());
    assert.equal(result.candidates.length, 0);
    assert.equal(result.rejections.invalid_zip, 1);
  }
});

test('same rider and driver ZIP has zero distance', () => {
  const result = findMatches(criteria, context());
  assert.equal(result.candidates[0]?.distanceKm, 0);
  assert.equal(distanceBetweenZipCodes('92101', '92101'), 0);
});

test('invalid fallback coordinates are rejected safely rather than producing NaN', () => {
  const bad = provider({
    zipCode: undefined,
    base: { lat: Number.NaN, lng: -117 },
  });
  const result = findMatches(criteria, context({ providers: [bad] }));
  assert.equal(result.candidates.length, 0);
  assert.equal(result.rejections.invalid_zip, 1);
});

test('one eligible driver is always returned, regardless of workload', () => {
  const result = findMatches(criteria, context({ recentBookingCounts: new Map([['p1', 100]]) }));
  assert.equal(result.candidates[0]?.provider.id, 'p1');
});

test('equally close drivers deterministically prefer lower workload', () => {
  const busy = provider({ id: 'busy' });
  const idle = provider({ id: 'idle' });
  const result = findMatches(criteria, roster([busy, idle], [['busy', 20]]));
  assert.equal(result.candidates[0]?.provider.id, 'idle');
  assert.equal(result.candidates[0]?.recentRideCount, 0);
});

test('a slightly farther, dramatically less-used driver may win inside the guardrail', () => {
  const near = provider({ id: 'near' });
  const fair = provider({
    id: 'fair',
    zipCode: undefined,
    base: { lat: PICKUP.lat + 0.018, lng: PICKUP.lng },
  });
  const result = findMatches(criteria, roster([near, fair], [['near', 20]]));
  assert.equal(result.candidates[0]?.provider.id, 'fair');
  assert.equal(result.candidates[0]?.withinFairnessGuardrail, true);
});

test('a much farther idle driver cannot beat the closest reasonable driver', () => {
  const near = provider({ id: 'near' });
  const far = provider({
    id: 'far',
    zipCode: undefined,
    base: { lat: PICKUP.lat + 0.14, lng: PICKUP.lng },
  });
  const result = findMatches(criteria, roster([near, far], [['near', 20]]));
  assert.equal(result.candidates[0]?.provider.id, 'near');
  assert.equal(result.candidates.find((item) => item.provider.id === 'far')?.withinFairnessGuardrail, false);
  assert.ok(FAIRNESS_MAX_EXTRA_KM < 4);
});

test('new zero-ride drivers receive a boost but heavily used drivers are never starved', () => {
  const veteran = provider({ id: 'veteran' });
  const newcomer = provider({ id: 'newcomer', rating: null, completedJobs: 0 });
  const closeTie = findMatches(criteria, roster([veteran, newcomer], [['veteran', 12]]));
  assert.equal(closeTie.candidates[0]?.provider.id, 'newcomer');

  const alone = findMatches(criteria, roster([veteran], [['veteran', 200]]));
  assert.equal(alone.candidates[0]?.provider.id, 'veteran');
});

test('when all nearby drivers carry the same heavy load, proximity still decides', () => {
  const near = provider({ id: 'near' });
  const farther = provider({
    id: 'farther',
    zipCode: undefined,
    base: { lat: PICKUP.lat + 0.015, lng: PICKUP.lng },
  });
  const result = findMatches(criteria, roster([farther, near], [['near', 20], ['farther', 20]]));
  assert.equal(result.candidates[0]?.provider.id, 'near');
});

test('provider service radius and requester max distance are both hard caps', () => {
  const away = provider({
    zipCode: undefined,
    base: { lat: PICKUP.lat + 0.05, lng: PICKUP.lng },
    serviceRadiusKm: 1,
  });
  const providerCap = findMatches(criteria, context({ providers: [away] }));
  assert.equal(providerCap.rejections.outside_search_radius, 1);

  const requestCap = findMatches(
    { ...criteria, maxDistanceKm: 1 },
    context({ providers: [provider({ ...away, serviceRadiusKm: 40 })] }),
  );
  assert.equal(requestCap.rejections.outside_search_radius, 1);
});

test('requests in the past and non-positive durations are rejected', () => {
  const past = findMatches(
    { ...criteria, windowStartsAt: '2026-03-01T12:30:00.000Z' },
    context(),
  );
  assert.equal(past.rejections.request_in_past, 1);

  for (const durationMinutes of [0, -1]) {
    const invalid = findMatches({ ...criteria, durationMinutes }, context());
    assert.equal(invalid.rejections.invalid_duration, 1);
  }
});

test('ISO timestamps with offsets compare by instant, not text', () => {
  const result = findMatches(
    {
      ...criteria,
      windowStartsAt: '2026-03-02T04:30:00-08:00',
      windowEndsAt: '2026-03-02T06:00:00-08:00',
    },
    context(),
  );
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0]?.startsAt, '2026-03-02T12:30:00.000Z');
});

test('deterministic ties use rating, earliest slot, then provider id', () => {
  const lower = provider({ id: 'z-low', rating: 4.5 });
  const higher = provider({ id: 'z-high', rating: 5 });
  const ratingTie = findMatches(criteria, roster([lower, higher]));
  assert.equal(ratingTie.candidates[0]?.provider.id, 'z-high');

  const a = provider({ id: 'a', rating: 5 });
  const b = provider({ id: 'b', rating: 5 });
  const idTie = findMatches(criteria, roster([b, a]));
  assert.deepEqual(idTie.candidates.map((item) => item.provider.id), ['a', 'b']);
});

test('no eligible drivers returns actionable rejection counts', () => {
  const result = findMatches(criteria, context({ slots: [] }));
  assert.equal(result.candidates.length, 0);
  assert.equal(result.matchedProviders, 0);
  assert.equal(result.rejections.no_open_slot, 1);
});

test('preference filters remain hard eligibility rules', () => {
  const navy = provider({ id: 'navy', branch: 'navy' });
  const branchResult = findMatches(
    { ...criteria, preferredBranch: 'navy' },
    roster([provider(), navy]),
  );
  assert.deepEqual(branchResult.candidates.map((item) => item.provider.id), ['navy']);

  const paid = provider({
    offerings: [{ serviceType: 'rides', rateType: 'hourly', hourlyRateUsd: 60 }],
  });
  const volunteer = findMatches({ ...criteria, volunteerOnly: true }, context({ providers: [paid] }));
  assert.equal(volunteer.rejections.rate_too_high, 1);
});

test('countRecentBookings counts trailing-week confirmed/completed rides only', () => {
  const counts = countRecentBookings(
    [
      { providerId: 'p1', createdAt: NOW.toISOString(), status: 'confirmed' },
      { providerId: 'p1', createdAt: NOW.toISOString(), status: 'completed' },
      { providerId: 'p1', createdAt: NOW.toISOString(), status: 'cancelled' },
      { providerId: 'p1', createdAt: '2026-01-01T00:00:00.000Z', status: 'completed' },
      { providerId: 'p1', createdAt: '2026-03-03T00:00:00.000Z', status: 'confirmed' },
    ],
    NOW,
  );
  assert.equal(counts.get('p1'), 2);
});
