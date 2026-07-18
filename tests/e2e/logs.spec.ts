import { expect, test } from "@playwright/test";
import { startAdminSession } from "./admin-session";

test.describe("取得ログ", () => {
  test("未認証ではログ本文を隠し、管理セッション後は即時絞り込みできる", async ({ page }) => {
    await page.goto("/logs");
    await expect(page.getByRole("heading", { name: /取得ログ一覧/ })).toBeVisible();
    await expect(page.getByText(/管理者のみ表示します/)).toBeVisible();
    await expect(page.getByText(/直近 \d+ 件を表示/)).not.toBeVisible();

    await startAdminSession(page);
    await page.goto("/logs");
    const filter = page.getByLabel("取得ログの表示条件");
    await expect(filter).toBeVisible();
    // デザイン正本と同じ「セレクト変更で即絞り込み」(ボタン不要)
    await filter.selectOption("false");
    await expect(page).toHaveURL(/\/logs\?success=false/);
    await expect(page.getByText(/直近 \d+ 件を表示/)).toBeVisible();
  });
});
