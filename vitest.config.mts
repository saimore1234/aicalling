import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/integration/**/*.test.ts'],
    globals: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    // Integration tests share one PostgreSQL database, so run files serially for determinism.
    fileParallelism: false,
    setupFiles: ['tests/setup.ts'],
    globalSetup: ['tests/global-setup.ts'],
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? 'postgresql://vms:vms_dev_password@localhost:5432/vms_test',
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/15',
      APP_SECRET: 'test-secret-test-secret-test-secret-123456',
      APP_URL: 'https://app.example.test',
      SETUP_TOKEN: 'test-setup-token',
      UPLOAD_DIR: './.test-uploads',
    },
  },
});
