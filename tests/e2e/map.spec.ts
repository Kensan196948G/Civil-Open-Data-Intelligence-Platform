import { expect, test } from "@playwright/test";

// デザイン正本のモック完全一致 (人間判断 2026-07-18):
// OSM タイル + クリック標高シミュレーション + GeoJSON オーバーレイ。
// レイヤー切替・緯度経度入力パネル・実標高 API 呼び出しは廃止された。

test.describe("地図表示", () => {
  test("地図と OSM 出典表記が表示される", async ({ page }) => {
    await page.goto("/map");
    await expect(page.getByRole("heading", { name: /地図表示/ })).toBeVisible();
    await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".leaflet-control-attribution")).toContainText("OpenStreetMap");
    await expect(page.getByText(/シミュレーション値/).first()).toBeVisible();
  });

  test("GeoJSON を貼り付けて表示できる", async ({ page }) => {
    await page.goto("/map");
    await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 20_000 });

    const geojson = JSON.stringify({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: {
            type: "Polygon",
            coordinates: [
              [
                [139.7, 35.6],
                [139.8, 35.6],
                [139.8, 35.7],
                [139.7, 35.7],
                [139.7, 35.6],
              ],
            ],
          },
        },
      ],
    });
    await page.getByPlaceholder(/FeatureCollection/).fill(geojson);
    await page.getByRole("button", { name: /地図に表示/ }).click();
    await expect(page.locator(".leaflet-overlay-pane path")).toHaveCount(1);
    await expect(page.getByText("✅ 地図に反映しました")).toBeVisible();
  });

  test("不正な GeoJSON はエラー表示される", async ({ page }) => {
    await page.goto("/map");
    await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 20_000 });
    await page.getByPlaceholder(/FeatureCollection/).fill("{invalid json");
    await page.getByRole("button", { name: /地図に表示/ }).click();
    await expect(page.getByText(/JSON の構文が正しくありません/)).toBeVisible();
  });

  test("地図クリックで標高シミュレーション値が表示される", async ({ page }) => {
    await page.goto("/map");
    const map = page.locator(".leaflet-container");
    await expect(map).toBeVisible({ timeout: 20_000 });

    await map.click({ position: { x: 300, y: 200 } });
    await expect(page.getByText(/📍/)).toBeVisible();
    await expect(page.getByText(/標高目安: \d+ m（シミュレーション値）/)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("円+バッファ検索: 中心点をクリックして検索を実行できる", async ({ page }) => {
    await page.goto("/map");
    const map = page.locator(".leaflet-container");
    await expect(map).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /円\+バッファ検索/ }).click();
    await expect(page.getByText(/地図上をクリックして中心点を指定してください/)).toBeVisible();

    await map.click({ position: { x: 300, y: 200 } });
    await expect(page.getByText(/中心点: -?\d+\.\d+, -?\d+\.\d+/)).toBeVisible();

    await page.getByRole("button", { name: /検索実行/ }).click();
    await expect(page.getByText(/件の地物が見つかりました|候補レイヤーのみ確認できます/)).toBeVisible({
      timeout: 10_000,
    });
  });

  test("ポリゴン検索: 3点未満ではエラー表示される", async ({ page }) => {
    await page.goto("/map");
    const map = page.locator(".leaflet-container");
    await expect(map).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /ポリゴン検索/ }).click();
    await map.click({ position: { x: 250, y: 150 } });
    await map.click({ position: { x: 350, y: 150 } });
    await page.getByRole("button", { name: /検索実行/ }).click();
    await expect(page.getByText(/ポリゴンは3点以上指定してください/)).toBeVisible();
  });
});
