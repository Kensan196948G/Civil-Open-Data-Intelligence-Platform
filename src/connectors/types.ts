import type { FetchResult } from "@/lib/http-client";

/** コネクタが扱うデータソースの最小情報 (Prisma DataSource のサブセット) */
export type ConnectorSource = {
  id: string;
  name: string;
  officialUrl: string;
  endpointUrl: string | null;
  requiresApiKey: boolean;
  apiKeyEnvName: string | null;
  category: string;
  dataFormat: string;
};

export type ConnectorResult = FetchResult & { detectedFormat?: string };

export interface DataConnector {
  /** コネクタ識別名 (fetch_logs.note に記録される) */
  name: string;
  canHandle(source: ConnectorSource): boolean;
  check(source: ConnectorSource): Promise<ConnectorResult>;
  fetchSample(source: ConnectorSource): Promise<ConnectorResult>;
}

/** 疎通・取得対象URL (エンドポイント優先、なければ公式URL) */
export function targetUrlOf(source: ConnectorSource): string {
  return source.endpointUrl ?? source.officialUrl;
}
