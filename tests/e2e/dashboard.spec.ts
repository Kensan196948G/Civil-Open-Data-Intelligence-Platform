import { expect, test } from "@playwright/test";

test.describe("ダッシュボード", () => {
  test("サマリーカードとログセクションが表示される", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: /ダッシュボード/ })).toBeVisible();
    await expect(page.getByText("登録データソース").first()).toBeVisible();
    await expect(page.getByText("接続成功").first()).toBeVisible();
    await expect(page.getByText("接続失敗").first()).toBeVisible();
    await expect(page.getByText("要確認").first()).toBeVisible();
    await expect(page.getByText("カテゴリ別件数")).toBeVisible();
    await expect(page.getByText("最近の取得ログ")).toBeVisible();
  });

  test("カテゴリリンクから一覧の絞り込みへ遷移できる", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("link", { name: "気象・防災" }).first().click();
    await expect(page).toHaveURL(/\/sources\?category=weather/);
    await expect(page.getByRole("link", { name: /気象庁 防災情報XML/ })).toBeVisible();
  });
});
