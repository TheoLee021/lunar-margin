import { defineConfig, devices } from '@playwright/test'

// 로컬 전용: 백엔드(api/)를 먼저 띄운 뒤 `npm run e2e`.
export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5173' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:5173',
    reuseExistingServer: true,
  },
})
