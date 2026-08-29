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
    // getByRole("textbox") で絞る: getByLabel(/scope/) は過去実行の残存割当が
    // 描画する「失効」ボタン（aria-label に email を含む）ともマッチし、
    // strict mode violation になる（dev.db は実行間で永続するため）。
    await page.getByRole("textbox", { name: /scope/ }).fill("site:site-1");
    await page.getByLabel(/期限/).fill("2099-12-31");
    await page.getByRole("button", { name: "➕ 割当" }).click();

    await expect(page.getByRole("status")).toContainText("割当しました");
    await expect(page.getByRole("cell", { name: email, exact: true })).toBeVisible();
    // 同一 email の行にスコープして検証する。dev.db は実行間で永続するため、
    // 過去実行の残存割当（site:site-1 等）が複数存在し得る（unscoped は
    // strict mode violation になる）。
    const row = page.locator("tr", { hasText: email });
    await expect(row.getByRole("cell", { name: "site:site-1", exact: true })).toBeVisible();
    await expect(row.getByRole("cell", { name: /2099\/12\/31/ })).toBeVisible();

    // クリーンアップ: 割当を失効して次回実行へ状態を漏らさない
    // （dev.db は実行間で永続し、残存割当が緩いセレクタと競合して flaky になる。
    // テスト1と同様に失効する）。
    await page.getByRole("button", { name: `${email} の data-steward (site:site-1) を失効` }).click();
    await expect(page.getByRole("status")).toContainText("失効しました");
  });

  test("未認証ではロール管理パネルが表示されない", async ({ page }) => {
    await page.goto("/settings");
    await expect(page.getByText("管理者専用")).toBeVisible();
    await expect(page.getByRole("heading", { name: "👥 ロール管理" })).not.toBeVisible();
  });
});
