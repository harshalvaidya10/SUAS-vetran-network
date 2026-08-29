import cors from 'cors';
import express, { type Express } from 'express';
import { config } from './config.js';
import { seedDemoData } from './data/seed.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { bookingsRouter } from './routes/bookings.js';
import { catalogRouter } from './routes/catalog.js';
import { providersRouter } from './routes/providers.js';
import { serviceRequestsRouter } from './routes/serviceRequests.js';

export function createApp(): Express {
  const app = express();

  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json({ limit: '256kb' }));

  app.use((req, res, next) => {
    const startedAt = Date.now();
    res.on('finish', () => {
      console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - startedAt}ms`);
    });
    next();
  });

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
  });

  app.use('/api/v1/catalog', catalogRouter);
  app.use('/api/v1/providers', providersRouter);
  app.use('/api/v1/service-requests', serviceRequestsRouter);
  app.use('/api/v1/bookings', bookingsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

// Module initialization runs once per warm Node.js process. This makes demo
// data available whether Vercel loads app.ts or index.ts, without reseeding on
// every request.
if (config.seedDemoData) {
  const { providers, slots } = seedDemoData();
  console.log(`Seeded ${providers} demo veterans with ${slots} committed slots.`);
}

const app = createApp();

export default app;
