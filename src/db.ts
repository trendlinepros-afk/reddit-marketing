import { Pool } from 'pg';
import { config } from './config';

let pool: Pool | null = null;

export function getPool(): Pool {
  if (!pool) {
    pool = new Pool({
      connectionString: config.databaseUrl,
      // Railway Postgres public endpoints require SSL; internal ones don't.
      ssl: process.env.PGSSL === 'disable' ? undefined : { rejectUnauthorized: false },
      max: 5,
    });
  }
  return pool;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
