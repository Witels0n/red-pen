import { defineConfig } from '@playwright/test'

// Browser smoke tests run against the production build served locally.
// Run with `npm run test:smoke` (separate from `npm test`).
export default defineConfig({
  testDir: 'smoke',
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/pdf-marker/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: { baseURL: 'http://localhost:4173/pdf-marker/' },
})
