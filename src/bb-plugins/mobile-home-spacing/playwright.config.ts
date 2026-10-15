import { defineConfig } from '@playwright/test';

export default defineConfig({
  testMatch: '*.spec.ts',
  use: { browserName: 'chromium', headless: true },
});
