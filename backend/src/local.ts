import app from './index.js';
import { config } from './config.js';

app.listen(config.port, () => {
  console.log(`VetNet API listening on http://localhost:${config.port}`);
  console.log(`CORS origins: ${config.corsOrigins.join(', ')}`);
});
