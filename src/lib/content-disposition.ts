/**
 * `Content-Disposition: attachment` のヘッダ値を安全に組み立てる。
 *
 * ■ 何が問題だったか
 *
 * `src/app/api/v1/reports/route.ts` は、`typeof body?.siteId === "string"` しか
 * 検証していない `siteId` の先頭 8 文字を
 *
 *   `attachment; filename="report_${template}_${siteId.slice(0, 8)}.${ext}"`
 *
 * へそのまま埋めていた。`siteId` に `"` を含めると引用符を破り、
 * `filename="report_daily_a"; x="".csv"` のように**別のヘッダパラメータを
 * 注入できる**。`Headers` API が CRLF を拒否するためレスポンス分割には至らないが、
 * ヘッダ値の構造をリクエスト側から壊せる状態だった。
 *
 * ■ 方針
 *
 * ファイル名として安全な文字だけを残す。ホワイトリスト方式にするのは、
 * 「危険な文字を除く」方式が新しい攻撃文字の追加に追随できないため。
 * 併せて長さも制限する (ヘッダ長とファイルシステム上の上限の双方に配慮)。
 */

const MAX_FILENAME_LENGTH = 120;

/**
 * ファイル名に使える文字だけを残す。使えない文字は `_` に置き換える。
 * 結果が空になる場合は呼び出し側が意図を失わないよう `download` を返す。
 */
export function sanitizeFilename(name: string): string {
  const replaced = name
    .replace(/[^A-Za-z0-9._-]/g, "_")
    // 先頭のドットは隠しファイル扱いになるため落とす。".." も無害化される。
    .replace(/^\.+/, "")
    .slice(0, MAX_FILENAME_LENGTH);
  return replaced === "" ? "download" : replaced;
}

/**
 * `Content-Disposition` の値を組み立てる。
 * 呼び出し側は組み立て済みの文字列をそのままヘッダへ渡してよい。
 */
export function attachmentDisposition(filename: string): string {
  return `attachment; filename="${sanitizeFilename(filename)}"`;
}
