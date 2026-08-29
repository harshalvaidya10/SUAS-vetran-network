import { createApp } from './app.js';
import { config } from './config.js';
import { seedDemoData } from './data/seed.js';

if (config.seedDemoData) {
  const { providers, slots } = seedDemoData();
  console.log(`Seeded ${providers} demo veterans with ${slots} committed slots.`);
}

/**
 * Vercel detects this default export and wraps the Express app in one Function.
 * Do not listen on a port here; src/local.ts owns the traditional local server.
 */
export default createApp();
