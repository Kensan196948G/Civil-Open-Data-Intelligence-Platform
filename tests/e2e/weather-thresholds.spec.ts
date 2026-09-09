import { expect, test } from "@playwright/test";
import { startAdminSession } from "./admin-session";

/**
 * 気象・海象ワークスペースの「🎚️ 閾値管理」タブの E2E（Deep Debug 対応 5/6）。
 *
 * ■ なぜ足すのか
 *
 * `tests/e2e/integrated-screens.spec.ts` は気象画面の「気象」「海象」「取得状況」
 * しか触っておらず、閾値管理タブは**テストが 1 件も無かった**。施工可否判定の
 * 基準値を作る画面であり、ここが壊れると判定そのものが誤る。
 *
 * また Deep Debug で、このタブの `createThreshold` / `deleteThreshold` に
 * `try/catch` が無く、ネットワーク断でボタンを押しても**何も表示されない**
 * 欠陥が見つかっている（PR #230 で修正）。その修正が効いていることも見る。
 */
const SITE_TAB = "🎚️ 閾値管理";

test.describe("閾値管理タブ", () => {
  test("一覧と登録フォームが表示され、再読込できる", async ({ page }) => {
    await startAdminSession(page);
    await page.goto("/weather");
    await page.waitForLoadState("load");

    await page.getByRole("button", { name: SITE_TAB }).click();

    await expect(page.getByRole("heading", { name: /閾値一覧/ })).toBeVisible({ timeout: 20_000 });
    // 登録フォームの各項目が揃っている（ラベル無しのコントロールを作らない）。
    // getByLabel は既定で部分一致するため、「種別」は「作業種別」にも当たって
    // strict mode violation になる。短いラベルは exact で取る。
    await expect(page.getByLabel("適用範囲")).toBeVisible();
    await expect(page.getByLabel("作業種別", { exact: true })).toBeVisible();
    await expect(page.getByLabel("指標", { exact: true })).toBeVisible();
    await expect(page.getByLabel("演算子")).toBeVisible();
    await expect(page.getByLabel("値", { exact: true })).toBeVisible();
    await expect(page.getByLabel("種別", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: /再読込/ }).click();
    // 再読込で画面が壊れない。
    await expect(page.getByRole("heading", { name: /閾値一覧/ })).toBeVisible();
  });

  test("ネットワーク断で登録に失敗したとき、無反応にならず失敗を伝える", async ({ page }) => {
    // PR #230 以前は fetch の reject が未処理の promise rejection になり、
    // ボタンを押しても何も起きなかった。
    await startAdminSession(page);
    await page.goto("/weather");
    await page.waitForLoadState("load");
    await page.getByRole("button", { name: SITE_TAB }).click();
    await expect(page.getByLabel("値", { exact: true })).toBeVisible({ timeout: 20_000 });

    await page.route("**/api/v1/thresholds", async (route) => {
      if (route.request().method() === "POST") {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.getByLabel("値", { exact: true }).fill("12.5");
    await page.getByRole("button", { name: /登録|追加|保存/ }).first().click();

    // 「何も起きない」ことこそが元の欠陥だったので、何か伝わることを主張する。
    await expect(page.getByText(/失敗しました/)).toBeVisible({ timeout: 10_000 });
  });

  test("登録フォームの選択肢が仕様どおり揃っている", async ({ page }) => {
    // 指標や演算子が欠けると、作れない基準値が生まれる。
    await startAdminSession(page);
    await page.goto("/weather");
    await page.waitForLoadState("load");
    await page.getByRole("button", { name: SITE_TAB }).click();

    const metric = page.getByLabel("指標", { exact: true });
    await expect(metric).toBeVisible({ timeout: 20_000 });
    for (const value of ["precipMm1h", "temperatureC", "windSpeedMs", "sigWaveHM"]) {
      await expect(metric.locator(`option[value="${value}"]`)).toHaveCount(1);
    }

    const op = page.getByLabel("演算子");
    for (const value of [">=", "<", "<=", ">"]) {
      await expect(op.locator(`option[value="${value}"]`)).toHaveCount(1);
    }

    const scope = page.getByLabel("適用範囲");
    await expect(scope.locator('option[value="site"]')).toHaveCount(1);
    await expect(scope.locator('option[value="global"]')).toHaveCount(1);
  });
});
