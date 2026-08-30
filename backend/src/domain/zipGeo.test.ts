import assert from 'node:assert/strict';
import { test } from 'node:test';
import { distanceBetweenZipCodes, getZipCoordinates } from './zipGeo.js';

test('Hacker Dojo and nearby Mountain View ZIPs are supported', () => {
  assert.ok(getZipCoordinates('94043'));
  assert.ok(getZipCoordinates('94040'));
  assert.equal(distanceBetweenZipCodes('94043', '94043'), 0);
  const nearbyDistance = distanceBetweenZipCodes('94043', '94041');
  assert.ok(nearbyDistance !== null && nearbyDistance < 10);
});
