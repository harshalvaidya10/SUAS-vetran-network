import { Router } from 'express';
import { MILITARY_BRANCHES, SERVICE_TYPES } from '../domain/serviceCatalog.js';
import { FAIRNESS_MAX_EXTRA_KM, SCORE_WEIGHTS } from '../domain/matching.js';
import { DEFAULT_SERVICE_RADIUS_KM } from '../http/validation.js';
import { PILOT_TERMS } from '../domain/pilotTerms.js';

export const catalogRouter: Router = Router();

/** Everything the client needs to render its forms without hardcoding enums. */
catalogRouter.get('/', (_req, res) => {
  res.json({
    serviceTypes: SERVICE_TYPES,
    branches: MILITARY_BRANCHES,
    matchWeights: SCORE_WEIGHTS,
    /**
     * The distance facts the sign-up page tells veterans, served rather than
     * hardcoded in the client so the promise made at sign-up and the matcher's
     * actual behaviour can't drift apart.
     */
    // The pilot terms, so the sign-up page shows exactly what the API records.
    pilotTerms: PILOT_TERMS,
    distance: {
      serviceRadiusKm: DEFAULT_SERVICE_RADIUS_KM,
      fairnessMaxExtraKm: FAIRNESS_MAX_EXTRA_KM,
    },
  });
});
