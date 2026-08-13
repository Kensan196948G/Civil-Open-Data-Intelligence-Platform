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
 *      (下記 CSP_VIOLATION_PATTERN)
 *
 * 制約 2 が保証するのは「順序」だけである。つまり allowlist は CSP 違反判定を
 * **後から**覆せないが、CSP_VIOLATION_PATTERN が拾い損ねた文言までは守れない。
 * 文言の網羅性は tests/unit/csp-contract-mutation.test.ts の衝突表が回帰として
 * 押さえている。ここを「構造的に不可能」と書くと網羅性の検討が止まるので書かない。
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
 * セキュリティヘッダ由来のブロックを表す文言。allowlist より優先して失敗させる。
 *
 * Chromium はブロック理由を 2 系統で出す。文言だけを見ていると後者を取りこぼす。
 *   1. CSP 違反の説明文
 *      "Refused to execute inline script because it violates the following
 *       Content Security Policy directive: \"script-src 'self'\"."
 *   2. ネットワーク層のエラーコード。navigation / frame / worker が CSP で
 *      落ちた場合はこちらだけが出て、上の文言は現れない
 *      "Failed to load resource: net::ERR_BLOCKED_BY_CSP"
 *
 * ERR_BLOCKED_BY_RESPONSE は厳密には CSP 専用ではなく、X-Frame-Options /
 * Cross-Origin-Resource-Policy / Cross-Origin-Embedder-Policy によるブロックでも
 * 出る。それでも含めているのは、いずれもセキュリティヘッダ由来のブロックであり、
 * 「外形要因」として黙って allowlist されてよいものが 1 つも無いためである
 * (CTO 裁定 2026-08-12: 安全側へ倒す)。
 *
 * `net::` 接頭辞は要求しない。接頭辞の有無という表記揺れ 1 つで検知が消えるのは、
 * ここで直している欠陥そのものだからである。
 *
 * ⚠ ここへ文言を足すときは tests/unit/csp-contract-mutation.test.ts の衝突表へ
 * 回帰ケースを足すこと。網羅性を守っているのはその表だけである。
 */
export const CSP_VIOLATION_PATTERN =
  /Content Security Policy|Refused to (execute|load|apply|connect|frame|create|run)|ERR_BLOCKED_BY_(CSP|RESPONSE)/i;

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
      "この matches は原因を区別しない。CSP で style-src / font-src から当該オリジンが外れた場合も " +
      "同じ形の 'Failed to load resource' が出るため、ここだけを見れば CSP 事故が外形要因として " +
      "説明されてしまう。それを防いでいるのは decideAllowlist が先に評価する CSP_VIOLATION_PATTERN " +
      "だけであり、同 pattern が拾う文言の網羅性が本エントリの安全性の前提になっている " +
      "(2026-08-12: ERR_BLOCKED_BY_CSP を取りこぼしていた実績あり)",
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
