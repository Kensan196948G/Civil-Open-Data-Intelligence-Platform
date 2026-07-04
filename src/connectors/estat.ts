import { fetchWithGuard } from "@/lib/http-client";
import { detectFormat } from "@/lib/format-detector";
import type { ConnectorResult, ConnectorSource, DataConnector } from "@/connectors/types";
import { targetUrlOf } from "@/connectors/types";

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
  if (!source.requiresApiKey || !source.apiKeyEnvName) return base;
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
    return !!source.endpointUrl?.includes("api.e-stat.go.jp");
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
