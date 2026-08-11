import type { ConnectorSource, DataConnector } from "@/connectors/types";
import { targetUrlOf } from "@/connectors/types";
import { genericConnector } from "@/connectors/generic";

/** xROAD コネクタが担当する登録可能ドメイン */
const XROAD_DOMAINS = ["xroad.mlit.go.jp", "jartic-open-traffic.org"] as const;

/**
 * 台帳に登録されたURLが xROAD 系ドメインかを厳格に確認する。
 *
 * 判定は URL をパースした hostname に対して行い、文字列包含では判定しない。
 * `url.includes("xroad.mlit.go.jp")` はクエリやパスに含まれるだけの
 * `https://evil.example/?x=xroad.mlit.go.jp` を通してしまう (CodeQL
 * js/incomplete-url-substring-sanitization)。
 *
 * サブドメインは許可する (T-F7 裁定)。実台帳の登録値が
 * `https://www.xroad.mlit.go.jp/` と `https://api.jartic-open-traffic.org/geoserver`
 * であり、いずれも apex ではなくサブドメイン配信のため。ただしサフィックス比較は
 * 必ず `"." + domain` で行う。ドット無しの `endsWith("xroad.mlit.go.jp")` は
 * `evilxroad.mlit.go.jp` を、hostname を見ない比較は
 * `xroad.mlit.go.jp.evil.example` を通す。
 *
 * HTTPS 必須は estat (`isAllowedEstatUrl`) / gsi (`isGsiElevationEndpoint`) の
 * 既存判定に揃えた。実台帳の xROAD 系登録値はいずれも HTTPS。
 */
export function isXroadUrl(value: string | null | undefined): boolean {
  if (!value) return false;
  try {
    const { protocol, hostname } = new URL(value);
    if (protocol !== "https:") return false;
    return XROAD_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  } catch {
    return false;
  }
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
