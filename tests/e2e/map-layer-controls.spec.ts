import { expect, test } from "@playwright/test";

/**
 * 地図のデータレイヤー操作と矩形検索の E2E（Deep Debug 対応 5/6）。
 *
 * ■ なぜ足すのか
 *
 * `tests/e2e/map.spec.ts` の冒頭コメントは
 *
 *   「レイヤー切替・緯度経度入力パネル・実標高 API 呼び出しは廃止された」
 *
 * と書いているが、実装（`src/components/MapView.tsx`）にはレイヤー切替
 * チェックボックス・透明度スライダー・矩形検索・属性検索が**現存し UI にも出る**。
 * コメントが古いまま残り、その結果これらの機能は**テストが 1 件も無い**状態だった。
 * 「廃止された」という誤った前提が、カバレッジの穴をそのまま正当化していた。
 *
 * ここでは「操作できること」ではなく「操作した結果が地図の状態へ反映されること」
 * を見る。チェックボックスが押せるだけのテストは、描画が壊れても緑になる。
 */
test.describe("地図のデータレイヤー操作", () => {
  test("レイヤーを表示にすると透明度スライダーが現れ、値を変えられる", async ({ page }) => {
    await page.goto("/map");
    await page.waitForLoadState("load");

    await expect(page.getByRole("heading", { name: /データレイヤー/ })).toBeVisible({
      timeout: 20_000,
    });

    // レイヤー一覧は /api/v1/layers 由来。読み込み前は「読み込み中」が出る。
    const toggles = page.getByRole("checkbox", { name: / を表示$/ });
    await expect(toggles.first()).toBeVisible({ timeout: 20_000 });

    const firstToggle = toggles.first();
    const label = (await firstToggle.getAttribute("aria-label")) ?? "";
    const layerTitle = label.replace(/ を表示$/, "");
    expect(layerTitle).not.toBe("");

    // 表示前は透明度スライダーが無い（visible のときだけ描画される）。
    const opacity = page.getByRole("slider", { name: `${layerTitle} の透明度` });
    await expect(opacity).toHaveCount(0);

    await firstToggle.check();

    // 状態がUIへ反映される = 単に押せるだけではないことを見る。
    await expect(firstToggle).toBeChecked();
    await expect(opacity).toBeVisible({ timeout: 10_000 });

    await opacity.fill("0.5");
    await expect(opacity).toHaveValue("0.5");

    // 非表示に戻すとスライダーも消える。
    await firstToggle.uncheck();
    await expect(firstToggle).not.toBeChecked();
    await expect(opacity).toHaveCount(0);
  });

  test("矩形検索モードは開始と終了を切り替えられる", async ({ page }) => {
    await page.goto("/map");
    await page.waitForLoadState("load");

    const start = page.getByRole("button", { name: /🔲 矩形検索$/ });
    await expect(start).toBeVisible({ timeout: 20_000 });

    await start.click();
    // モードに入るとボタンの意味が反転する。ラベルだけでなく状態が変わることを見る。
    const stop = page.getByRole("button", { name: /矩形検索を終了/ });
    await expect(stop).toBeVisible();

    await stop.click();
    await expect(page.getByRole("button", { name: /🔲 矩形検索$/ })).toBeVisible();
  });

  test("属性検索と時間フィルタの入力を受け付ける", async ({ page }) => {
    await page.goto("/map");
    await page.waitForLoadState("load");

    const keyword = page.getByLabel("属性検索キーワード");
    await expect(keyword).toBeVisible({ timeout: 20_000 });
    await keyword.fill("河川");
    await expect(keyword).toHaveValue("河川");

    const from = page.getByLabel("時間フィルタ開始日");
    const to = page.getByLabel("時間フィルタ終了日");
    await from.fill("2026-01-01");
    await to.fill("2026-12-31");
    await expect(from).toHaveValue("2026-01-01");
    await expect(to).toHaveValue("2026-12-31");
  });
});
