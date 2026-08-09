import { expect, test } from "@playwright/test";

test.describe("PWA基本", () => {
  test("manifest がインストール可能なメタデータを返す", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    const manifest = await response.json();
    expect(manifest.name).toContain("Civil Open Data Intelligence Platform");
    expect(manifest.short_name).toBe("CODIP");
    expect(manifest.display).toBe("standalone");
    expect(manifest.start_url).toBe("/");
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  test("Service Worker が配信されキャッシュ戦略を持つ", async ({ request }) => {
    const response = await request.get("/sw.js");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain("CACHE_VERSION");
    expect(body).toContain("stale-while-revalidate");
    expect(body).toContain("skipWaiting");
  });
});
