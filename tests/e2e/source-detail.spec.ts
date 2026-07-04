import { expect, test } from "@playwright/test";

test.describe("データソース詳細", () => {
  test("一覧から詳細へ遷移し基本情報・利用条件・接続確認パネルが見える", async ({ page }) => {
    await page.goto("/sources");
    await page.getByRole("link", { name: "国土数値情報" }).click();
    await expect(page).toHaveURL(/\/sources\/[a-z0-9]+$/);
    await expect(page.getByRole("heading", { name: /国土数値情報/ })).toBeVisible();
    await expect(page.getByText("基本情報")).toBeVisible();
    await expect(page.getByText("利用条件", { exact: false }).first()).toBeVisible();
    await expect(page.getByRole("button", { name: /疎通確認/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /サンプル取得/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /品質スコア再計算/ })).toBeVisible();
    await expect(page.getByText(/最終判断は、必ず公式の利用規約を確認して人間が行って/)).toBeVisible();
  });
});
