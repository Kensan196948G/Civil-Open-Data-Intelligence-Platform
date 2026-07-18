import { expect, test } from "@playwright/test";
import { adminRequestHeaders, startAdminSession } from "./admin-session";

test.describe("データソース登録", () => {
  test("新規登録 → 詳細表示 → 削除(クリーンアップ)", async ({ page, request }) => {
    const unique = Date.now();
    const name = `E2Eテストソース-${unique}`;

    await startAdminSession(page);
    await page.goto("/sources/new");
    await page.getByLabel(/データソース名/).fill(name);
    await page.getByLabel(/提供元（既存から選択）/).selectOption({ label: "国土交通省" });
    await page.getByLabel(/公式URL/).fill(`https://example.com/e2e/${unique}`);
    await page.getByLabel("カテゴリ *").selectOption("research");
    await page.getByLabel("データ形式 *").selectOption("JSON");
    await page.getByLabel("アクセス方式 *").selectOption("API");
    await page.getByRole("button", { name: /登録する/ }).click();

    // cuid は20文字以上のため /sources/new にはマッチしない
    await page.waitForURL(/\/sources\/[a-z0-9]{20,}$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name })).toBeVisible();

    // クリーンアップ (API 経由で削除)
    const sourceId = page.url().split("/").pop()!;
    const res = await request.delete(`/api/sources/${sourceId}`, {
      headers: adminRequestHeaders(),
    });
    expect(res.ok()).toBe(true);
  });

  test("必須項目不足はバリデーションで止まる", async ({ page }) => {
    await startAdminSession(page);
    await page.goto("/sources/new");
    // 名称未入力のまま送信 → HTML required でページ遷移しない
    await page.getByRole("button", { name: /登録する/ }).click();
    await expect(page).toHaveURL(/\/sources\/new/);
  });
});
