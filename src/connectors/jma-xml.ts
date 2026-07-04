import type { ConnectorResult, ConnectorSource, DataConnector } from "@/connectors/types";
import { genericConnector } from "@/connectors/generic";

/**
 * 気象庁 防災情報XML コネクタ。
 * Atom フィードとして取得できることを検証する。
 */
export const jmaXmlConnector: DataConnector = {
  name: "jma-xml",
  canHandle(source: ConnectorSource): boolean {
    const url = source.endpointUrl ?? source.officialUrl;
    return url.includes("data.jma.go.jp") || url.includes("xml.kishou.go.jp");
  },
  async check(source: ConnectorSource): Promise<ConnectorResult> {
    const result = await genericConnector.fetchSample(source);
    if (result.success && result.previewText && !result.previewText.trimStart().startsWith("<")) {
      return {
        ...result,
        success: false,
        errorType: "parse_error",
        errorMessage: "XMLフィードとして解釈できないレスポンスです",
      };
    }
    return result;
  },
  fetchSample(source: ConnectorSource): Promise<ConnectorResult> {
    return genericConnector.fetchSample(source);
  },
};
