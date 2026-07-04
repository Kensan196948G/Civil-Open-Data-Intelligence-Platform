import type { ConnectorSource, DataConnector } from "@/connectors/types";
import { genericConnector } from "@/connectors/generic";

/** 国土数値情報 (KSJ) コネクタ。ダウンロードサービスの疎通を確認する */
export const ksjConnector: DataConnector = {
  name: "ksj",
  canHandle(source: ConnectorSource): boolean {
    const url = source.endpointUrl ?? source.officialUrl;
    return url.includes("nlftp.mlit.go.jp");
  },
  check: (source) => genericConnector.check(source),
  fetchSample: (source) => genericConnector.fetchSample(source),
};
