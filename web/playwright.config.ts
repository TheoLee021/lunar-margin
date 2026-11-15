import { defineConfig, devices } from '@playwright/test'

const baseURL = process.env.E2E_BASE_URL ?? 'http://localhost:5173'

// 로컬 전용: 백엔드(api/)를 먼저 띄운 뒤 `npm run e2e`.
export default defineConfig({
  testDir: './e2e',
  // Avoid competing DEM horizon workloads against one local FastAPI server.
  workers: 1,
  use: { baseURL },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npm run dev -- --port ${new URL(baseURL).port || '5173'}`,
    url: baseURL,
    reuseExistingServer: true,
  },
})
