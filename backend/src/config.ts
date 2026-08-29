import { MAX_PICKUP_MILES } from './domain/distancePolicy.js';

export const config = {
  port: Number(process.env.PORT ?? 4000),
  corsOrigins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
  seedDemoData: (process.env.SEED_DEMO_DATA ?? '1') !== '0',
  /**
   * The furthest we will ask a veteran to drive to a pickup. We set this rather
   * than asking — a driver signing up can't sensibly guess a radius, and it
   * lets us tune the network's reach in one place. See `domain/distancePolicy`.
   */
  maxPickupMiles: Number(process.env.MAX_PICKUP_MILES ?? MAX_PICKUP_MILES),
  /**
   * Bootstrap convenience: new sign-ups are treated as verified so the demo
   * flow works end to end. Turn this off the moment real requesters are on the
   * network — only verified veterans should ever be matched.
   */
  autoVerifyProviders: (process.env.AUTO_VERIFY_PROVIDERS ?? '1') !== '0',
};
