import { expect, test } from "@playwright/test";
import { startAdminSession } from "./admin-session";

test.describe("監査ログと設定 (デザイン正本整合)", () => {
  test("未認証では監査ログ本文を隠す", async ({ page }) => {
    await page.goto("/audit");
    await expect(page.getByRole("heading", { name: /監査ログ/ })).toBeVisible();
    await expect(page.getByText(/管理者のみ表示します/)).toBeVisible();
  });

  test("設定変更が永続化され、監査ログへ「設定変更」イベントとして記録される", async ({
    page,
  }) => {
    await page.goto("/settings");
    // 未認証時はセレクトが無効で、管理セッション開始の案内を表示する
    await expect(page.getByText(/変更には管理セッションが必要です/)).toBeVisible();
    await expect(page.getByLabel(/タイムアウト/)).toBeDisabled();

    await startAdminSession(page);
    await page.goto("/settings");

    const timeoutSelect = page.getByLabel(/タイムアウト/);
    await expect(timeoutSelect).toBeEnabled();
    // 現在値に依存しないよう、現在値と異なる選択肢へ変更する (再実行・途中失敗にも安定)
    const original = await timeoutSelect.inputValue();
    const target = original === "60" ? "120" : "60";
    try {
      await timeoutSelect.selectOption(target);
      await expect(
        page.getByText(new RegExp(`タイムアウトを ${target} 秒に変更しました`)),
      ).toBeVisible();

      // 監査ログにログイン・設定変更イベントが記録されている
      await page.goto("/audit");
      await expect(page.getByText(/\d+ 件の操作履歴/)).toBeVisible();
      await expect(page.getByRole("cell", { name: "設定変更" }).first()).toBeVisible();
      await expect(
        page.getByRole("cell", { name: `${original}秒 → ${target}秒` }).first(),
      ).toBeVisible();
      await expect(page.getByRole("cell", { name: "ログイン" }).first()).toBeVisible();
    } finally {
      // 元の値へ復元する (この変更も監査イベントになる)
      await page.goto("/settings");
      await page.getByLabel(/タイムアウト/).selectOption(original);
      await expect(
        page.getByText(new RegExp(`タイムアウトを ${original} 秒に変更しました`)),
      ).toBeVisible();
    }
  });

  test("監査ログのエクスポートボタンを表示する", async ({ page }) => {
    await startAdminSession(page);
    await page.goto("/audit");
    await expect(page.getByRole("button", { name: /CSV/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /PDF/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /HTML/ })).toBeVisible();
  });
});
