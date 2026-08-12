import { expect, test } from "@playwright/test";
import { startAdminSession } from "./admin-session";

test.describe("ロール管理UI（/settings・管理者のみ）", () => {
  test("管理者セッションでロール割当・失効ができる", async ({ page }) => {
    await startAdminSession(page);

    await expect(page.getByRole("heading", { name: "👥 ロール管理" })).toBeVisible();
    await expect(page.getByText("割当はまだありません。既定は viewer です。")).toBeVisible();

    const email = `e2e-role-${Date.now()}@example.com`;
    await page.getByLabel("メールアドレス").fill(email);
    await page.getByLabel("ロール").selectOption("engineer");
    await page.getByRole("button", { name: "➕ 割当" }).click();

    await expect(page.getByRole("status")).toContainText("割当しました");
    await expect(page.getByText(email)).toBeVisible();

    await page.getByRole("button", { name: "失効" }).first().click();
    await expect(page.getByRole("status")).toContainText("失効しました");
  });

  test("未認証ではロール管理パネルが表示されない", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("管理者専用")).toBeVisible();
    await expect(page.getByRole("heading", { name: "👥 ロール管理" })).not.toBeVisible();
  });
});
