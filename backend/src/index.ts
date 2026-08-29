import { createApp } from './app.js';
import { config } from './config.js';
import { seedDemoData } from './data/seed.js';

if (config.seedDemoData) {
  const { providers, slots } = seedDemoData();
  console.log(`Seeded ${providers} demo veterans with ${slots} committed slots.`);
}

createApp().listen(config.port, () => {
  console.log(`VetNet API listening on http://localhost:${config.port}`);
  console.log(`CORS origins: ${config.corsOrigins.join(', ')}`);
});
