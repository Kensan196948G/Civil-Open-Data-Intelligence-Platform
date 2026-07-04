import { expect, test } from "@playwright/test";

test.describe("タグ管理", () => {
  test("タグ追加 → 一覧表示 → 削除(クリーンアップ)", async ({ page, request }) => {
    const name = `E2Eタグ-${Date.now()}`;

    await page.goto("/tags");
    await expect(page.getByRole("heading", { name: /タグ管理/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /災害/ }).first()).toBeVisible();

    await page.getByLabel(/タグ名/).fill(name);
    await page.getByRole("button", { name: /追加/ }).click();
    await expect(page.getByRole("link", { name: new RegExp(name) })).toBeVisible({
      timeout: 15_000,
    });

    // クリーンアップ
    const tags = await (await request.get("/api/tags")).json();
    const created = tags.items.find((t: { name: string }) => t.name === name);
    expect(created).toBeTruthy();
    const res = await request.delete(`/api/tags/${created.id}`);
    expect(res.ok()).toBe(true);
  });

  test("重複タグは追加できない", async ({ page }) => {
    await page.goto("/tags");
    await page.getByLabel(/タグ名/).fill("災害");
    await page.getByRole("button", { name: /追加/ }).click();
    await expect(page.getByText(/同名のタグが既に存在します/)).toBeVisible();
  });
});
