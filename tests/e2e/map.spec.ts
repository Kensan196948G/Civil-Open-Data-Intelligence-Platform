import { expect, test } from "@playwright/test";

test.describe("地図表示", () => {
  test("地図とレイヤー切替・出典表記が表示される", async ({ page }) => {
    await page.goto("/map");
    await expect(page.getByRole("heading", { name: /地図表示/ })).toBeVisible();
    await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(".leaflet-control-layers")).toBeVisible();
    await expect(page.locator(".leaflet-control-attribution")).toContainText("国土地理院");
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
  });

  test("不正な GeoJSON はエラー表示される", async ({ page }) => {
    await page.goto("/map");
    await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 20_000 });
    await page.getByPlaceholder(/FeatureCollection/).fill("{invalid json");
    await page.getByRole("button", { name: /地図に表示/ }).click();
    await expect(page.getByText(/JSON の構文が正しくありません/)).toBeVisible();
  });

  test("緯度経度入力でクリック操作なしに標高確認を開始できる", async ({ page }) => {
    await page.goto("/map");
    await expect(page.locator(".leaflet-container")).toBeVisible({ timeout: 20_000 });

    await page.getByLabel("緯度").fill("91");
    await page.getByLabel("経度").fill("139.767125");
    await page.getByRole("button", { name: /標高取得/ }).click();

    await expect(page.locator('p[role="alert"]')).toContainText(/緯度は -90/);
  });
});
