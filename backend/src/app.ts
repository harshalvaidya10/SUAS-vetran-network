import cors from 'cors';
import express, { type Express } from 'express';
import { config } from './config.js';
import { seedDemoData } from './data/seed.js';
import { checkStoreConnection, databaseKind, initializeStore, store } from './data/store.js';
import { errorHandler, notFoundHandler } from './http/errors.js';
import { bookingsRouter } from './routes/bookings.js';
import { catalogRouter } from './routes/catalog.js';
import { providersRouter } from './routes/providers.js';
import { serviceRequestsRouter } from './routes/serviceRequests.js';
import { authRouter } from './routes/auth.js';
import { rideRequestsRouter } from './routes/rideRequests.js';

// Logged at module load so it appears in serverless cold-start logs too, not
// just the local server. A deployment that silently double-books people should
// at least say so.
if (config.demoReusableSlots) {
  console.warn(
    'DEMO MODE: availability blocks are not consumed by a booking, so the same ' +
      'driver can be matched over and over. Set DEMO_REUSABLE_SLOTS=0 for real behaviour.',
  );
}

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

  app.get('/health', async (_req, res) => {
    await checkStoreConnection();
    res.json({
      status: 'ok',
      database: databaseKind,
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

  app.use('/api/v1/catalog', catalogRouter);
  app.use('/api/v1/auth', authRouter);
  app.use('/api/v1/providers', providersRouter);
  app.use('/api/v1/ride-requests', rideRequestsRouter);
  app.use('/api/v1/service-requests', serviceRequestsRouter);
  app.use('/api/v1/bookings', bookingsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

// Module initialization runs once per warm Node.js process. This makes demo
// data available whether Vercel loads app.ts or index.ts, without reseeding on
// every request.
await initializeStore();
if (config.resetDatabaseOnStart) {
  await store.reset();
  console.log('Reset local database for a clean demo startup.');
}
if (config.seedDemoData && (await store.listProviders()).length === 0) {
  const { providers, slots } = await seedDemoData();
  console.log(`Seeded ${providers} demo veterans with ${slots} committed slots.`);
}

const app = createApp();

export default app;
