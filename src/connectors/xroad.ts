import type { ConnectorSource, DataConnector } from "@/connectors/types";
import { targetUrlOf } from "@/connectors/types";
import { hostMatches } from "@/connectors/host-match";
import { genericConnector } from "@/connectors/generic";

/** xROAD コネクタが担当する登録可能ドメイン */
const XROAD_DOMAINS = ["xroad.mlit.go.jp", "jartic-open-traffic.org"] as const;

/**
 * 台帳に登録されたURLが xROAD 系ドメインかを厳格に確認する。
 *
 * 判定は `hostMatches` に委譲する。文字列包含でホストを判定すると、クエリやパスに
 * 現れただけの `https://evil.example/?x=xroad.mlit.go.jp` を通してしまう
 * (CodeQL js/incomplete-url-substring-sanitization)。
 *
 * サブドメインは許可する (T-F7 裁定)。実台帳の登録値が
 * `https://www.xroad.mlit.go.jp/` と `https://api.jartic-open-traffic.org/geoserver`
 * であり、いずれも apex ではなくサブドメイン配信のため。
 */
export function isXroadUrl(value: string | null | undefined): boolean {
  return hostMatches(value, XROAD_DOMAINS);
}

/** xROAD (道路データプラットフォーム) コネクタ */
export const xroadConnector: DataConnector = {
  name: "xroad",
  canHandle(source: ConnectorSource): boolean {
    return isXroadUrl(targetUrlOf(source));
  },
  check: (source) => genericConnector.check(source),
  fetchSample: (source) => genericConnector.fetchSample(source),
};
