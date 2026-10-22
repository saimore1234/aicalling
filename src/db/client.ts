import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import * as schema from './schema';
import { getEnv } from '@/lib/env';

export type Database = NodePgDatabase<typeof schema>;

const globalForDb = globalThis as unknown as { __vmsPool?: Pool; __vmsDb?: Database };

function create(): { pool: Pool; db: Database } {
  const pool = new Pool({
    connectionString: getEnv().DATABASE_URL,
    max: Number(process.env.DB_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
  });
  pool.on('error', () => {
    /* idle client errors are surfaced on next query; avoid crashing the process */
  });
  return { pool, db: drizzle(pool, { schema }) };
}

export function getPool(): Pool {
  if (!globalForDb.__vmsPool) {
    const { pool, db } = create();
    globalForDb.__vmsPool = pool;
    globalForDb.__vmsDb = db;
  }
  return globalForDb.__vmsPool!;
}

export function getDb(): Database {
  getPool();
  return globalForDb.__vmsDb!;
}

/** Lazy proxy so modules can `import { db }` without touching the pool at import time (e.g. during `next build`). */
export const db: Database = new Proxy({} as Database, {
  get(_t, prop) {
    return Reflect.get(getDb() as object, prop);
  },
});

export async function closeDb() {
  if (globalForDb.__vmsPool) {
    await globalForDb.__vmsPool.end();
    globalForDb.__vmsPool = undefined;
    globalForDb.__vmsDb = undefined;
  }
}

export type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];
export { schema };
