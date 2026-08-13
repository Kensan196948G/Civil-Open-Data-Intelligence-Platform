import { describe, expect, it } from "vitest";

import { requireCspContract } from "../../scripts/tools/release-smoke.js";

/**
 * 本番スモークの CSP 判定が「逸脱を検知できる」ことの証明 (Issue #129 / T-B6)。
 *
 * このファイルの主張は「新実装が通る」ではなく「**旧実装では素通りした変更が、
 * 新実装では FAIL する**」である。緑のテストは検知能力を何も証明しないため、
 * 各ケースで旧実装 (legacySubstringCheck) が true を返すことを併せて表明する。
 * 旧実装をテスト内に据え置いてあるので、この証明は実行のたびに再現される
 * (source を書き換えて確認する手順型の mutation と違い、退行しない)。
 *
 * 隣接テストとの役割分担:
 *   - tests/unit/csp-contract.test.ts (QA / Issue #125): 期待値そのものの正しさ。
 *     実測 CSP のリテラルと PINNED_DIRECTIVES がズレていないか。
 *   - 本ファイル: scripts/tools/release-smoke.js が契約を**正しく使っているか**。
 *     契約側だけをテストすると、release-smoke.js が部分文字列照合へ戻されても
 *     気付けない。だからここは requireCspContract を直接叩く。
 */

/**
 * next.config.ts が production build で実際に発行する CSP (2026-08-11T23:45Z 実測)。
 *
 * タイムゾーンを明示するのは、証跡の真偽が読む人の地域で変わらないようにするため。
 * 裸の `YYYY-MM-DD 実測` は、書き手が JST で、読み手が UTC だと 1 日ずれ、
 * 「まだ来ていない日付で実測したと書いてある」という読まれ方をする。
 * このリポジトリの docs/ は `YYYY-MM-DDTHH:MMZ` が 350 件で支配的であり、それに揃える。
 */
const PRODUCTION_CSP = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' https://fonts.gstatic.com",
  "img-src 'self' data: blob: https://cyberjapandata.gsi.go.jp https://*.tile.openstreetmap.org",
  "connect-src 'self' https://cyberjapandata.gsi.go.jp",
].join("; ");

/**
 * Issue #129 以前の scripts/tools/release-smoke.js の判定を逐語で保存したもの。
 *
 * ⚠ これは仕様ではない。「何が素通りしていたか」を再現するための参照実装であり、
 *   本番経路からは既に外れている。ここを新実装に合わせて更新してはならない。
 *
 * needle を配列に出して `every` で回しているのは、CodeQL の
 * `js/incomplete-url-substring-sanitization` (security-severity 7.8 / Issue #142) への
 * 対応である。同ルールの指摘自体は**正しい**。旧実装は URL の不完全な部分一致で
 * 判定していた。しかしそれこそが本ファイルの検査対象であり、厳密比較へ書き換えると
 * 下の「素通りする変更 2」——`connect-src` を消しても `img-src` 側の出現だけで成立して
 * いた——が成立しなくなる。つまり Issue #129 の回帰検知そのものが消える。
 *
 * 抑制コメントは採れない。`scripts/tools/check-codeql-sarif.js` は SARIF の
 * `suppressions` を参照せず `runs[].results` を全件数えるため、抑制しても
 * `codeql-findings` は落ち続ける (2026-08-11T23:45Z 実測)。
 *
 * 判定内容は逐語のまま。needle の値・並び・論理は旧実装と同一で、振る舞いは変えていない
 * (この不変性は下のケース群がそのまま変異試験になっている)。
 */
const LEGACY_REQUIRED_SUBSTRINGS = [
  "default-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "https://cyberjapandata.gsi.go.jp",
] as const;
const LEGACY_FORBIDDEN_SUBSTRING = "'unsafe-eval'";

function legacySubstringCheck(csp: string): boolean {
  return (
    LEGACY_REQUIRED_SUBSTRINGS.every((needle) => csp.includes(needle)) &&
    !csp.includes(LEGACY_FORBIDDEN_SUBSTRING)
  );
}

type SmokeCheck = { name: string; ok: boolean; detail: string };

function runSmokeCsp(headers: Headers): SmokeCheck {
  const checks: SmokeCheck[] = [];
  requireCspContract(checks, headers);
  expect(checks).toHaveLength(1);
  expect(checks[0].name).toBe("header:csp value");
  return checks[0];
}

function smokeCspFor(csp: string): SmokeCheck {
  return runSmokeCsp(new Headers({ "content-security-policy": csp }));
}

/** ディレクティブを 1 つ丸ごと削除した CSP を作る。 */
function withoutDirective(csp: string, directive: string): string {
  const remaining = csp
    .split("; ")
    .filter((segment) => segment.split(/\s+/)[0] !== directive);
  expect(remaining).toHaveLength(csp.split("; ").length - 1);
  return remaining.join("; ");
}

/** ディレクティブのソース列を差し替えた CSP を作る。 */
function replaceDirective(csp: string, directive: string, replacement: string): string {
  const segments = csp.split("; ");
  const index = segments.findIndex((segment) => segment.split(/\s+/)[0] === directive);
  expect(index).toBeGreaterThanOrEqual(0);
  segments[index] = replacement;
  return segments.join("; ");
}

