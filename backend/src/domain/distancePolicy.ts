/**
 * How far is too far for a ride mission.
 *
 * Two ideas, kept separate on purpose:
 *
 *  - The **ceiling** is the furthest we will ever ask a veteran to drive to a
 *    pickup. Past this we would rather tell the rider nobody is available than
 *    send someone on an hour's drive before the trip even starts.
 *  - The **tiers** are how we search inside that ceiling. We look close first
 *    and only widen when nobody nearer has committed, so a driver four miles
 *    away is never passed over for one twenty-five miles out who happens to
 *    rate slightly higher.
 *
 * Miles, because that is the unit the drivers doing this actually think in.
 */
export const MILES_TO_KM = 1.609344;

export const milesToKm = (miles: number) => miles * MILES_TO_KM;
export const kmToMiles = (km: number) => km / MILES_TO_KM;

/** Search these radii in order; stop at the first one that finds anybody. */
export const PICKUP_TIERS_MILES = [10, 20, 30] as const;

/** Nobody is matched to a pickup beyond this. */
export const MAX_PICKUP_MILES = PICKUP_TIERS_MILES[PICKUP_TIERS_MILES.length - 1]!;

export const MAX_PICKUP_KM = milesToKm(MAX_PICKUP_MILES);

/**
 * The tier ladder for one request, in km, capped by whatever ceiling applies
 * (the network's, or a tighter one the requester asked for). Always ends at the
 * ceiling so a request never silently searches less than it was allowed to.
 */
export function pickupTiersKm(ceilingKm: number): number[] {
  const tiers = PICKUP_TIERS_MILES.map(milesToKm).filter((km) => km < ceilingKm);
  tiers.push(ceilingKm);
  return tiers;
}
