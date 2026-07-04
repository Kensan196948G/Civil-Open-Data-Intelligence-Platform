import { expect, test } from "@playwright/test";

test.describe("データソース一覧・検索", () => {
  test("一覧に seed データが表示される", async ({ page }) => {
    await page.goto("/sources");
    await expect(page.getByRole("heading", { name: /データソース一覧/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "国土数値情報", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "PLATEAU", exact: true })).toBeVisible();
  });

  test("キーワード検索で絞り込める", async ({ page }) => {
    await page.goto("/sources");
    await page.getByPlaceholder(/河川、道路、標高/).fill("標高");
    await page.getByRole("button", { name: /検索/ }).click();
    await expect(page.getByRole("link", { name: /標高API/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "PLATEAU", exact: true })).not.toBeVisible();
  });

  test("APIキー要否で絞り込める", async ({ page }) => {
    await page.goto("/sources?requiresApiKey=true");
    await expect(page.getByRole("link", { name: /e-Stat API/ })).toBeVisible();
    await expect(page.getByRole("link", { name: "国土数値情報", exact: true })).not.toBeVisible();
  });
});
