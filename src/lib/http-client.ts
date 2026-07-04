import {
  FETCH_TIMEOUT_MS,
  MAX_REDIRECTS,
  PREVIEW_MAX_BYTES,
  READ_LIMIT_BYTES,
} from "@/lib/constants";
import { assertSafeUrl } from "@/lib/url-guard";

export type FetchResult = {
  success: boolean;
  statusCode?: number;
  responseTimeMs?: number;
  contentType?: string;
  responseSizeBytes?: number;
  previewText?: string;
  finalUrl?: string;
  errorType?: string;
  errorMessage?: string;
};

/**
 * 登録済みデータソースURLへの疎通確認・サンプル取得。
 * - 30秒タイムアウト
 * - リダイレクトは各ホップでSSRF検証しつつ最大3回まで追従
 * - レスポンスは上限バイトまでで読み込みを打ち切る
 * - APIキー等の秘密情報はログ・結果に含めない
 */
export async function fetchWithGuard(
  targetUrl: string,
  options: { method?: "GET" | "HEAD"; readBody?: boolean } = {},
): Promise<FetchResult> {
  const method = options.method ?? "GET";
  const readBody = options.readBody ?? true;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let currentUrl = targetUrl;
    let response: Response | null = null;

    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      const guard = await assertSafeUrl(currentUrl);
      if (!guard.ok) {
        return {
          success: false,
          errorType: "blocked_url",
          errorMessage: guard.reason,
          responseTimeMs: Date.now() - startedAt,
        };
      }

      response = await fetch(currentUrl, {
        method,
        redirect: "manual",
        signal: controller.signal,
        headers: {
          "User-Agent": "CivilOpenDataIntelligencePlatform/0.1 (connection-check)",
          Accept: "*/*",
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) break;
        if (hop === MAX_REDIRECTS) {
          return {
            success: false,
            statusCode: response.status,
            errorType: "network",
            errorMessage: `リダイレクト回数が上限(${MAX_REDIRECTS}回)を超えました`,
            responseTimeMs: Date.now() - startedAt,
          };
        }
        currentUrl = new URL(location, currentUrl).toString();
        continue;
      }
      break;
    }

    if (!response) {
      return {
        success: false,
        errorType: "unknown",
        errorMessage: "レスポンスを取得できませんでした",
        responseTimeMs: Date.now() - startedAt,
      };
    }

    const contentType = response.headers.get("content-type") ?? undefined;
    const contentLength = response.headers.get("content-length");

    let bytesRead = 0;
    let previewText: string | undefined;
    if (readBody && method !== "HEAD" && response.body) {
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      while (bytesRead < READ_LIMIT_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesRead += value.byteLength;
        if (chunks.reduce((s, c) => s + c.byteLength, 0) < PREVIEW_MAX_BYTES) {
          chunks.push(value);
        }
      }
      await reader.cancel().catch(() => {});
      const previewBuf = concatBytes(chunks, PREVIEW_MAX_BYTES);
      previewText = new TextDecoder("utf-8", { fatal: false }).decode(previewBuf);
    }

    const responseSizeBytes = contentLength
      ? Number.parseInt(contentLength, 10)
      : bytesRead || undefined;
    const responseTimeMs = Date.now() - startedAt;
    const statusCode = response.status;

    if (statusCode === 401 || statusCode === 403) {
      return {
        success: false,
        statusCode,
        contentType,
        responseSizeBytes,
        responseTimeMs,
        previewText,
        finalUrl: sanitizeUrl(response.url || targetUrl),
        errorType: "auth_required",
        errorMessage: `HTTP ${statusCode}: APIキーまたは認証が必要です`,
      };
    }
    if (statusCode === 429) {
      return {
        success: false,
        statusCode,
        contentType,
        responseSizeBytes,
        responseTimeMs,
        finalUrl: sanitizeUrl(response.url || targetUrl),
        errorType: "rate_limited",
        errorMessage: "HTTP 429: アクセス制限の可能性があります",
      };
    }

    return {
      success: statusCode >= 200 && statusCode < 300,
      statusCode,
      contentType,
      responseSizeBytes,
      responseTimeMs,
      previewText,
      finalUrl: sanitizeUrl(response.url || targetUrl),
      errorType: statusCode >= 400 ? "network" : undefined,
      errorMessage: statusCode >= 400 ? `HTTP ${statusCode} が返されました` : undefined,
    };
  } catch (error) {
    const responseTimeMs = Date.now() - startedAt;
    if (error instanceof Error && error.name === "AbortError") {
      return {
        success: false,
        errorType: "timeout",
        errorMessage: `Request timed out after ${FETCH_TIMEOUT_MS}ms`,
        responseTimeMs,
      };
    }
    return {
      success: false,
      errorType: "network",
      errorMessage: error instanceof Error ? error.message : "不明なエラーが発生しました",
      responseTimeMs,
    };
  } finally {
    clearTimeout(timer);
  }
}

function concatBytes(chunks: Uint8Array[], limit: number): Uint8Array {
  const total = Math.min(
    chunks.reduce((s, c) => s + c.byteLength, 0),
    limit,
  );
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    if (offset >= total) break;
    const slice = chunk.subarray(0, Math.min(chunk.byteLength, total - offset));
    out.set(slice, offset);
    offset += slice.byteLength;
  }
  return out;
}

/** クエリ内の秘密情報らしきパラメータをマスクしてログ安全にする */
export function sanitizeUrl(urlStr: string): string {
  try {
    const url = new URL(urlStr);
    const secretParams = ["appid", "api_key", "apikey", "key", "token", "access_token", "secret"];
    for (const [name] of url.searchParams) {
      if (secretParams.includes(name.toLowerCase())) {
        url.searchParams.set(name, "***");
      }
    }
    return url.toString();
  } catch {
    return urlStr;
  }
}
