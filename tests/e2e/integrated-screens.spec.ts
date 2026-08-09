import { expect, test } from "@playwright/test";

/**
 * 統合後新画面 (地形分析 / 気象・海象 / 施工判定 / 現場管理 / レポート) の
 * 回帰テストとアクセシビリティ基本検証。
 *
 * 外部 API (GSI DEM / Open-Meteo / AMeDAS) に依存する成功系は、CI の
 * ネットワーク状態で揺れるため、UI 構造・管理ガード・fail-closed 表示を
 * 中心に検証する。データ取得成功系は unit test (terrain-*.test.ts /
 * weather-extra-routes.test.ts) がカバーする。
 */

test.describe("統合後画面: 地形分析", () => {
  test("地図・検索・レイヤー選択・解析タブが表示される", async ({ page }) => {
    await page.goto("/terrain");
    await expect(page.getByRole("heading", { name: /地形分析/ })).toBeVisible();
    await expect(page.getByRole("search")).toBeVisible();
    await expect(page.getByLabel("地点検索")).toBeVisible();
    await expect(page.getByLabel("ベースレイヤー")).toBeVisible();
    await expect(page.getByLabel("傾斜量図を表示")).toBeVisible();
    await expect(page.getByLabel("陰影起伏図を表示")).toBeVisible();
    await expect(page.getByTestId("terrain-map-view")).toBeVisible({ timeout: 20_000 });

    // 出典表記 (国土地理院) は常時表示される
    await expect(page.getByText("国土地理院タイル").first()).toBeVisible();

    // 解析タブ
    await expect(page.getByRole("button", { name: /⛰️ 地形分析/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /📈 断面分析/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /⚠️ 確認支援/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /🧾 出力・共有/ })).toBeVisible();

    // 地点未指定時は解析実行できない
    await expect(page.getByRole("button", { name: /🔍 地形解析を実行/ })).toBeDisabled();
    await expect(page.getByText(/地図をクリックして対象地点を指定してください/)).toBeVisible();
  });

  test("空検索はエラー通知、不正な検索語は地点なし通知を表示する", async ({ page }) => {
    await page.goto("/terrain");
    const search = page.getByLabel("地点検索");

    await search.fill("");
    await page.getByRole("button", { name: "🔍 検索" }).click();
    await expect(page.getByRole("alert")).toContainText("検索語を入力してください");

    await search.fill("存在しない地名XYZ");
    await page.getByRole("button", { name: "🔍 検索" }).click();
    await expect(page.getByRole("alert")).toContainText("該当する地点が見つかりませんでした");
  });

  test("座標検索で地点指定でき、出力・共有タブに共有URLと出力リンクが表示される", async ({ page }) => {
    await page.goto("/terrain");
    await page.getByLabel("地点検索").fill("35.3606, 138.7274");
    await page.getByRole("button", { name: "🔍 検索" }).click();

    // 座標指定により解析実行ボタンが有効化される
    await expect(page.getByRole("button", { name: /🔍 地形解析を実行/ })).toBeEnabled();

    await page.getByRole("button", { name: /🧾 出力・共有/ }).click();
    await expect(page.getByLabel("共有URL")).toBeVisible();
    await expect(page.getByLabel("共有URL")).toHaveValue(/#.*35\.3606.*138\.7274/);
    for (const format of ["MARKDOWN", "CSV", "JSON"]) {
      await expect(page.getByRole("button", { name: new RegExp(`レポート出力 \\(${format}\\)`) })).toBeEnabled();
    }
    await expect(page.getByRole("button", { name: /💾 案件を保存/ })).toBeEnabled();
  });

  test("レイヤー切替と断面タブの状態遷移が表示される", async ({ page }) => {
    await page.goto("/terrain");
    await page.getByLabel("ベースレイヤー").selectOption("pale");
    await expect(page.getByLabel("ベースレイヤー")).toHaveValue("pale");

    await page.getByRole("button", { name: /📈 断面分析/ }).click();
    await expect(page.getByRole("button", { name: /📐 地図で断面線を指定/ })).toBeVisible();
    await page.getByRole("button", { name: /📐 地図で断面線を指定/ }).click();
    await expect(page.getByText("地図で断面の始点をクリックしてください")).toBeVisible();
  });
});

test.describe("統合後画面: 気象・海象", () => {
  test("気象タブ: 観測カード・風配図・週間予報・出典が表示される", async ({ page }) => {
    await page.goto("/weather");
    await expect(page.getByRole("heading", { name: /気象・海象/ })).toBeVisible();
    await expect(page.getByLabel("現場選択")).toBeVisible();
    await expect(page.getByRole("button", { name: /🔄 観測データ更新/ })).toBeVisible();

    // デモ現場はシード済み
    await expect(page.getByLabel("現場選択")).toContainText("TYO-01");

    for (const label of ["気温", "湿度", "降水量 (10分)", "風速"]) {
      await expect(page.getByText(label).first()).toBeVisible();
    }
    await expect(page.getByRole("heading", { name: /風配図/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /最新観測の出典・時刻/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /週間予報/ })).toBeVisible();
    await expect(page.getByText(/出典: 気象庁 AMeDAS/)).toBeVisible();
    await expect(page.getByText(/Open-Meteo Forecast API/)).toBeVisible();
  });

  test("海象タブ: 観測テーブルと参考情報の注記が表示される", async ({ page }) => {
    await page.goto("/weather");
    await page.getByRole("button", { name: /🌊 海象/ }).click();
    await expect(page.getByText("有義波高").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /海象観測/ })).toBeVisible();
    await expect(page.getByText(/Open-Meteo Marine は参考情報です/)).toBeVisible();
  });

  test("取得状況タブ: ETLジョブ一覧と手動実行ボタンが表示される", async ({ page }) => {
    await page.goto("/weather");
    await page.getByRole("button", { name: /⚙️ 取得状況/ }).click();
    await expect(page.getByRole("heading", { name: /データ取得状況/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /AMeDAS を手動実行/ })).toBeVisible();
    await expect(page.getByRole("button", { name: /Marine を手動実行/ })).toBeVisible();
  });
});

