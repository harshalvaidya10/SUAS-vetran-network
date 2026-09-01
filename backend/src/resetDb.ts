import { config } from './config.js';
import { seedDemoData } from './data/seed.js';
import { databaseKind, initializeStore, store } from './data/store.js';

/**
 * One-shot reseed: wipe the local database and lay the demo roster back down.
 *
 * Deliberately a separate command rather than something `npm run dev` does on
 * boot. `tsx watch` reloads the app module on every file save, so a reset that
 * ran at startup would quietly wipe the database each time you edited a file --
 * losing any veteran you had signed up mid-session. Running it once, before the
 * watcher starts, keeps the data alive for the rest of the session.
 */
if (process.env.VERCEL) {
  console.error('Refusing to reset a hosted database.');
  process.exit(1);
}

await initializeStore();
await store.reset();
console.log(`Cleared the ${databaseKind} database.`);

if (config.seedDemoData) {
  const { providers, slots } = await seedDemoData();
  console.log(`Seeded ${providers} demo veterans with ${slots} committed slots.`);
} else {
  console.log('SEED_DEMO_DATA=0, so the database is left empty.');
}

// better-sqlite3 writes synchronously and the pg pool holds the process open,
// so exit explicitly rather than waiting on an idle handle.
process.exit(0);
