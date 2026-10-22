import { execFileSync } from 'node:child_process';
import path from 'node:path';
import IORedis from 'ioredis';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';

export const E2E_ADMIN = { email: 'e2e-admin@example.com', password: 'E2e-Correct-Horse-9', name: 'E2E Admin' };
export const E2E_SALES = { email: 'e2e-sales@example.com', password: 'E2e-Correct-Horse-9', name: 'E2E Sales' };

/** Creates (if needed) and resets the dedicated e2e database, then seeds baseline data and two users. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? 'postgresql://vms:vms_dev_password@localhost:5432/vms_e2e';
  const redisUrl = process.env.E2E_REDIS_URL ?? 'redis://localhost:6379/14';
  const adminUrl = new URL(url);
  const dbName = adminUrl.pathname.slice(1);
  adminUrl.pathname = '/postgres';
  const admin = new Pool({ connectionString: adminUrl.toString(), max: 1 });
  try {
    const { rowCount } = await admin.query('select 1 from pg_database where datname = $1', [dbName]);
    if (!rowCount) await admin.query(`create database "${dbName.replace(/"/g, '')}"`);
  } finally { await admin.end(); }

  const pool = new Pool({ connectionString: url, max: 2 });
  await migrate(drizzle(pool), { migrationsFolder: path.resolve(process.cwd(), 'drizzle') });
  const { rows } = await pool.query("select tablename from pg_tables where schemaname = 'public' and tablename <> '__drizzle_migrations'");
  if (rows.length) await pool.query(`TRUNCATE ${rows.map((r: { tablename: string }) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await pool.end();

  // Baseline data + users via the project's own scripts (they resolve the "@/" alias through tsx).
  const env = { ...process.env, DATABASE_URL: url, REDIS_URL: redisUrl, LOG_LEVEL: 'silent' };
  const run = (args: string[], extra: Record<string, string> = {}) => execFileSync('npx', ['tsx', ...args], { env: { ...env, ...extra }, stdio: 'pipe' });
  run(['scripts/seed.ts']);
  run(['scripts/create-admin.ts', '--email', E2E_ADMIN.email, '--name', E2E_ADMIN.name], { ADMIN_PASSWORD: E2E_ADMIN.password });
  const { hashPassword } = await import('../../src/lib/passwords');
  const pool2 = new Pool({ connectionString: url, max: 1 });
  await pool2.query("insert into users (email, name, role, password_hash) values ($1, $2, 'SALES_EXECUTIVE', $3)", [E2E_SALES.email, E2E_SALES.name, await hashPassword(E2E_SALES.password)]);
  await pool2.end();
  const redis = new IORedis(redisUrl);
  await redis.flushdb();
  redis.disconnect();
}