test.describe("統合後画面: 施工可否判定", () => {
  test("判定フォームとfail-closed注記が表示される", async ({ page }) => {
    await page.goto("/decisions");
    await expect(page.getByRole("heading", { name: /施工可否判定/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /施工可否判定 \(go \/ caution \/ stop\)/ })).toBeVisible();
    await expect(page.getByLabel("作業種別")).toContainText("コンクリート打設");
    await expect(page.getByRole("button", { name: /🧭 判定実行/ })).toBeEnabled();
    await expect(page.getByRole("button", { name: /🤖 AI参考解説/ })).toBeEnabled();
    await expect(page.getByText(/欠測がある場合は施工可と判定しません \(fail-closed\)/)).toBeVisible();
  });

  test("未認証で判定実行すると管理認証エラーが表示される (権限ガード)", async ({ page }) => {
    await page.goto("/decisions");
    await page.getByRole("button", { name: /🧭 判定実行/ }).click();
    await expect(page.getByRole("status")).toContainText("管理操作の認証に失敗しました");
  });

  test("未認証でAI参考解説を実行するとエラーになるがUIは維持される", async ({ page }) => {
    await page.goto("/decisions");
    await page.getByRole("button", { name: /🤖 AI参考解説/ }).click();
    await expect(page.getByRole("status")).toContainText(/認証|取得に失敗/);
  });
});

test.describe("統合後画面: 現場管理", () => {
  test("現場一覧・全国地図・登録フォームが表示される", async ({ page }) => {
    await page.goto("/sites");
    await expect(page.getByRole("heading", { name: /現場管理/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /現場一覧/ })).toBeVisible();
    await expect(page.getByText("TYO-01").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: /全国地図/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /現場登録 \(管理認証必須\)/ })).toBeVisible();
    await expect(page.getByLabel("現場名")).toBeVisible();
    await expect(page.getByLabel("緯度")).toBeVisible();
    await expect(page.getByLabel("経度")).toBeVisible();
  });

  test("未認証で現場登録すると管理認証エラーが表示される (権限ガード)", async ({ page }) => {
    await page.goto("/sites");
    await page.getByLabel("コード").fill("E2E-001");
    await page.getByLabel("現場名").fill("E2Eテスト現場");
    await page.getByLabel("緯度").fill("35.0");
    await page.getByLabel("経度").fill("139.0");
    await page.getByRole("button", { name: "登録", exact: true }).click();
    await expect(page.getByRole("status")).toContainText("管理操作の認証に失敗しました");
  });
});

test.describe("統合後画面: レポート", () => {
  test("テンプレート・形式・期間フォームが表示される", async ({ page }) => {
    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: /レポート/ })).toBeVisible();
    await expect(page.getByRole("heading", { name: /レポート出力/ })).toBeVisible();
    await expect(page.getByLabel("テンプレート")).toContainText("日次 (daily)");
    await expect(page.getByLabel("形式")).toContainText("CSV");
    await expect(page.getByLabel("開始日")).toBeVisible();
    await expect(page.getByLabel("終了日")).toBeVisible();
    await expect(page.getByRole("button", { name: /⬇️ 生成・ダウンロード/ })).toBeVisible();
  });

  test("未認証でレポート生成すると管理認証エラーが表示される (権限ガード)", async ({ page }) => {
    await page.goto("/reports");
    await page.getByLabel("開始日").fill("2026-08-01");
    await page.getByLabel("終了日").fill("2026-08-08");
    await page.getByRole("button", { name: /⬇️ 生成・ダウンロード/ }).click();
    await expect(page.getByRole("status")).toContainText("管理操作の認証に失敗しました");
  });
});

test.describe("統合後画面: アクセシビリティ基本", () => {
  test("新画面の見出し・フォームラベル・ナビゲーションが構造化されている", async ({ page }) => {
    for (const path of ["/terrain", "/weather", "/decisions", "/sites", "/reports"]) {
      await page.goto(path);
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
      await expect(page.locator("#main-content")).toBeVisible();
      // 新画面でも現在地ナビゲーションが維持される
      await expect(page.locator('a[aria-current="page"]')).toBeVisible();
    }
  });

  test("管理操作フォームにはアクセシブルな名前が付与されている", async ({ page }) => {
    await page.goto("/sites");
    await expect(page.getByLabel("現場名")).toBeAttached();
    await expect(page.getByLabel("種別")).toBeAttached();
    await expect(page.getByLabel("AMeDAS局番")).toBeAttached();
    await expect(page.getByLabel("住所")).toBeAttached();

    await page.goto("/terrain");
    await expect(page.getByLabel("共有URL")).not.toBeVisible();
    await page.getByRole("button", { name: /🧾 出力・共有/ }).click();
    await expect(page.getByLabel("共有URL")).toBeVisible();
  });
});
