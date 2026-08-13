import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_SCRIPT_SRC,
  CSP_CONTRACT_ROUTES,
  CSP_HEADER,
  CSP_REPORT_ONLY_HEADER,
  type CspExpectation,
  E2E_SCRIPT_SRC_VARIANT,
  evaluateCspHeaders,
  scriptSrcVariantOf,
} from "../e2e/csp-contract";
import {
  CONSOLE_ALLOWLIST,
  type CapturedEntry,
  decideAllowlist,
  unexplainedEntries,
} from "../e2e/console-noise";

/**
 * tests/e2e/csp-contract.ts と console-noise.ts の判定能力を検証する変異harness。
 *
 * なぜ e2e spec と別に置くのか:
 *   この開発機は Chromium が SIGTRAP で起動できず (memory: Local E2E blocked)、
 *   E2E spec をローカルで走らせられない。「変異を入れたら spec が false に転じる」
 *   ことを PR 本文へ書くだけでは、それは自己申告の証跡であり
 *   docs/security/evidence-gate-audit.md が 🔴 に分類した供給元パターンそのものに
 *   なる。判定ロジックを Playwright 非依存のモジュールへ切り出し、その判定能力を
 *   npm test で毎回機械的に再確認できるようにしてある。
 *
 * ここで検証していないのは「Playwright が実サーバのヘッダを正しく渡すか」だけで、
 * それは CI の e2e job が担う。
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");

/**
 * 実測値。2026-08-11 に playwright.config.ts の webServer と同じ環境変数で
 * `next dev` を起動し、`curl -D -` で取得した Content-Security-Policy の値。
 * /sites (静的) /logs /(動的) /map の 4 ルートで完全に同一だった。
 */
const MEASURED_DEV_CSP =
  "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; " +
  "form-action 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' data: blob: https://cyberjapandata.gsi.go.jp https://*.tile.openstreetmap.org; " +
  "connect-src 'self' https://cyberjapandata.gsi.go.jp";

const headersWith = (csp: string): Record<string, string> => ({ [CSP_HEADER]: csp });

describe("CSP contract accepts the measured production-equivalent header", () => {
  it("passes the header actually served by the dev server", () => {
    expect(evaluateCspHeaders(headersWith(MEASURED_DEV_CSP))).toEqual([]);
  });

  it("passes the production variant of script-src when no variant is pinned", () => {
    const production = MEASURED_DEV_CSP.replace(" 'unsafe-eval'", "");
    expect(evaluateCspHeaders(headersWith(production))).toEqual([]);
    expect(scriptSrcVariantOf(production)).toBe("production");
    expect(scriptSrcVariantOf(MEASURED_DEV_CSP)).toBe("development");
  });

  it("passes the dev variant when development is pinned", () => {
    expect(evaluateCspHeaders(headersWith(MEASURED_DEV_CSP), { scriptSrcVariant: "development" })).toEqual([]);
  });

  it("rejects an unknown variant label instead of silently passing", () => {
    // typo で "dev" と書いたときに「制約なし」へ退化しないこと
    expect(() => evaluateCspHeaders(headersWith(MEASURED_DEV_CSP), { scriptSrcVariant: "dev" })).toThrow();
  });

  it("is insensitive to header name casing and directive order", () => {
    const reordered = MEASURED_DEV_CSP.split("; ").reverse().join("; ");
    expect(evaluateCspHeaders({ "Content-Security-Policy": reordered })).toEqual([]);
  });
});

/**
 * 変異検査。各行は「この変異を入れたら契約が false に転じる」ことを主張する。
 * 転じない変異があれば、そのテストはその変化を守っていない。
 */
