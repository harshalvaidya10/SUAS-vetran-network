import { Router } from 'express';
import { MILITARY_BRANCHES, SERVICE_TYPES } from '../domain/serviceCatalog.js';
import { SCORE_WEIGHTS } from '../domain/matching.js';

export const catalogRouter: Router = Router();

/** Everything the client needs to render its forms without hardcoding enums. */
catalogRouter.get('/', (_req, res) => {
  res.json({
    serviceTypes: SERVICE_TYPES,
    branches: MILITARY_BRANCHES,
    matchWeights: SCORE_WEIGHTS,
  });
});
