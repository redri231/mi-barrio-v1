import 'dotenv/config';

import cors from 'cors';
import express from 'express';
import helmet from 'helmet';

import { checkDatabase, pool } from './db.js';

const app = express();
const port = Number(process.env.PORT ?? 10000);
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

app.disable('x-powered-by');
app.use(helmet());
app.use(
  cors({
    origin(origin, callback) {
      // Native iOS/Android clients generally do not send an Origin header.
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      return callback(new Error('Origin is not allowed by CORS.'));
    },
  }),
);
app.use(express.json({ limit: '32kb' }));

app.get('/health', (_request, response) => {
  response.json({ status: 'ok' });
});

app.get('/health/ready', async (_request, response) => {
  try {
    const database = await checkDatabase();
    if (!database.postgisEnabled) {
      return response.status(503).json({ status: 'degraded', database });
    }
    response.json({ status: 'ok', database });
  } catch {
    response.status(503).json({ status: 'unavailable', database: { connected: false } });
  }
});

app.get('/api/v1/neighborhoods', async (_request, response) => {
  try {
    const result = await pool.query(`
      SELECT quadrant_id, district_name, quadrant_code
      FROM neighborhood_quadrants
      ORDER BY district_name, quadrant_code
      LIMIT 500
    `);
    response.json({ data: result.rows });
  } catch {
    response.status(503).json({ error: 'Neighborhood data is temporarily unavailable.' });
  }
});

app.use((error, _request, response, _next) => {
  if (error?.message === 'Origin is not allowed by CORS.') {
    return response.status(403).json({ error: 'Origin is not allowed.' });
  }
  if (error instanceof SyntaxError && 'body' in error) {
    return response.status(400).json({ error: 'Invalid JSON body.' });
  }
  console.error('Unhandled API request error.');
  return response.status(500).json({ error: 'Internal server error.' });
});

const server = app.listen(port, '0.0.0.0', () => {
  console.log(`Mi Barrio API listening on port ${port}`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