describe("CSP contract turns false under mutation", () => {
  const mutations: Array<{
    label: string;
    kind: string;
    headers: Record<string, string>;
    expectation?: CspExpectation;
  }> = [
    {
      // CTO 指定の必須変異 1: script-src から 1 ディレクティブを削る
      label: "script-src から 'unsafe-inline' を削る (意図せぬ硬化)",
      kind: "hardened",
      headers: headersWith(MEASURED_DEV_CSP.replace(" 'unsafe-inline' 'unsafe-eval'", " 'unsafe-eval'")),
    },
    {
      // 構成を固定しなければ production 構成として説明されてしまう変異。
      // E2E は development で固定しているのでこれを検知できる
      label: "development 固定下で script-src から 'unsafe-eval' を削る",
      kind: "hardened",
      headers: headersWith(MEASURED_DEV_CSP.replace(" 'unsafe-eval'", "")),
      expectation: { scriptSrcVariant: "development" },
    },
    {
      // 逆向き。本番が誤って dev 構成を配信した場合
      label: "production 固定下で script-src に 'unsafe-eval' が残っている",
      kind: "loosened",
      headers: headersWith(MEASURED_DEV_CSP),
      expectation: { scriptSrcVariant: "production" },
    },
    {
      label: "script-src へ外部オリジンを足す (意図せぬ緩和)",
      kind: "loosened",
      headers: headersWith(
        MEASURED_DEV_CSP.replace("script-src 'self'", "script-src 'self' https://cdn.example.com"),
      ),
    },
    {
      label: "img-src の許可ホストを差し替える",
      kind: "loosened",
      headers: headersWith(
        MEASURED_DEV_CSP.replace("https://*.tile.openstreetmap.org", "https://*.example.com"),
      ),
    },
    {
      label: "connect-src ごと削除する",
      kind: "directive-removed",
      headers: headersWith(MEASURED_DEV_CSP.replace("; connect-src 'self' https://cyberjapandata.gsi.go.jp", "")),
    },
    {
      label: "worker-src を足す (nonce 化に伴う構成変更の先触れ)",
      kind: "directive-added",
      headers: headersWith(`${MEASURED_DEV_CSP}; worker-src 'self'`),
    },
    {
      label: "同一ディレクティブを二重に書く",
      kind: "directive-duplicated",
      headers: headersWith(`${MEASURED_DEV_CSP}; default-src *`),
    },
    {
      label: "report-only ヘッダを追加する",
      kind: "report-only-added",
      headers: {
        [CSP_HEADER]: MEASURED_DEV_CSP,
        [CSP_REPORT_ONLY_HEADER]: "script-src 'self' 'nonce-abc' 'strict-dynamic'",
      },
    },
    {
      label: "CSP ヘッダが 2 つ返る (middleware が別ポリシーを足した場合)",
      kind: "header-duplicated",
      headers: headersWith(`${MEASURED_DEV_CSP}\nscript-src 'self' 'nonce-abc'`),
    },
  ];

  it.each(mutations)("$label -> $kind", ({ headers, kind, expectation }) => {
    const problems = evaluateCspHeaders(headers, expectation ?? {});
    expect(problems.length).toBeGreaterThan(0);
    expect(problems.map((problem) => problem.kind)).toContain(kind);
  });

  // CTO 指定の必須変異 2: CSP ヘッダごと外す
  it("CSP ヘッダごと外す -> header-missing", () => {
    for (const headers of [{}, { [CSP_HEADER]: "" }, { [CSP_HEADER]: "   " }]) {
      const problems = evaluateCspHeaders(headers);
      expect(problems.map((problem) => problem.kind)).toContain("header-missing");
    }
  });

  it("names the decision record when 'unsafe-inline' disappears", () => {
    // 硬化側の失敗は「直せ」ではなく「裁定を再開しろ」が正しい指示になる
    const hardened = evaluateCspHeaders(
      headersWith(MEASURED_DEV_CSP.replace(" 'unsafe-inline' 'unsafe-eval'", " 'unsafe-eval'")),
    );
    expect(hardened.map((problem) => problem.detail).join("\n")).toContain(
      "csp-script-src-decision.md",
    );
  });
});

