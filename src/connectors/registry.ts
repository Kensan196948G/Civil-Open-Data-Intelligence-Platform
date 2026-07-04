import type { ConnectorSource, DataConnector } from "@/connectors/types";
import { genericConnector } from "@/connectors/generic";
import { gsiElevationConnector } from "@/connectors/gsi-elevation";
import { jmaXmlConnector } from "@/connectors/jma-xml";
import { estatConnector } from "@/connectors/estat";
import { ksjConnector } from "@/connectors/ksj";
import { plateauConnector } from "@/connectors/plateau";
import { xroadConnector } from "@/connectors/xroad";

/** 専用コネクタ (先勝ち)。該当なしは generic にフォールバック */
export const CONNECTORS: DataConnector[] = [
  gsiElevationConnector,
  jmaXmlConnector,
  estatConnector,
  ksjConnector,
  plateauConnector,
  xroadConnector,
];

export function findConnector(source: ConnectorSource): DataConnector {
  return CONNECTORS.find((c) => c.canHandle(source)) ?? genericConnector;
}
