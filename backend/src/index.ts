import app from './app.js';

/**
 * Vercel detects this default export and wraps the Express app in one Function.
 * Do not listen on a port here; src/local.ts owns the traditional local server.
 */
export default app;
