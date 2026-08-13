import { expect, test, type APIRequestContext } from "@playwright/test";
import { E2E_ADMIN_TOKEN, startAdminSession } from "./admin-session";

/**
 * ウォッチリストUI（/watchlist・現場一覧のトグル）のE2E。
 *
 * webServer は CODIP_DEMO_IDENTITY=true / CODIP_DEMO_USER_EMAIL=demo.engineer@example.com
 * で起動するため、管理セッション + デモ識別子で個人ウォッチリストを操作できる。
 * seed は現場 TYO-01 とデータソース1件の登録を投入済み（prisma/seed.ts）。
 */

const DEMO_EMAIL = "demo.engineer@example.com";
const TARGET_SITE_LABEL = "TYO-02 羽田D滑走路工事";
const E2E_ORIGIN = `http://localhost:${process.env.PLAYWRIGHT_E2E_PORT ?? "3000"}`;

async function watchlistEntries(request: APIRequestContext) {
  const res = await request.get("/api/v1/watchlist");
  const body = await res.json();
  return body?.data?.entries ?? [];
}

async function siteIdByLabel(request: APIRequestContext, label: string): Promise<string | null> {
  const res = await request.get("/api/v1/sites");
  const body = await res.json();
  const site = (body?.data?.sites ?? []).find(
    (item: { code: string; name: string }) => `${item.code} ${item.name}` === label,
  );
  return site?.id ?? null;
}

async function removeWatchForSite(request: APIRequestContext, siteId: string) {
  const entries = await watchlistEntries(request);
  const entry = entries.find(
    (item: { targetType: string; targetId: string }) => item.targetType === "site" && item.targetId === siteId,
  );
  if (entry) {
    // 管理セッション Cookie を使う変更操作は同一 Origin 必須（CSRF 検証）。
    await request.delete(`/api/v1/watchlist/${entry.id}`, { headers: { origin: E2E_ORIGIN } });
  }
}

test.describe("ウォッチリストUI", () => {
  test("seed済み登録の表示と一時停止・再開ができる", async ({ page }) => {
    await startAdminSession(page);
    await page.goto("/watchlist");

    await expect(page.getByRole("heading", { name: "🔔 ウォッチリスト" })).toBeVisible();
    await expect(page.getByText(DEMO_EMAIL)).toBeVisible();
    await expect(page.getByText("● 通知中").first()).toBeVisible();

    await page.getByRole("button", { name: "一時停止" }).first().click();
    await expect(page.getByRole("status")).toContainText("通知を一時停止しました");
    await expect(page.getByText("○ 一時停止").first()).toBeVisible();

    await page.getByRole("button", { name: "再開" }).first().click();
    await expect(page.getByRole("status")).toContainText("通知を再開しました");
    await expect(page.getByText("● 通知中").first()).toBeVisible();
  });

  test("フォームから登録・解除ができる", async ({ page }) => {
    await startAdminSession(page);
    const siteId = await siteIdByLabel(page.request, TARGET_SITE_LABEL);
    expect(siteId).toBeTruthy();
    await removeWatchForSite(page.request, siteId!);

    await page.goto("/watchlist");

    await page.getByLabel("対象").selectOption({ label: TARGET_SITE_LABEL });
    await page.getByRole("button", { name: "➕ 登録" }).click();
    await expect(page.getByRole("status")).toContainText("ウォッチリストへ登録しました");
    await expect(page.locator("li", { hasText: TARGET_SITE_LABEL })).toBeVisible();

    const row = page.locator("li", { hasText: TARGET_SITE_LABEL });
    await row.getByRole("button", { name: "解除" }).click();
    await expect(page.getByRole("status")).toContainText("解除しました");
    await expect(page.locator("li", { hasText: TARGET_SITE_LABEL })).toHaveCount(0);
  });

  test("現場一覧のトグルからウォッチ登録できる", async ({ page }) => {
    await startAdminSession(page);
    const siteId = await siteIdByLabel(page.request, TARGET_SITE_LABEL);
    expect(siteId).toBeTruthy();
    await removeWatchForSite(page.request, siteId!);

    await page.goto("/sites");

    const row = page.locator("li", { hasText: TARGET_SITE_LABEL });
    await row.getByRole("button", { name: "➕ ウォッチ" }).click();
    await expect(row.getByRole("button", { name: "🔔 ウォッチ中" })).toBeVisible();

    // 後始末: API 経由で解除して seed 状態へ戻す
    await removeWatchForSite(page.request, siteId!);
  });

  test("未認証ではログイン案内を表示する", async ({ page }) => {
    await page.goto("/watchlist");
    await expect(page.getByRole("heading", { name: "🔒 認証が必要" })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "🛡️ 管理操作トークン" }),
    ).toBeVisible();
  });

  test("未認証画面からトークンでセッション開始すると一覧が表示される", async ({ page }) => {
    await page.goto("/watchlist");
    await expect(page.getByRole("heading", { name: "🔒 認証が必要" })).toBeVisible();
    await page.getByLabel("管理操作トークン").fill(E2E_ADMIN_TOKEN);
    await page.getByRole("button", { name: "セッション開始" }).click();
    await expect(page.getByRole("heading", { name: "📋 登録一覧（2件）" })).toBeVisible();
    await expect(page.getByText(DEMO_EMAIL)).toBeVisible();
  });
});