describe("release-smoke の CSP 判定 (Issue #129)", () => {
  it("実測の production CSP は合格する", () => {
    const check = smokeCspFor(PRODUCTION_CSP);
    expect(check.ok).toBe(true);
    expect(check.detail).toContain("matched production variant");
  });

  it("旧実装も実測の production CSP は合格させていた (前提の確認)", () => {
    // 旧実装が最初から落ちていたのなら「素通り」の証明にならない。
    expect(legacySubstringCheck(PRODUCTION_CSP)).toBe(true);
  });

  describe("素通りする変更 1: ディレクティブへの許可元追加", () => {
    const mutated = replaceDirective(
      PRODUCTION_CSP,
      "script-src",
      "script-src 'self' 'unsafe-inline' https://evil.example.com",
    );

    it("旧実装は素通りさせた", () => {
      expect(legacySubstringCheck(mutated)).toBe(true);
    });

    it("新実装は loosened として FAIL する", () => {
      const check = smokeCspFor(mutated);
      expect(check.ok).toBe(false);
      expect(check.detail).toContain("[loosened] script-src");
      expect(check.detail).toContain("https://evil.example.com");
    });
  });

  describe("素通りする変更 2: connect-src の削除", () => {
    // https://cyberjapandata.gsi.go.jp は img-src と connect-src の 2 箇所に現れる。
    // 部分文字列照合は「文字列がどこかにあるか」しか見ないため、connect-src を
    // 丸ごと消しても img-src 側の出現だけで条件が成立していた。
    const mutated = withoutDirective(PRODUCTION_CSP, "connect-src");

    it("旧実装は素通りさせた (img-src 側の出現で成立するため)", () => {
      expect(mutated).not.toContain("connect-src");
      expect(mutated).toContain("https://cyberjapandata.gsi.go.jp");
      expect(legacySubstringCheck(mutated)).toBe(true);
    });

    it("新実装は directive-removed として FAIL する", () => {
      const check = smokeCspFor(mutated);
      expect(check.ok).toBe(false);
      expect(check.detail).toContain("[directive-removed] connect-src");
    });
  });

  describe("素通りする変更 3: 旧実装が名前すら参照していなかったディレクティブ", () => {
    const unchecked = ["base-uri", "form-action", "style-src", "font-src", "img-src"] as const;

    it.each(unchecked)("%s の削除を旧実装は素通りさせた", (directive) => {
      expect(legacySubstringCheck(withoutDirective(PRODUCTION_CSP, directive))).toBe(true);
    });

    it.each(unchecked)("%s の削除で新実装は FAIL する", (directive) => {
      const check = smokeCspFor(withoutDirective(PRODUCTION_CSP, directive));
      expect(check.ok).toBe(false);
      expect(check.detail).toContain(`[directive-removed] ${directive}`);
    });

    it("img-src への外部オリジン追加を旧実装は素通りさせ、新実装は FAIL する", () => {
      const mutated = replaceDirective(
        PRODUCTION_CSP,
        "img-src",
        "img-src 'self' data: blob: https://cyberjapandata.gsi.go.jp https://*.tile.openstreetmap.org https://tracker.example.com",
      );
      expect(legacySubstringCheck(mutated)).toBe(true);
      const check = smokeCspFor(mutated);
      expect(check.ok).toBe(false);
      expect(check.detail).toContain("[loosened] img-src");
    });

    it("契約に無いディレクティブの追加で FAIL する", () => {
      const mutated = `${PRODUCTION_CSP}; child-src https://evil.example.com`;
      expect(legacySubstringCheck(mutated)).toBe(true);
      const check = smokeCspFor(mutated);
      expect(check.ok).toBe(false);
      expect(check.detail).toContain("[directive-added] child-src");
    });
  });

  describe("本番が development 構成を配信した場合", () => {
    const devCsp = replaceDirective(
      PRODUCTION_CSP,
      "script-src",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    );

    it("production へ固定しているので FAIL する", () => {
      const check = smokeCspFor(devCsp);
      expect(check.ok).toBe(false);
      expect(check.detail).toContain("[loosened] script-src");
      expect(check.detail).toContain("'unsafe-eval'");
      // 「development 構成への一致」として説明されてはならない
      expect(check.detail).toContain("production 構成に対して");
    });
  });

  describe("ヘッダ層の逸脱", () => {
    it("CSP ヘッダが無ければ FAIL する", () => {
      const check = runSmokeCsp(new Headers());
      expect(check.ok).toBe(false);
      expect(check.detail).toContain("[header-missing]");
    });

    it("report-only ヘッダの追加を検知する (旧実装は見ていなかった)", () => {
      const check = runSmokeCsp(
        new Headers({
          "content-security-policy": PRODUCTION_CSP,
          "content-security-policy-report-only": "default-src *",
        }),
      );
      expect(check.ok).toBe(false);
      expect(check.detail).toContain("[report-only-added]");
    });

    it("CSP ヘッダが 2 つ返る場合を検知する (Node の fetch は ', ' で連結する)", () => {
      // Playwright は改行で連結するため QA 側の fixture は "\n" を使う。本番スモークは
      // Node の fetch を通るので連結文字が違う。改行だけを見ていると本番側が素通りする。
      const headers = new Headers();
      headers.append("content-security-policy", PRODUCTION_CSP);
      headers.append("content-security-policy", "script-src 'self' 'nonce-abc'");
      expect(headers.get("content-security-policy")).toContain(", ");

      const check = runSmokeCsp(headers);
      expect(check.ok).toBe(false);
      expect(check.detail).toContain("[header-duplicated]");
    });
  });
});
