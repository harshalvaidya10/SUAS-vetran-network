import { Router } from 'express';
import { MILITARY_BRANCHES, SERVICE_TYPES } from '../domain/serviceCatalog.js';
import { SCORE_WEIGHTS } from '../domain/matching.js';
import { MAX_PICKUP_MILES, PICKUP_TIERS_MILES } from '../domain/distancePolicy.js';

export const catalogRouter: Router = Router();

/** Everything the client needs to render its forms without hardcoding enums. */
catalogRouter.get('/', (_req, res) => {
  res.json({
    serviceTypes: SERVICE_TYPES,
    branches: MILITARY_BRANCHES,
    matchWeights: SCORE_WEIGHTS,
    // Distance policy, served rather than hardcoded, so the sign-up copy and
    // the matcher can never disagree about how far a veteran will be sent.
    distance: {
      maxPickupMiles: MAX_PICKUP_MILES,
      pickupTiersMiles: PICKUP_TIERS_MILES,
    },
  });
});
