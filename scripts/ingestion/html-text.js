"use strict";

/**
 * HTML/XML マークアップからタグを除去して生テキストを返す。
 *
 * 正規表現の `/<[^>]+>/g` による除去は「不完全な複数文字サニタイズ」になりうる
 * (CodeQL js/incomplete-multi-character-sanitization): `<<tag>body</tag>` のような
 * 入力を 1 パスで残してしまう。ここでは区切り文字 `<` / `>` の位置を文字単位で
 * 走査し、閉じる `>` が見つかったタグ区間を反復して除去する。閉じない `<` は
 * マークアップ断片として末尾ごと捨てる（残すと壊れたタグが表示データに残る）。
 *
 * 除去後のテキストは React が表示時に自動エスケープするため、HTML として
 * 解釈される経路は無い（本リポジトリに dangerouslySetInnerHTML は無い）。
 *
 * @param {unknown} value
 * @param {string} [separator] 除去したタグの代わりに挟む区切り文字（既定は空文字）
 * @returns {string}
 */
function stripTagSpans(value, separator = "") {
  const input = String(value ?? "");
  let result = "";
  let cursor = 0;
  while (cursor < input.length) {
    const open = input.indexOf("<", cursor);
    if (open === -1) {
      result += input.slice(cursor);
      return result;
    }
    result += input.slice(cursor, open) + separator;
    const close = input.indexOf(">", open + 1);
    if (close === -1) {
      // 閉じ括弧の無い "<" 以降はタグ断片。生の "<" を本文へ混入させない。
      return result;
    }
    cursor = close + 1;
  }
  return result;
}

module.exports = { stripTagSpans };
