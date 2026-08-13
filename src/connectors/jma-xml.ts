import type { ConnectorResult, ConnectorSource, DataConnector } from "@/connectors/types";
import { targetUrlOf } from "@/connectors/types";
import { hostMatches } from "@/connectors/host-match";
import { genericConnector } from "@/connectors/generic";

/**
 * 防災情報XMLの配信ホスト。
 *
 * **`jma.go.jp` へ広げてはならない。** 台帳には `www.jma.go.jp/bosai/**` の
 * JSON配信 (`.../quake/data/list.json` など) が多数登録されており、登録可能ドメインまで
 * 広げると、それらが下の `check` の「XMLとして解釈できるか」判定に流入して一斉に
 * `parse_error` になる。担当範囲はサブ委譲された `data.jma.go.jp` に限る。
 */
const JMA_XML_DOMAINS = ["data.jma.go.jp", "xml.kishou.go.jp"] as const;

/** 台帳に登録されたURLが防災情報XMLの配信ホストかを厳格に確認する */
export function isJmaXmlUrl(value: string | null | undefined): boolean {
  return hostMatches(value, JMA_XML_DOMAINS);
}

/**
 * 気象庁 防災情報XML コネクタ。
 * Atom フィードとして取得できることを検証する。
 */
export const jmaXmlConnector: DataConnector = {
  name: "jma-xml",
  canHandle(source: ConnectorSource): boolean {
    return isJmaXmlUrl(targetUrlOf(source));
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
