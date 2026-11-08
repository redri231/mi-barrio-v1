import pg from 'pg';

const { Pool } = pg;
const poolMax = Number(process.env.PG_POOL_MAX ?? 5);

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Configure it in the API environment.');
}

if (!Number.isInteger(poolMax) || poolMax < 1 || poolMax > 20) {
  throw new Error('PG_POOL_MAX must be an integer between 1 and 20.');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: poolMax,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 2_000,
  statement_timeout: 2_000,
  keepAlive: true,
});

pool.on('error', () => {
  // Avoid logging connection details or credentials.
  console.error('Unexpected error on an idle PostgreSQL connection.');
});

export async function checkDatabase() {
  const result = await pool.query(`
    SELECT EXISTS (
      SELECT 1 FROM pg_extension WHERE extname = 'postgis'
    ) AS postgis_enabled
  `);

  return {
    connected: true,
    postgisEnabled: result.rows[0].postgis_enabled,
  };
}
