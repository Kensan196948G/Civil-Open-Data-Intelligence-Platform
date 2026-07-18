import { fetchWithGuard } from "@/lib/http-client";
import { detectFormat } from "@/lib/format-detector";
import type { ConnectorResult, ConnectorSource, DataConnector } from "@/connectors/types";
import { targetUrlOf } from "@/connectors/types";

const ESTAT_HOSTNAME = "api.e-stat.go.jp";

export function isAllowedEstatUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === ESTAT_HOSTNAME;
  } catch {
    return false;
  }
}

/**
 * e-Stat API 用の取得URLを組み立てる。
 * APIキーは .env の値を実行時にクエリへ付与するのみで、DB・ログには保存しない
 * (fetch_logs へは sanitizeUrl でマスク済みURLが記録される)。
 */
export function buildEstatUrl(
  source: ConnectorSource,
  env: Record<string, string | undefined> = process.env,
): string {
  const base = targetUrlOf(source);
  if (!isAllowedEstatUrl(base) || !source.requiresApiKey || !source.apiKeyEnvName) return base;
  const key = env[source.apiKeyEnvName];
  if (!key) return base;
  const url = new URL(base);
  url.searchParams.set("appId", key);
  return url.toString();
}

/** e-Stat API コネクタ。appId を実行時に付与して疎通確認する */
export const estatConnector: DataConnector = {
  name: "estat",
  canHandle(source: ConnectorSource): boolean {
    return isAllowedEstatUrl(targetUrlOf(source));
  },
  async check(source: ConnectorSource): Promise<ConnectorResult> {
    return fetchWithGuard(buildEstatUrl(source), { method: "GET", readBody: true });
  },
  async fetchSample(source: ConnectorSource): Promise<ConnectorResult> {
    const result = await fetchWithGuard(buildEstatUrl(source), { method: "GET", readBody: true });
    return {
      ...result,
      detectedFormat: result.success
        ? detectFormat(result.contentType ?? null, result.previewText ?? null)
        : undefined,
    };
  },
};
