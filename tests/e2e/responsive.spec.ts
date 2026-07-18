import { expect, test } from "@playwright/test";

// mobile-chromium プロジェクト (playwright.config.ts) と desktop chromium の両方で実行される。
// mobile 側は本 spec のみを testMatch で対象にしており、既存 spec のモバイル互換性は問わない
// (既存 spec はデスクトップ前提のセレクタを含むため)。

const PAGES = ["/", "/sources", "/map", "/tags", "/logs", "/settings"];

test.describe("レスポンシブ基本回帰", () => {
  for (const path of PAGES) {
    test(`${path} は横スクロールを発生させない`, async ({ page }) => {
      await page.goto(path);
      // 地図タイル等の遅延読込がレイアウト幅へ影響しないことを確認するため描画安定を待つ
      await page.waitForLoadState("domcontentloaded");
      const overflowPx = await page.evaluate(() => {
        const el = document.scrollingElement ?? document.documentElement;
        return el.scrollWidth - window.innerWidth;
      });
      // サブピクセル誤差は許容する
      expect(overflowPx).toBeLessThanOrEqual(1);
    });
  }

  test("主要ナビゲーションが表示され、タップ/クリックで遷移できる", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "主要ナビゲーション" });
    await expect(nav).toBeVisible();
    await nav.getByRole("link", { name: /データソース/ }).click();
    await expect(page).toHaveURL(/\/sources/);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("本文テキストが可読サイズを保つ (12px 以上)", async ({ page }) => {
    await page.goto("/sources");
    const fontSize = await page.evaluate(() => {
      const el = document.querySelector("main p, main td, main li");
      if (!el) return null;
      return Number.parseFloat(window.getComputedStyle(el).fontSize);
    });
    expect(fontSize).not.toBeNull();
    expect(fontSize as number).toBeGreaterThanOrEqual(12);
  });
});
