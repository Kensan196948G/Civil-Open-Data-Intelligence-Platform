import type { ConnectorSource, DataConnector } from "@/connectors/types";
import { targetUrlOf } from "@/connectors/types";
import { hostMatches } from "@/connectors/host-match";
import { genericConnector } from "@/connectors/generic";

/** 国土数値情報ダウンロードサービスのホスト */
const KSJ_DOMAINS = ["nlftp.mlit.go.jp"] as const;

/**
 * 台帳に登録されたURLが国土数値情報 (KSJ) 系かを厳格に確認する。
 *
 * 担当範囲は `mlit.go.jp` ではなく `nlftp.mlit.go.jp`。台帳には同省庁の別サービスが
 * 多数あり、登録可能ドメインまで広げると全て KSJ 扱いになる。
 */
export function isKsjUrl(value: string | null | undefined): boolean {
  return hostMatches(value, KSJ_DOMAINS);
}

/** 国土数値情報 (KSJ) コネクタ。ダウンロードサービスの疎通を確認する */
export const ksjConnector: DataConnector = {
  name: "ksj",
  canHandle(source: ConnectorSource): boolean {
    return isKsjUrl(targetUrlOf(source));
  },
  check: (source) => genericConnector.check(source),
  fetchSample: (source) => genericConnector.fetchSample(source),
};
