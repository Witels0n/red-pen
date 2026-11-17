import { defineConfig } from '@playwright/test'

// Browser smoke tests run against the production build served locally.
// Run with `npm run test:smoke` (separate from `npm test`).
// baseURL is the marker page, so marker specs use page.goto('./'); site specs use absolute paths.
export default defineConfig({
  testDir: 'smoke',
  webServer: {
    command: 'npm run build && npm run preview -- --port 4173 --strictPort',
    url: 'http://localhost:4173/red-pen/',
    reuseExistingServer: false,
    timeout: 120_000,
  },
  use: { baseURL: 'http://localhost:4173/red-pen/mark/' },
})
