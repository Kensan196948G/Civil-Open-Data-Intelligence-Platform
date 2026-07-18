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

    // 地図: デザイン正本のモック完全一致 (2026-07-18) により緯度経度入力パネルは廃止。
    // GeoJSON 入力のラベルと、不正入力時の通知 (role=status) を検証する
    await page.goto("/map");
    await expect(page.getByLabel("GeoJSONデータ")).toBeVisible();
    await page.getByLabel("GeoJSONデータ").fill("{invalid json");
    await page.getByRole("button", { name: /地図に表示/ }).click();
    await expect(page.getByRole("status").filter({ hasText: /JSON の構文が正しくありません/ })).toBeVisible();
  });

  test("未認証時は管理操作を実行できない", async ({ page }) => {
    await page.goto("/sources");
    await expect(page.getByRole("link", { name: /新規登録/ })).not.toBeVisible();

    // タグ追加フォームはデザイン正本どおり常時表示するが、
    // 未認証時は操作不可 (disabled) + 管理セッション案内を出す
    await page.goto("/tags");
    await expect(page.getByRole("heading", { name: /タグ追加/ })).toBeVisible();
    await expect(page.getByLabel(/タグ名/)).toBeDisabled();
    await expect(page.getByRole("button", { name: /追加/ })).toBeDisabled();
    await expect(page.getByText(/タグの追加には管理セッションが必要です/)).toBeVisible();
    await expect(page.getByRole("heading", { name: /登録済みタグ/ })).toBeVisible();
  });
});
