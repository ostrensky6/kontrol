import { realpathSync } from "node:fs";
import { defineConfig, devices } from "@playwright/test";

/**
 * E2E contra banco REAL: Supabase local (CLI + Docker), com Auth, PostgREST,
 * RLS e todas as migrations. Nada de mock. Nunca aponta para produção: o
 * preparo (scripts/e2e-real-preparar.mjs) recusa qualquer host que não seja
 * 127.0.0.1/localhost, e esta config faz a mesma checagem.
 *
 * Uso (CI, job e2e-real): supabase start → db reset → preparar → build →
 * `npm run test:e2e:real`.
 */
const PORT = process.env.E2E_PORT ?? "3108";
const BASE_URL = `http://localhost:${PORT}`;
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const host = (() => {
  try {
    return new URL(SUPABASE_URL).hostname;
  } catch {
    return "";
  }
})();
if (!["127.0.0.1", "localhost", "[::1]"].includes(host)) {
  throw new Error("E2E real só roda contra Supabase local (NEXT_PUBLIC_SUPABASE_URL em 127.0.0.1).");
}

export default defineConfig({
  testDir: "./e2e-real",
  timeout: 60_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"], ["html", { open: "never", outputFolder: "output/playwright-real-report" }]],
  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  outputDir: "output/playwright-real",
  webServer: {
    command: `npm run start -- -p ${PORT}`,
    cwd: realpathSync(process.cwd()),
    url: `${BASE_URL}/login`,
    reuseExistingServer: false,
    timeout: 120_000,
    env: {
      PLAYWRIGHT_MOCK_SUPABASE: "",
      NEXT_PUBLIC_SUPABASE_URL: SUPABASE_URL,
      NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "",
      SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], channel: "chrome" } }],
});
