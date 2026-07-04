import type { ConnectorSource, DataConnector } from "@/connectors/types";
import { genericConnector } from "@/connectors/generic";

/** xROAD (道路データプラットフォーム) コネクタ */
export const xroadConnector: DataConnector = {
  name: "xroad",
  canHandle(source: ConnectorSource): boolean {
    const url = source.endpointUrl ?? source.officialUrl;
    return url.includes("xroad.mlit.go.jp") || url.includes("jartic-open-traffic.org");
  },
  check: (source) => genericConnector.check(source),
  fetchSample: (source) => genericConnector.fetchSample(source),
};
