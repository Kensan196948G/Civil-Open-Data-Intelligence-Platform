import { expect, test } from "@playwright/test";
import { startAdminSession } from "./admin-session";

test.describe("ロール管理UI（/settings・管理者のみ）", () => {
  test("管理者セッションでロール割当・失効ができる", async ({ page }) => {
    await startAdminSession(page);
    // セッションCookie確立後にサーバー側レンダリングを再取得する
    await page.goto("/settings");

    await expect(page.getByRole("heading", { name: "👥 ロール管理" })).toBeVisible();
    // seed（prisma/seed.ts）が投入するデモ割当が表示される
    await expect(page.getByRole("cell", { name: "demo.engineer@example.com", exact: true })).toBeVisible();

    const email = `e2e-role-${Date.now()}@example.com`;
    await page.getByLabel("メールアドレス").fill(email);
    await page.getByLabel("ロール").selectOption("engineer");
    await page.getByRole("button", { name: "➕ 割当" }).click();

    await expect(page.getByRole("status")).toContainText("割当しました");
    await expect(page.getByRole("cell", { name: email, exact: true })).toBeVisible();

    await page.getByRole("button", { name: `${email} の engineer (global) を失効` }).click();
    await expect(page.getByRole("status")).toContainText("失効しました");
  });

  test("scopeと将来の期限を指定して割当できる", async ({ page }) => {
    await startAdminSession(page);
    await page.goto("/settings");

    const email = `e2e-scoped-${Date.now()}@example.com`;
    await page.getByLabel("メールアドレス").fill(email);
    await page.getByLabel("ロール").selectOption("data-steward");
    await page.getByLabel(/scope/).fill("site:site-1");
    await page.getByLabel(/期限/).fill("2099-12-31");
    await page.getByRole("button", { name: "➕ 割当" }).click();

    await expect(page.getByRole("status")).toContainText("割当しました");
    await expect(page.getByRole("cell", { name: email, exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "site:site-1", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: /2099\/12\/31/ })).toBeVisible();
  });

  test("未認証ではロール管理パネルが表示されない", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("管理者専用")).toBeVisible();
    await expect(page.getByRole("heading", { name: "👥 ロール管理" })).not.toBeVisible();
  });
});
