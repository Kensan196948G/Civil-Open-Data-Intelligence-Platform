import { checkUrlSafety } from "@/lib/terrain/adapters";
import { isCloudflareWorkersRuntime } from "@/lib/http-client";
import { assertSafeUrl } from "@/lib/url-guard";
import { TtlCache } from "@/lib/ttl-cache";

/**
 * GSI 標高タイルへのサーバー側アクセス。
 *
 * - URL は adapters の定数テーブル + 整数タイル座標のみから構築されるため、
 *   ユーザー入力で取得先を操作できない (SSRF-safe by construction)
 * - 最終ゲートとして https かつ GSI ホスト allowlist を強制する
 * - Node 実行時は DNS 解決結果も非公開IPでないことを確認する
 *   (Cloudflare Workers では node:dns が使えないため allowlist + https のみ)
 * - 同一タイルの多重取得を抑えるため、上限付き TTL キャッシュを持つ
 */

export const GSI_ALLOWED_HOSTS: readonly string[] = ["cyberjapandata.gsi.go.jp"];
export const GSI_TILE_TIMEOUT_MS = 15_000;

const TILE_CACHE_MAX_ENTRIES = 300;
const TILE_CACHE_TTL_MS = 10 * 60_000;
const tileCache = new TtlCache<{ status: number; bytes: Uint8Array | null }>(
  TILE_CACHE_MAX_ENTRIES,
  TILE_CACHE_TTL_MS,
);

async function assertSafeGsiUrl(url: URL): Promise<void> {
  const safety = checkUrlSafety(url, { allowedHosts: GSI_ALLOWED_HOSTS });
  if (!safety.allowed) {
    throw new Error(`Blocked outbound URL ${url.hostname}: ${safety.reason ?? "not allowed"}`);
  }
  if (!isCloudflareWorkersRuntime()) {
    const guarded = await assertSafeUrl(url.toString());
    if (!guarded.ok) {
      throw new Error(`Blocked outbound URL ${url.hostname}: ${guarded.reason}`);
    }
  }
}

/**
 * DemTileStore (ブラウザ直取得サンプラー) から使う fetch 実装。
 * シグネチャは標準 fetch と同一にして移植コードを変更しない。
 */
export const gsiFetch: typeof fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input.toString());
  await assertSafeGsiUrl(url);
  return fetch(url.toString(), init);
};

/**
 * lookupElevation (単点標高) 用のタイルフェッチャー。
 * タイムアウトとクライアント切断を AbortController で合成する。
 */
export const gsiTileFetcher = async (
  url: URL,
  ctx: { requestId: string; signal?: AbortSignal },
) => {
  await assertSafeGsiUrl(url);

  const cacheKey = url.toString();
  const cached = tileCache.get(cacheKey);
  if (cached !== undefined) {
    return { status: cached.status, bytes: cached.bytes };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GSI_TILE_TIMEOUT_MS);
  const onAbort = () => controller.abort();
  ctx.signal?.addEventListener("abort", onAbort, { once: true });
  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: { "User-Agent": "CivilOpenDataIntelligencePlatform/0.1 (terrain)" },
    });
    const bytes = response.status === 200 ? new Uint8Array(await response.arrayBuffer()) : null;
    const result = { status: response.status, bytes };
    tileCache.set(cacheKey, result);
    return result;
  } finally {
    clearTimeout(timer);
    ctx.signal?.removeEventListener("abort", onAbort);
  }
};
