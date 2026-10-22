import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: { url: process.env.DATABASE_URL ?? 'postgresql://vms:vms_dev_password@localhost:5432/vms_smart_calling' },
  strict: true,
  verbose: true,
});
