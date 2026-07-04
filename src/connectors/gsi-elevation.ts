import type { ConnectorResult, ConnectorSource, DataConnector } from "@/connectors/types";
import { genericConnector } from "@/connectors/generic";

/**
 * 国土地理院 標高API コネクタ。
 * レスポンス JSON に elevation フィールドが含まれることまで検証する。
 */
export const gsiElevationConnector: DataConnector = {
  name: "gsi-elevation",
  canHandle(source: ConnectorSource): boolean {
    return !!source.endpointUrl?.includes("cyberjapandata2.gsi.go.jp/general/dem");
  },
  async check(source: ConnectorSource): Promise<ConnectorResult> {
    const result = await genericConnector.fetchSample(source);
    if (result.success && result.previewText) {
      try {
        const json = JSON.parse(result.previewText);
        if (!("elevation" in json)) {
          return {
            ...result,
            success: false,
            errorType: "parse_error",
            errorMessage: "標高APIのレスポンスに elevation フィールドがありません",
          };
        }
      } catch {
        return {
          ...result,
          success: false,
          errorType: "parse_error",
          errorMessage: "標高APIのレスポンスをJSONとして解釈できませんでした",
        };
      }
    }
    return result;
  },
  fetchSample(source: ConnectorSource): Promise<ConnectorResult> {
    return genericConnector.fetchSample(source);
  },
};
