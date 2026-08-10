import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { E2E_DB_PATH, seedDatabase } from "./e2e/global-setup.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const serverEnv = {
  DATABASE_URL: `file:${E2E_DB_PATH}`,
  PORT: "3000",
};

// Top-level await: must fully finish (delete, recreate, seed) before
// Playwright reads `webServer` below and spawns the server process — see
// the comment on seedDatabase() for why `globalSetup` can't guarantee this.
await seedDatabase();

export default defineConfig({
  testDir: "./e2e",
  testMatch: "**/*.spec.ts",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "npx tsx server/index.ts",
      cwd: __dirname,
      env: serverEnv,
      url: "http://localhost:3000/health",
      reuseExistingServer: false,
    },
    {
      command: "npx vite",
      cwd: __dirname,
      url: "http://localhost:5173",
      reuseExistingServer: false,
    },
  ],
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
