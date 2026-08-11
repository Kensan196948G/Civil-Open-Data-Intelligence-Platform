/**
 * ブラウザ console / pageerror の判定ロジック。
 *
 * CSP 違反は Chromium では console error として出る。したがってこの検査は
 * CSP ヘッダ契約 (csp-contract.ts) が拾えない側 —— ヘッダは正しいのに実際には
 * スクリプトがブロックされている状態 (nonce 事故がまさにこれ) —— の検知網になる。
 *
 * allowlist は無条件の握り潰しにならないよう、次の 2 つの制約を持つ。
 *   1. 各エントリは `why` に無害である根拠を必ず書く
 *   2. CSP 違反に見えるメッセージは allowlist より優先して**常に**失敗させる
 *      (下記 CSP_VIOLATION_PATTERN)。allowlist がこの検査の存在理由そのものを
 *      隠すことは構造的に不可能にする
 */

export type CapturedEntry = {
  /** console.error か、未捕捉例外 (pageerror) か */
  source: "console" | "pageerror";
  /** どのルートを開いていたときに出たか */
  route: string;
  text: string;
  /** console message の発生元 URL など。ネットワーク失敗の判定に使う */
  location: string;
};

/**
 * Chromium が CSP でブロックしたときに出す文言。
 * 例: "Refused to execute inline script because it violates the following
 *      Content Security Policy directive: \"script-src 'self'\"."
 */
export const CSP_VIOLATION_PATTERN = /Content Security Policy|Refused to (execute|load|apply|connect|frame|create|run)/i;

export type ConsoleAllowlistEntry = {
  id: string;
  why: string;
  matches: (entry: CapturedEntry) => boolean;
};

export const CONSOLE_ALLOWLIST: readonly ConsoleAllowlistEntry[] = [
  {
    id: "google-fonts-cdn-unreachable",
    why:
      "src/app/layout.tsx が IBM Plex を fonts.googleapis.com から <link> で読む " +
      "(next/font は本環境の WASM 制限でビルド不能)。同ファイルのコメントどおり CDN 不達時は " +
      "font stack の system-ui へフォールバックする設計であり、CI のネットワーク到達性に " +
      "依存する外形要因。表示は劣化するが機能は失われない。" +
      "なお CSP で当該オリジンが外れた場合は文言が CSP 違反になり、下の除外規則により allowlist されない",
    matches: (entry) =>
      /fonts\.(googleapis|gstatic)\.com/.test(`${entry.text} ${entry.location}`) &&
      /Failed to load resource|net::ERR_|ERR_NAME_NOT_RESOLVED/i.test(entry.text),
  },
];

export type AllowlistDecision = { allowed: boolean; entryId?: string };

export function decideAllowlist(entry: CapturedEntry): AllowlistDecision {
  // CSP 違反は allowlist の対象外。allowlist のエントリが偶然一致しても通さない
  if (CSP_VIOLATION_PATTERN.test(entry.text)) {
    return { allowed: false };
  }
  const matched = CONSOLE_ALLOWLIST.find((candidate) => candidate.matches(entry));
  return matched ? { allowed: true, entryId: matched.id } : { allowed: false };
}

/** allowlist で説明できなかったもの = テストを落とすべきもの。 */
export function unexplainedEntries(entries: readonly CapturedEntry[]): CapturedEntry[] {
  return entries.filter((entry) => !decideAllowlist(entry).allowed);
}

/** 失敗メッセージ用。問題が無ければ空文字列を返す。 */
export function describeEntries(entries: readonly CapturedEntry[]): string {
  return entries
    .map((entry) => `[${entry.source}] ${entry.route} :: ${entry.text}${entry.location ? ` (${entry.location})` : ""}`)
    .join("\n");
}
