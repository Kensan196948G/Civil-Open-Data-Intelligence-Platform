import { expect, test } from "@playwright/test";
import { startAdminSession } from "./admin-session";

test.describe("データソース詳細", () => {
  test("未認証では管理操作を隠し、管理セッション開始後に接続確認パネルが見える", async ({ page }) => {
    await page.goto("/sources");
    await page.getByRole("link", { name: "国土数値情報" }).click();
    await expect(page).toHaveURL(/\/sources\/[a-z0-9]+$/);
    await expect(page.getByRole("heading", { name: /国土数値情報/ })).toBeVisible();
    await expect(page.getByText("基本情報")).toBeVisible();
    await expect(page.getByText("利用条件", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(/管理セッションが必要です/)).toBeVisible();
    await expect(page.getByRole("button", { name: /疎通確認/ })).not.toBeVisible();

    const sourceUrl = page.url();
    await startAdminSession(page);
    await page.goto(sourceUrl);
    await expect(page.getByRole("button", { name: /疎通確認/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /サンプル取得/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /品質スコア再計算/ })).toBeVisible();
    await expect(page.getByText(/最終判断は、必ず公式の利用規約を確認して人間が行って/)).toBeVisible();
  });
});
