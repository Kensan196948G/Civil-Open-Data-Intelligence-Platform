import { expect, test } from "@playwright/test";

test.describe("アクセシビリティ基本回帰", () => {
  test("共通ナビゲーションはスキップリンクと現在地を持つ", async ({ page }) => {
    await page.goto("/");
    const skipLink = page.getByRole("link", { name: "本文へ移動" });
    await skipLink.focus();
    await expect(skipLink).toBeFocused();
    await skipLink.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
    await expect(page.locator('a[aria-current="page"]')).toContainText("ダッシュボード");
  });

  test("検索・ログ・地図フォームにラベルとエラー通知がある", async ({ page }) => {
    await page.goto("/sources");
    await expect(page.getByLabel("キーワード")).toBeVisible();
    await expect(page.getByLabel("カテゴリ")).toBeVisible();
    await expect(page.getByLabel("提供元")).toBeVisible();
    await expect(page.getByLabel("形式")).toBeVisible();
    await expect(page.getByRole("table", { name: "データソース検索結果一覧" })).toBeVisible();

    await page.goto("/logs");
    await expect(page.getByText(/管理者のみ表示します/)).toBeVisible();

    await page.goto("/map");
    await expect(page.getByLabel("緯度")).toBeVisible();
    await expect(page.getByLabel("経度")).toBeVisible();
    await expect(page.getByLabel("GeoJSONデータ")).toBeVisible();
    await page.getByLabel("緯度").fill("91");
    await page.getByLabel("経度").fill("139");
    await page.getByRole("button", { name: /標高取得/ }).click();
    await expect(page.getByRole("alert")).toContainText(/緯度は -90/);
  });

  test("未認証時は管理操作UIを表示しない", async ({ page }) => {
    await page.goto("/sources");
    await expect(page.getByRole("link", { name: /新規登録/ })).not.toBeVisible();

    await page.goto("/tags");
    await expect(page.getByLabel(/タグ名/)).not.toBeVisible();
    await expect(page.getByText(/管理操作を行うには/)).toBeVisible();
  });
});
