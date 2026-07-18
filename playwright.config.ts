import { defineConfig, devices } from "@playwright/test";
const launchOptions = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
  ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
  : undefined;

const e2eAdminToken = "e2e-admin-token-12345678901234567890";

export default defineConfig({
  testDir: "tests/e2e",
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? "github" : "list",
  timeout: 60_000,
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    locale: "ja-JP",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], launchOptions },
    },
    {
      // モバイル viewport の回帰検証。既存 spec はデスクトップ前提のセレクタを
      // 含むため、モバイル互換を検証する responsive.spec のみを対象にする
      name: "mobile-chromium",
      use: { ...devices["Pixel 5"], launchOptions },
      testMatch: /responsive\.spec\.ts$/,
    },
  ],
  webServer: {
    command: `DATABASE_URL='file:./dev.db' CODIP_ENV_MODE=preview CODIP_ACCEPT_SQLITE_PREVIEW=true CODIP_ADMIN_TOKEN='${e2eAdminToken}' CODIP_ALLOW_INSECURE_ADMIN=false CODIP_ALLOWED_ORIGINS='http://localhost:3000' npm run dev`,
    url: "http://localhost:3000",
    // Playwrightはポート疎通しか見ず、DATABASE_URL/admin token/allowed-originが
    // このE2E用の値かは検証できない。既存サーバーを再利用すると別設定(本番相当DB等)へ
    // 誤って向く恐れがあるため、常に上記commandでサーバーを起動し直す
    reuseExistingServer: false,
    timeout: 180_000,
  },
});
