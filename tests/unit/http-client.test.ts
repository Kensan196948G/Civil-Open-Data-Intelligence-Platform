import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("undici", () => ({
  fetch: vi.fn(),
  Agent: class MockAgent {},
}));

import { fetch as undiciFetch } from "undici";
import { fetchWithGuard, sanitizeUrl } from "@/lib/http-client";

const mockFetch = vi.mocked(undiciFetch);

function jsonResponse(body: string, init: ResponseInit = {}): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init,
  });
}

beforeEach(() => {
  mockFetch.mockReset();
});

describe("fetchWithGuard", () => {
  it("200 レスポンスで success / プレビュー / サイズを返す", async () => {
    mockFetch.mockResolvedValueOnce(jsonResponse('{"elevation":25.3}') as never);
    const result = await fetchWithGuard("https://example.com/api");
    expect(result.success).toBe(true);
    expect(result.statusCode).toBe(200);
    expect(result.contentType).toContain("application/json");
    expect(result.previewText).toContain("elevation");
    expect(result.responseSizeBytes).toBeGreaterThan(0);
  });

  it("非公開IPリテラルのURLは fetch せずに拒否する", async () => {
    const result = await fetchWithGuard("http://127.0.0.1/internal");
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("blocked_url");
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("リダイレクト先が非公開IPなら拒否する", async () => {
    mockFetch.mockResolvedValueOnce(
      new Response(null, {
        status: 302,
        headers: { location: "http://169.254.169.254/latest/meta-data/" },
      }) as never,
    );
    const result = await fetchWithGuard("https://example.com/redirect");
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("blocked_url");
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("リダイレクト上限(3回)を超えたらエラーにする", async () => {
    for (let i = 0; i < 4; i++) {
      mockFetch.mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { location: `https://example.com/next-${i}` },
        }) as never,
      );
    }
    const result = await fetchWithGuard("https://example.com/loop");
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("network");
    expect(result.errorMessage).toContain("リダイレクト");
    expect(mockFetch).toHaveBeenCalledTimes(4);
  });

  it("接続時ピン留めで非公開アドレスに解決された場合は blocked_url を返す", async () => {
    const err = new TypeError("fetch failed");
    (err as TypeError & { cause?: unknown }).cause = Object.assign(
      new Error("接続先が非公開アドレスに解決されたため拒否しました"),
      { code: "EPRIVATEADDR" },
    );
    mockFetch.mockRejectedValueOnce(err);
    const result = await fetchWithGuard("https://rebinding.example.com/");
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("blocked_url");
  });

  it("401 は auth_required に分類する", async () => {
    mockFetch.mockResolvedValueOnce(new Response("unauthorized", { status: 401 }) as never);
    const result = await fetchWithGuard("https://example.com/secure");
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("auth_required");
    expect(result.statusCode).toBe(401);
  });

  it("429 は rate_limited に分類する", async () => {
    mockFetch.mockResolvedValueOnce(new Response("slow down", { status: 429 }) as never);
    const result = await fetchWithGuard("https://example.com/busy");
    expect(result.errorType).toBe("rate_limited");
  });

  it("ネットワークエラーは network に分類する", async () => {
    mockFetch.mockRejectedValueOnce(new TypeError("fetch failed"));
    const result = await fetchWithGuard("https://example.com/down");
    expect(result.success).toBe(false);
    expect(result.errorType).toBe("network");
  });
});

describe("sanitizeUrl", () => {
  it("秘密系クエリパラメータをマスクする", () => {
    expect(sanitizeUrl("https://api.example.com/v1?appId=SECRET123&lang=ja")).toBe(
      "https://api.example.com/v1?appId=***&lang=ja",
    );
    expect(sanitizeUrl("https://api.example.com/?api_key=abc&token=xyz")).toContain("api_key=***");
    expect(sanitizeUrl("https://api.example.com/?api_key=abc&token=xyz")).toContain("token=***");
    expect(
      sanitizeUrl(
        "https://api.example.com/?client_secret=abc&signature=sig&subscription-key=sub",
      ),
    ).toBe("https://api.example.com/?client_secret=***&signature=***&subscription-key=***");
    expect(sanitizeUrl("https://user:pass@example.com/data?key=abc")).toBe(
      "https://example.com/data?key=***",
    );
  });

  it("通常のパラメータは変更しない", () => {
    expect(sanitizeUrl("https://api.example.com/?lat=36.1&lon=140.0")).toBe(
      "https://api.example.com/?lat=36.1&lon=140.0",
    );
  });

  it("URLでない文字列は元の値を漏らさず固定の安全な表現を返す", () => {
    expect(sanitizeUrl("not a url")).toBe("[invalid-url]");
  });
});