describe("pinned E2E variant matches how the E2E server is actually started", () => {
  it("stays 'development' only while playwright.config.ts runs the dev server", () => {
    // ここが噛み合っていないと、E2E は「存在しない環境の CSP」を検証していることになる。
    // webServer を build+start へ変えたら E2E_SCRIPT_SRC_VARIANT も直す必要がある
    const config = readFileSync(path.join(repoRoot, "playwright.config.ts"), "utf8");
    const runsDevServer = /command:[\s\S]{0,400}?npm run dev/.test(config);
    expect(runsDevServer).toBe(E2E_SCRIPT_SRC_VARIANT === "development");
  });

  it("names a variant that actually exists", () => {
    expect(ACCEPTED_SCRIPT_SRC.map((variant) => variant.label)).toContain(E2E_SCRIPT_SRC_VARIANT);
  });
});

describe("contract routes cover both rendering modes", () => {
  it("includes at least one static and one dynamic route", () => {
    const modes = new Set(CSP_CONTRACT_ROUTES.map((route) => route.rendering));
    expect(modes.has("static")).toBe(true);
    expect(modes.has("dynamic")).toBe(true);
  });

  it.each(CSP_CONTRACT_ROUTES)(
    "classifies $path as $rendering consistently with its page source",
    (route) => {
      // 分類が実装とずれたまま「静的も動的も見ている」と主張し続けるのを防ぐ。
      // frontend が /sites を force-dynamic にしたら、この spec のカバレッジ主張は
      // 成り立たなくなるので落とす
      const source = readFileSync(path.join(repoRoot, route.pageFile), "utf8");
      const isForcedDynamic = /export const dynamic\s*=\s*"force-dynamic"/.test(source);
      expect(isForcedDynamic).toBe(route.rendering === "dynamic");
    },
  );
});

describe("console allowlist cannot hide what the check exists for", () => {
  const entry = (text: string, location = ""): CapturedEntry => ({
    source: "console",
    route: "/sites",
    text,
    location,
  });

  it("allows a genuine Google Fonts network failure", () => {
    const decision = decideAllowlist(
      entry(
        "Failed to load resource: net::ERR_NAME_NOT_RESOLVED",
        "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP",
      ),
    );
    expect(decision.allowed).toBe(true);
    expect(decision.entryId).toBe("google-fonts-cdn-unreachable");
  });

  it("refuses to allowlist a CSP violation on the same host", () => {
    // 同じオリジンでも、原因が CSP なら見逃してはならない。
    // style-src から fonts.googleapis.com が消えたときに出る文言
    const decision = decideAllowlist(
      entry(
        "Refused to load the stylesheet 'https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP' " +
          "because it violates the following Content Security Policy directive: \"style-src 'self' 'unsafe-inline'\".",
        "https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+JP",
      ),
    );
    expect(decision.allowed).toBe(false);
  });

  it.each([
    "Refused to execute inline script because it violates the following Content Security Policy directive: \"script-src 'self'\".",
    "Refused to connect to 'https://cyberjapandata.gsi.go.jp/' because it violates the following Content Security Policy directive.",
    "Refused to apply inline style because it violates the following Content Security Policy directive.",
    "[Report Only] Refused to load the script 'https://example.com/a.js'.",
  ])("never allowlists: %s", (text) => {
    expect(decideAllowlist(entry(text)).allowed).toBe(false);
    expect(unexplainedEntries([entry(text)])).toHaveLength(1);
  });

  it("does not allowlist an unrelated console error", () => {
    expect(decideAllowlist(entry("TypeError: t is not a function")).allowed).toBe(false);
  });

  it("requires every allowlist entry to record why it is harmless", () => {
    for (const allowlisted of CONSOLE_ALLOWLIST) {
      expect(allowlisted.id, "allowlist entry needs an id").not.toBe("");
      expect(allowlisted.why.length, `allowlist ${allowlisted.id} needs a justification`).toBeGreaterThan(40);
    }
  });
});
