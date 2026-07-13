import { expect, type Page } from "@playwright/test";

export const E2E_ADMIN_TOKEN = "e2e-admin-token-12345678901234567890";

export async function startAdminSession(page: Page) {
  await page.goto("/settings");
  await page.getByLabel("管理操作トークン").fill(E2E_ADMIN_TOKEN);
  await page.getByRole("button", { name: "セッション開始" }).click();
  await expect(page.getByText("状態: 管理セッション有効")).toBeVisible();
}

export function adminRequestHeaders() {
  return { "x-codip-admin-token": E2E_ADMIN_TOKEN };
}
