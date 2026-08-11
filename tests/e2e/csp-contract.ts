/**
 * CSP 契約の TypeScript 側入口。
 *
 * 期待値と判定ロジックの正本は `scripts/tools/csp-contract.js` にある。
 * このファイルは再エクスポートのみで、値もロジックも持たない。
 *
 * なぜ分けたか (Issue #129):
 *   同じ契約を E2E (tests/e2e/csp.spec.ts) と本番スモーク
 *   (scripts/tools/release-smoke.js) の両方が参照する。本番スモークは
 *   `node scripts/tools/release-smoke.js` として起動するため tsx を通らない。
 *   正本を TS 側に置くと、本番の検証経路が devDependencies の有無に依存する。
 *   逆に正本を素の CommonJS へ置けば、node からも vitest / Playwright からも
 *   同一の定義を読める。期待値の重複定義が無いことが Issue #129 の受入条件である。
 *
 * ⚠ 期待値を変えるときは `scripts/tools/csp-contract.js` を編集すること。
 *   ここへ値を書き足すと、その瞬間に定義が二重化して受入条件が壊れる。
 */
export {
  ACCEPTED_SCRIPT_SRC,
  CSP_CONTRACT_ROUTES,
  CSP_HEADER,
  CSP_REPORT_ONLY_HEADER,
  E2E_SCRIPT_SRC_VARIANT,
  PINNED_DIRECTIVES,
  PRODUCTION_SCRIPT_SRC_VARIANT,
  describeCspProblems,
  evaluateCspHeaders,
  parseCspHeader,
  scriptSrcVariantOf,
} from "../../scripts/tools/csp-contract.js";

export type {
  CspExpectation,
  CspProblem,
  CspProblemKind,
} from "../../scripts/tools/csp-contract.js";
