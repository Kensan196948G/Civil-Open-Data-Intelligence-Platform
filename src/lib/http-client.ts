import dns from "node:dns";
import { Agent, fetch as guardedFetch } from "undici";
import { READ_LIMIT_BYTES } from "@/lib/constants";
import { getOperationSettings } from "@/lib/settings";
import { sanitizeUrl } from "@/lib/url-safety";
import { isPrivateIp, validateUrl } from "@/lib/url-guard";

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

const PRIVATE_ADDR_CODE = "EPRIVATEADDR";
const WORKERS_RUNTIME_ERROR =
  "Cloudflare Workers runtimeでは接続時DNSピン留めを保証できないため、外部URL取得を停止しました";

export function isCloudflareWorkersRuntime(): boolean {
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers";
}

/**
 * DNS rebinding 対策: 接続時に解決したアドレスそのものを検証・ピン留めする Agent。
 * 事前チェック(validateUrl)と接続が別々にDNS解決すると TOCTOU が生じるため、
 * 実際にソケットを張るアドレスをこの lookup で確定させる。
 */
let pinnedAgent: Agent | null = null;

function getPinnedAgent(): Agent {
  if (!pinnedAgent) {
    pinnedAgent = new Agent({
      connect: {
        lookup(
          hostname: string,
          options: dns.LookupOptions,
          callback: (
            err: NodeJS.ErrnoException | null,
            address?: string | dns.LookupAddress[],
            family?: number,
          ) => void,
        ) {
          // 呼び出し元 (node:net) は options.all の有無でコールバック形式が変わる:
          // autoSelectFamily (Node 20+ 既定) は (err, addresses[]) を期待する
          const cb = callback as unknown as (
            err: NodeJS.ErrnoException | null,
            address?: string | dns.LookupAddress[],
            family?: number,
          ) => void;
          dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
            if (err) {
              cb(err);
              return;
            }
            const list = Array.isArray(addresses)
              ? addresses
              : [{ address: addresses as unknown as string, family: 4 }];
            if (list.length === 0) {
              cb(Object.assign(new Error("no address"), { code: "ENOTFOUND" }));
              return;
            }
            const blocked = list.find((a) => isPrivateIp(a.address));
            if (blocked) {
              cb(
                Object.assign(new Error("接続先が非公開アドレスに解決されたため拒否しました"), {
                  code: PRIVATE_ADDR_CODE,
                }),
              );
              return;
            }
            // 検証済みリストのみを返すため、どのアドレスが選ばれてもピン留めが維持される
            if ((options as { all?: boolean }).all) {
              cb(null, list);
            } else {
              cb(null, list[0].address, list[0].family);
            }
          });
        },
      },
    });
  }
  return pinnedAgent;
}

function findErrorCode(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    const code = (current as Error & { code?: string }).code;
    if (code) return code;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return undefined;
}

function findErrorMessage(error: unknown): string {
  let current: unknown = error;
  let message = "不明なエラーが発生しました";
  for (let depth = 0; depth < 5 && current instanceof Error; depth++) {
    message = current.message || message;
    current = (current as Error & { cause?: unknown }).cause;
  }
  return message;
}

export type FetchGuardSettings = {
  timeoutSec: number;
  redirectLimit: number;
  previewKb: number;
};

/**
 * 登録済みデータソースURLへの疎通確認・サンプル取得。
 * - タイムアウト・リダイレクト上限・プレビュー保存上限は動作設定
 *   (app_settings、未設定時は constants の既定値) に従う
 * - リダイレクトは各ホップで静的検証しつつ上限回数まで追従
 * - 接続時DNSピン留めで rebinding を防止
 * - レスポンスは上限バイトまでで読み込みを打ち切る
 * - APIキー等の秘密情報はログ・結果に含めない
 */
export async function fetchWithGuard(
  targetUrl: string,
  options: { method?: "GET" | "HEAD"; readBody?: boolean; settings?: FetchGuardSettings } = {},
): Promise<FetchResult> {
  const method = options.method ?? "GET";
  const readBody = options.readBody ?? true;
  const { timeoutSec, redirectLimit, previewKb } =
    options.settings ?? (await getOperationSettings());
  const timeoutMs = timeoutSec * 1000;
  const previewMaxBytes = previewKb * 1024;
  const startedAt = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    let currentUrl = targetUrl;
    let response: Awaited<ReturnType<typeof guardedFetch>> | null = null;

    for (let hop = 0; hop <= redirectLimit; hop++) {
      const guard = validateUrl(currentUrl);
      if (!guard.ok) {
        return {
          success: false,
          errorType: "blocked_url",
          errorMessage: guard.reason,
          responseTimeMs: Date.now() - startedAt,
        };
      }
      if (isCloudflareWorkersRuntime()) {
        return {
          success: false,
          errorType: "unsupported_runtime",
          errorMessage: WORKERS_RUNTIME_ERROR,
          responseTimeMs: Date.now() - startedAt,
        };
      }

      response = await guardedFetch(currentUrl, {
        method,
        redirect: "manual",
        signal: controller.signal,
        dispatcher: getPinnedAgent(),
        headers: {
          "User-Agent": "CivilOpenDataIntelligencePlatform/0.1 (connection-check)",
          Accept: "*/*",
        },
      });

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get("location");
        if (!location) break;
        if (hop === redirectLimit) {
          return {
            success: false,
            statusCode: response.status,
            errorType: "network",
            errorMessage: `リダイレクト回数が上限(${redirectLimit}回)を超えました`,
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
      let previewBytes = 0;
      while (bytesRead < READ_LIMIT_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        bytesRead += value.byteLength;
        if (previewBytes < previewMaxBytes) {
          chunks.push(value);
          previewBytes += value.byteLength;
        }
      }
      await reader.cancel().catch(() => {});
      const previewBuf = concatBytes(chunks, previewMaxBytes);
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
        errorMessage: `Request timed out after ${timeoutMs}ms`,
        responseTimeMs,
      };
    }
    if (findErrorCode(error) === PRIVATE_ADDR_CODE) {
      return {
        success: false,
        errorType: "blocked_url",
        errorMessage: "接続先が非公開アドレスに解決されたため拒否しました",
        responseTimeMs,
      };
    }
    return {
      success: false,
      errorType: "network",
      errorMessage: findErrorMessage(error),
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

export { sanitizeUrl };
