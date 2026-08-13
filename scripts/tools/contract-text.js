#!/usr/bin/env node

/**
 * 契約チェッカーは「このファイルにこの文字列があること」を主張する。それを
 * `source.includes(needle)` で書くと、次の 2 つを区別できない。
 *
 *   retention-days: 14    と    retention-days: 145
 *   timeout-minutes: 5    と    timeout-minutes: 50
 *
 * 実測: 本モジュール導入前の `.github/workflows/production-smoke.yml` を
 * `145` / `50` へ書き換えても `check-github-actions-contract.js` は exit=0
 * だった。つまりゲートは、**固定できていない値を固定したと報告していた**。
 *
 * 直し方として「厳格に見るキーの一覧」を持つのは誤り。一覧は「重要だと我々が
 * 予想したもの」から導出されるので、あとから追加された workflow キーは静かに
 * 対象外になる。これは Issue #133 と同じ「範囲を期待値から導出する」欠陥で、
 * このリポジトリは既に 2 回踏んでいる。そこで一覧ではなく、**照合結果そのもの
 * から判定する述語**にする。
 *
 *   needle の端がトークンの内側にあるなら、その外側の 1 文字はトークンを
 *   継続してはならない。
 *
 * この述語は新しい分類を持ち込まない。**呼び出し側が既に書いている意図を読む**
 * だけである。前方一致させたい needle は例外なく構造文字で終わっている
 * (`workflow_dispatch:` / `docker-image-security:` /
 * `FROM node:22-bookworm-slim@sha256:`) ため、トークン内側の端を持たず、規則が
 * そもそも適用されない。新しいキーが増えたときは既定で厳格側に入る (fail
 * close) ので、列挙のような静かな漏れが起きない。
 *
 * 導入時点の実測（本リポジトリの `requireText` 呼び出し 245 件）:
 *   境界要件が付いた           236 件
 *   両端とも構造文字で不適用     9 件
 *   照合しなくなった             0 件
 *
 * `.` と `-` を継続文字に含めるのは、これらの契約が固定しているトークンの内部に
 * 普通に現れる文字だからである (`retention-days` / `sha256` /
 * `22-bookworm-slim`)。含めなければ `14` が `14.5` の内側で一致してしまう。
 */
const TOKEN_CHAR = /[0-9A-Za-z_.-]/;

/**
 * 照合状態を 3 値で返す。`absent` と `fragment` を潰さないのは、運用上の意味が
 * 違うためである。`fragment` は「文字列は目で見えているのに落ちる」状態なので、
 * `missing` と同じ文言を出すと調査が空転する。
 *
 * @returns {"ok" | "absent" | "fragment"}
 */
function matchState(source, needle) {
  const leftInsideToken = TOKEN_CHAR.test(needle.slice(0, 1));
  const rightInsideToken = TOKEN_CHAR.test(needle.slice(-1));

  let index = source.indexOf(needle);
  if (index === -1) return "absent";

  // 出現が複数ある場合、1 つでも境界を満たせば契約は満たされている。
  for (; index !== -1; index = source.indexOf(needle, index + 1)) {
    const before = index === 0 ? "" : source.slice(index - 1, index);
    const after = source.slice(index + needle.length, index + needle.length + 1);
    const leftOk = !leftInsideToken || before === "" || !TOKEN_CHAR.test(before);
    const rightOk = !rightInsideToken || after === "" || !TOKEN_CHAR.test(after);
    if (leftOk && rightOk) return "ok";
  }

  return "fragment";
}

function describeFailure(label, needle, state) {
  if (state === "fragment") {
    return `${label} has ${needle} only inside a longer token (the contract pins this exact value, not a prefix of it)`;
  }
  return `${label} missing ${needle}`;
}

/**
 * 各チェッカーは自前の `errors` 配列を持つため、配列を束ねた `requireText` を
 * 返す形にしている。関数本体を 4 ファイルへ複製し直すと、次に直すときにまた
 * 4 箇所を直すことになる。
 */
function createRequireText(errors) {
  return function requireText(label, source, needle) {
    const state = matchState(source, needle);
    if (state !== "ok") errors.push(describeFailure(label, needle, state));
  };
}

module.exports = { matchState, describeFailure, createRequireText };
