/**
 * データソースの公式URLを「同一資源かどうか」で突き合わせるための正規化 (Issue #192)。
 *
 * ■ 何が起きていたか
 *
 * seed の突き合わせキーは `officialUrl` の生文字列だった。DB の一意インデックスも
 * 生文字列に張られている。そのためシードの URL が `http://` から `https://` へ
 * 更新されると、旧 scheme のレコードが残ったまま新しい行が作られ、同じデータソースが
 * 二重に登録される。実際に「水文水質データベース」が本番で 2 件になっていた
 * (`http://www1.river.go.jp/` と `https://www1.river.go.jp/`)。
 *
 * ■ 正規化の範囲
 *
 * 「同じ資源を指すか」の判定に限定し、URL そのものは書き換えない。表示・遷移には
 * 登録された `officialUrl` をそのまま使う。過剰な正規化 (クエリの並べ替え、
 * `index.html` の除去など) は別資源を同一視する危険があるため行わない。
 *
 *   - scheme (`http://` / `https://`) を除く … Issue #192 の直接原因
 *   - ホスト部を小文字化 … ホスト名は大文字小文字を区別しない (RFC 3986 §3.2.2)
 *   - 末尾のスラッシュを 1 つ除く … `https://example.jp` と `https://example.jp/` は同一
 *
 * パス以降は大文字小文字を区別する (サーバによって別資源になりうるため)。
 *
 * CommonJS で書いてあるのは、TypeScript の seed (tsx 実行) と CommonJS の
 * 運用スクリプト (scripts/tools/check-duplicate-official-urls.js) の双方から
 * 同じ実装を参照し、正規化規則が二重定義でずれるのを防ぐため。
 */

/**
 * 突き合わせ用のキーを返す。scheme とホスト大小文字と末尾スラッシュの差を吸収する。
 * @param {unknown} url
 * @returns {string} 正規化キー。url が文字列でなければ空文字。
 */
function officialUrlKey(url) {
  if (typeof url !== "string") return "";
  const trimmed = url.trim();
  if (trimmed === "") return "";

  const withoutScheme = trimmed.replace(/^https?:\/\//i, "");
  const slashIndex = withoutScheme.indexOf("/");
  const host = slashIndex === -1 ? withoutScheme : withoutScheme.slice(0, slashIndex);
  const rest = slashIndex === -1 ? "" : withoutScheme.slice(slashIndex);

  const normalized = host.toLowerCase() + rest;
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized;
}

/**
 * officialUrl を持つレコード群を正規化キーでグループ化する。
 * @template {{ officialUrl: string }} T
 * @param {readonly T[]} rows
 * @returns {Map<string, T[]>}
 */
function groupByOfficialUrlKey(rows) {
  /** @type {Map<string, T[]>} */
  const groups = new Map();
  for (const row of rows) {
    const key = officialUrlKey(row.officialUrl);
    const bucket = groups.get(key);
    if (bucket) bucket.push(row);
    else groups.set(key, [row]);
  }
  return groups;
}

module.exports = { officialUrlKey, groupByOfficialUrlKey };
