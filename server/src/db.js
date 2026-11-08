import pg from 'pg';

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Configure it in the API environment.');
}

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX ?? 5),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 10_000,
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
