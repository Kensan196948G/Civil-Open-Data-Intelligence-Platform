import { expect, test } from "@playwright/test";
import { startAdminSession } from "./admin-session";

test.describe("取得ログ", () => {
  test("未認証ではログ本文を隠し、管理セッション後に絞り込みUIを表示する", async ({ page }) => {
    await page.goto("/logs");
    await expect(page.getByRole("heading", { name: /取得ログ一覧/ })).toBeVisible();
    await expect(page.getByText(/管理者のみ表示します/)).toBeVisible();
    await expect(page.getByText(/条件に一致する取得ログ/)).not.toBeVisible();

    await startAdminSession(page);
    await page.goto("/logs");
    await expect(page.getByLabel("表示条件")).toBeVisible();
    await page.getByLabel("表示条件").selectOption("false");
    await page.getByRole("button", { name: "絞り込み" }).click();
    await expect(page).toHaveURL(/\/logs\?success=false/);
    await expect(page.getByText(/条件に一致する取得ログ/)).toBeVisible();
  });
});
