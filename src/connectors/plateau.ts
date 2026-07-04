import type { ConnectorSource, DataConnector } from "@/connectors/types";
import { genericConnector } from "@/connectors/generic";

/** PLATEAU コネクタ。ポータル/データカタログの疎通を確認する */
export const plateauConnector: DataConnector = {
  name: "plateau",
  canHandle(source: ConnectorSource): boolean {
    const url = source.endpointUrl ?? source.officialUrl;
    return url.includes("mlit.go.jp/plateau") || url.includes("geospatial.jp");
  },
  check: (source) => genericConnector.check(source),
  fetchSample: (source) => genericConnector.fetchSample(source),
};
