import { expect, test } from "@playwright/test";
import { startAdminSession } from "./admin-session";

/**
 * ウォッチリストの「0件」と「取得できなかった」の区別（Deep Debug Round 6）。
 *
 * ■ 何が起きていたか
 *
 * `load()` が失敗しても `entries` は初期値の空配列のままだった。表示側は
 * `entries.length === 0` だけを見て「登録はありません。下のフォームから追加できます。」
 * を出し、その下に「⚠️ ウォッチリストの取得に失敗しました」を**同時に**出していた。
 *
 * 利用者から見ると「登録が消えた、追加し直せ」と言われているのと同じで、
 * 実際には取得できていないだけである。取り違えたまま再登録すると重複が生まれる。
 *
 * ■ このテストが見るもの
 *
 * エラー表示が出ることだけを見ると、空状態メッセージを消さない修正でも緑になる。
 * 「誤った案内が出ないこと」を主張として書く。
 */
test.describe("ウォッチリストの取得失敗表示", () => {
  test("取得に失敗したとき、空状態の案内を出さずに失敗として示す", async ({ page }) => {
    await startAdminSession(page);

    // 一覧取得だけを落とす。ネットワーク断を再現する。
    await page.route("**/api/v1/watchlist", async (route) => {
      if (route.request().method() === "GET") {
        await route.abort("failed");
        return;
      }
      await route.continue();
    });

    await page.goto("/watchlist");
    await page.waitForLoadState("load");

    // 取得失敗として示される。
    // 同じページの WatchToggle も /api/v1/watchlist を叩いており、遮断すると
    // それぞれが独自の role="alert" を出す。一覧の取得失敗表示を testid で特定する。
    const alert = page.getByTestId("watchlist-load-error");
    await expect(alert).toContainText("取得できませんでした", { timeout: 10_000 });
    // 登録内容が失われたわけではないことを明示する。
    await expect(alert).toContainText("失われていません");

    // 誤った案内を出さない（これが本体の主張）。
    await expect(page.getByText("登録はありません。下のフォームから追加できます。")).toHaveCount(0);

    // 再試行の手段がある。
    await expect(page.getByRole("button", { name: /再読み込み/ })).toBeVisible();
  });

  test("取得に成功して0件のときは、従来どおり空状態の案内を出す", async ({ page }) => {
    await startAdminSession(page);

    await page.route("**/api/v1/watchlist", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: { identity: null, entries: [] } }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/watchlist");
    await page.waitForLoadState("load");

    await expect(page.getByText("登録はありません。下のフォームから追加できます。")).toBeVisible({
      timeout: 10_000,
    });
    // 成功時に失敗表示を出さない（分離が一方向に倒れていないことを見る）。
    await expect(page.getByText("取得できませんでした")).toHaveCount(0);
  });

  test("HTTPエラー応答も取得失敗として扱う", async ({ page }) => {
    // 修正前は !res.ok を見ておらず、本文のJSON化に失敗しない限り素通りして
    // 空配列のまま「登録はありません」を表示していた。
    await startAdminSession(page);

    await page.route("**/api/v1/watchlist", async (route) => {
      if (route.request().method() === "GET") {
        await route.fulfill({
          status: 500,
          contentType: "application/json",
          body: JSON.stringify({ error: { code: "internal", message: "boom" } }),
        });
        return;
      }
      await route.continue();
    });

    await page.goto("/watchlist");
    await page.waitForLoadState("load");

    await expect(page.getByTestId("watchlist-load-error")).toContainText("取得できませんでした", {
      timeout: 10_000,
    });
    await expect(page.getByText("登録はありません。下のフォームから追加できます。")).toHaveCount(0);
  });
});
