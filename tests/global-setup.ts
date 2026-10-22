import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

/** Applies the real SQL migrations to the test database before any test runs (this doubles as the migration check). */
export default async function setup() {
  const url = process.env.TEST_DATABASE_URL ?? 'postgresql://vms:vms_dev_password@localhost:5432/vms_test';
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    await migrate(drizzle(pool), { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });
  } finally {
    await pool.end();
  }
}
