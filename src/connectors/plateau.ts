import type { ConnectorSource, DataConnector } from "@/connectors/types";
import { targetUrlOf } from "@/connectors/types";
import { hostMatches, hostPathMatches } from "@/connectors/host-match";
import { genericConnector } from "@/connectors/generic";

/** PLATEAU のデータカタログ側。ホスト単位で担当する */
const PLATEAU_CATALOG_DOMAINS = ["geospatial.jp"] as const;

/** PLATEAU のポータル側。国交省ドメインのうち /plateau 配下だけを担当する */
const MLIT_DOMAINS = ["mlit.go.jp"] as const;
const PLATEAU_PATH_PREFIX = "/plateau";

/**
 * 台帳に登録されたURLが PLATEAU 系かを厳格に確認する。
 *
 * 国交省ドメインは**ホスト一致では受けない**。`mlit.go.jp` をホストだけで担当すると、
 * registry 上で plateau より後ろにいる xroad (`www.xroad.mlit.go.jp`) を横取りし、
 * `www.netis.mlit.go.jp` / `www.reinfolib.mlit.go.jp` / `road-structures-db.mlit.go.jp`
 * まで巻き込む。旧実装が文字列包含で `mlit.go.jp/plateau` とパスまで見ていたのは
 * このためで、その意図をパス前置判定として残す。
 *
 * `geospatial.jp` 側は旧実装と同じくホスト単位。台帳には PLATEAU 以外の
 * `www.geospatial.jp/ckan/dataset/shizuoka-2019-pointcloud` も登録されており、
 * これらは従来から plateau コネクタが担当している。
 */
export function isPlateauUrl(value: string | null | undefined): boolean {
  return (
    hostMatches(value, PLATEAU_CATALOG_DOMAINS) ||
    hostPathMatches(value, MLIT_DOMAINS, PLATEAU_PATH_PREFIX)
  );
}

/** PLATEAU コネクタ。ポータル/データカタログの疎通を確認する */
export const plateauConnector: DataConnector = {
  name: "plateau",
  canHandle(source: ConnectorSource): boolean {
    return isPlateauUrl(targetUrlOf(source));
  },
  check: (source) => genericConnector.check(source),
  fetchSample: (source) => genericConnector.fetchSample(source),
};
