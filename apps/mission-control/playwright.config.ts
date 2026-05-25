import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  retries: 0,
  use: {
    baseURL: 'http://localhost:3002',
  },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  webServer: {
    command: [
      'MC_DB_PATH=./e2e-test.db',
      'MC_ADMIN_EMAIL=admin@test.com',
      'MC_ADMIN_PASSWORD=testpass123',
      'BETTER_AUTH_SECRET=e2e-test-secret-do-not-use-in-prod',
      'BETTER_AUTH_URL=http://localhost:3002',
      'NEXT_PUBLIC_BETTER_AUTH_URL=http://localhost:3002',
      'next start -p 3002',
    ].join(' '),
    port: 3002,
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
