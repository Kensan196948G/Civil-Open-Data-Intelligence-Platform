import { fetchWithGuard } from "@/lib/http-client";
import { detectFormat } from "@/lib/format-detector";
import type { ConnectorResult, ConnectorSource, DataConnector } from "@/connectors/types";
import { targetUrlOf } from "@/connectors/types";

/** どのデータソースにも適用できるフォールバックコネクタ */
export const genericConnector: DataConnector = {
  name: "generic",
  canHandle: () => true,
  async check(source: ConnectorSource): Promise<ConnectorResult> {
    return fetchWithGuard(targetUrlOf(source), { method: "GET", readBody: true });
  },
  async fetchSample(source: ConnectorSource): Promise<ConnectorResult> {
    const result = await fetchWithGuard(targetUrlOf(source), { method: "GET", readBody: true });
    return {
      ...result,
      detectedFormat: result.success
        ? detectFormat(result.contentType ?? null, result.previewText ?? null)
        : undefined,
    };
  },
};
