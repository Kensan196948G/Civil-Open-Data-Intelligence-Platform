/**
 * Content-Security-Policy の「構成」を固定する契約。
 *
 * 目的は CSP を硬化することではなく、現行構成が壊れたことを検知することにある
 * (docs/design/csp-script-src-decision.md の裁定は案C = 現状維持)。したがって
 * この契約は片側の下限ではなく構成そのものを固定し、**意図せぬ緩和と意図せぬ
 * 硬化の両方**で失敗する。
 *
 * `script-src` の `'unsafe-inline'` は Next.js / React の RSC ペイロード配信機構が
 * 要求しているもので、現時点で意図的に受容している (同 §1-2)。これが消えた場合、
 * 静的ルートは白画面化するため「消えたら通る」のではなく「消えたら落ちる」。
 *
 * なぜ next.config.ts を読んで比較しないのか:
 *   検査対象から期待値を導出する検査は、対象がどう変わっても常に通る。
 *   docs/security/evidence-gate-audit.md が 🔴 に分類した供給元パターンそのもので
 *   あり、同 §3.3 が是正の型として挙げているのが「期待値のピン留め」である。
 *   よって期待値はこのファイル側のリテラルとして持つ。next.config.ts を変更した
 *   だけではこのテストは追従せず、必ず失敗する。
 */

/** 環境によって変わらないディレクティブ。値は 2026-08-11 時点の実測構成。 */
export const PINNED_DIRECTIVES: Readonly<Record<string, readonly string[]>> = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "form-action": ["'self'"],
  // style-src の 'unsafe-inline' は DOM の style="" 属性 22 箇所が要求しており、
  // うち 1 箇所は DB 由来のユーザー定義色のため hash 列挙も成立しない
  // (docs/design/csp-script-src-decision.md §4)
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "https://fonts.gstatic.com"],
  // GSI / OSM タイルはデザイン正本一致の人間判断 (2026-07-18) による許可
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https://cyberjapandata.gsi.go.jp",
    "https://*.tile.openstreetmap.org",
  ],
  "connect-src": ["'self'", "https://cyberjapandata.gsi.go.jp"],
};

/**
 * `script-src` だけは next.config.ts が NODE_ENV で分岐する。
 * どちらか一方に**完全一致**することを要求し、第三の構成は全て失敗させる。
 */
export const ACCEPTED_SCRIPT_SRC: ReadonlyArray<{
  readonly label: string;
  readonly sources: readonly string[];
}> = [
  { label: "production", sources: ["'self'", "'unsafe-inline'"] },
  // E2E は playwright.config.ts の webServer が `npm run dev` を起動するため、
  // CI で実際に観測されるのは通常こちら
  { label: "development", sources: ["'self'", "'unsafe-inline'", "'unsafe-eval'"] },
];

/**
 * 呼び出し側がどちらの構成を期待しているか分かる場合は、必ずピン留めすること。
 *
 * ピン留めしないと `'unsafe-eval'` の有無が production/development の差として
 * 常に説明され、「本番が誤って dev 構成 (`'unsafe-eval'` 込み) を配信している」
 * という実害のある緩和を検知できない。E2E は webServer が `npm run dev` を
 * 起動する以上 development だと**分かっている**ので、そこは固定する。
 */
export type CspExpectation = {
  /** ACCEPTED_SCRIPT_SRC の label。省略時はいずれかに一致すれば可 */
  readonly scriptSrcVariant?: string;
};

/**
 * E2E が観測する構成。playwright.config.ts の webServer が `npm run dev` を
 * 起動する以上 development で固定できる。
 *
 * ⚠ webServer を `npm run build && npm run start` へ変えるなら、ここも
 * "production" へ変えること。ズレたら tests/unit/csp-contract.test.ts が落ちる。
 */
export const E2E_SCRIPT_SRC_VARIANT = "development";

export const CSP_HEADER = "content-security-policy";
export const CSP_REPORT_ONLY_HEADER = "content-security-policy-report-only";

/**
 * 契約の検査対象ルート。静的ルートと動的ルートを最低 1 本ずつ含める。
 *
 * この区別は本質的である。案A' (静的ルートの動的化 + nonce 化) と案C' (動的ルート
 * だけ nonce 化) はいずれも静的ルートと動的ルートで挙動が分かれるため、片方しか
 * 通らないテストでは検知できない。`pageFile` は分類が実装とずれていないことを
 * tests/unit/csp-contract.test.ts が検証するために持つ。
 */
export const CSP_CONTRACT_ROUTES = [
  { path: "/sites", rendering: "static", pageFile: "src/app/sites/page.tsx" },
  { path: "/", rendering: "dynamic", pageFile: "src/app/page.tsx" },
] as const;

export type CspProblemKind =
  | "header-missing"
  | "header-duplicated"
  | "report-only-added"
  | "directive-added"
  | "directive-removed"
  | "directive-duplicated"
  | "loosened"
  | "hardened";

export type CspProblem = {
  kind: CspProblemKind;
  directive: string;
  detail: string;
};

/** ディレクティブ名 -> ソース列。重複ディレクティブは呼び出し側へ報告する。 */
export function parseCspHeader(header: string): {
  directives: Map<string, string[]>;
  duplicated: string[];
} {
  const directives = new Map<string, string[]>();
  const duplicated: string[] = [];

  for (const segment of header.split(";")) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    const name = tokens[0].toLowerCase();
    if (directives.has(name)) {
      duplicated.push(name);
      continue;
    }
    directives.set(name, tokens.slice(1));
  }

  return { directives, duplicated };
}

function diffSources(expected: readonly string[], actual: readonly string[]) {
  return {
    extra: actual.filter((source) => !expected.includes(source)),
    missing: expected.filter((source) => !actual.includes(source)),
  };
}

/**
 * 比較対象の受容構成を選ぶ。
 * `expected` が指定されていればその構成へ固定し、無ければ差分が最小の構成を選ぶ。
 */
function resolveScriptSrcVariant(actual: readonly string[], expected?: string) {
  if (expected !== undefined) {
    const pinned = ACCEPTED_SCRIPT_SRC.find((variant) => variant.label === expected);
    if (!pinned) {
      throw new Error(
        `未知の script-src 受容構成が指定された: ${expected} ` +
          `(既知: ${ACCEPTED_SCRIPT_SRC.map((variant) => variant.label).join(", ")})`,
      );
    }
    return { variant: pinned, diff: diffSources(pinned.sources, actual) };
  }

  let best = ACCEPTED_SCRIPT_SRC[0];
  let bestDiff = diffSources(best.sources, actual);

  for (const variant of ACCEPTED_SCRIPT_SRC.slice(1)) {
    const diff = diffSources(variant.sources, actual);
    if (diff.extra.length + diff.missing.length < bestDiff.extra.length + bestDiff.missing.length) {
      best = variant;
      bestDiff = diff;
    }
  }

  return { variant: best, diff: bestDiff };
}

/** 実測 CSP がどちらの受容構成に一致したか。一致しなければ null。 */
export function scriptSrcVariantOf(header: string): string | null {
  const sources = parseCspHeader(header).directives.get("script-src");
  if (!sources) return null;
  const { variant, diff } = resolveScriptSrcVariant(sources);
  return diff.extra.length === 0 && diff.missing.length === 0 ? variant.label : null;
}

/**
 * レスポンスヘッダ全体を受け取り、契約違反を列挙する。
 *
 * ヘッダ集合ごと受け取るのは report-only ヘッダの追加を検知するためである。
 * middleware が nonce ポリシーを別ヘッダで足す形の変更は、既存ヘッダだけを見ると
 * 素通りする。
 */
export function evaluateCspHeaders(
  headers: Readonly<Record<string, string | undefined>>,
  expectation: CspExpectation = {},
): CspProblem[] {
  const normalized = new Map<string, string>();
  for (const [key, value] of Object.entries(headers)) {
    if (value !== undefined) normalized.set(key.toLowerCase(), value);
  }

  const problems: CspProblem[] = [];

  const reportOnly = normalized.get(CSP_REPORT_ONLY_HEADER);
  if (reportOnly !== undefined) {
    problems.push({
      kind: "report-only-added",
      directive: CSP_REPORT_ONLY_HEADER,
      detail: `想定外の report-only ヘッダが追加されている: ${reportOnly}`,
    });
  }

  const header = normalized.get(CSP_HEADER);
  if (header === undefined || header.trim() === "") {
    problems.push({
      kind: "header-missing",
      directive: CSP_HEADER,
      detail: "CSP ヘッダが存在しない。next.config.ts の headers() が効いていない可能性がある",
    });
    return problems;
  }

  // Playwright は同名ヘッダが複数あると改行で連結する
  if (header.includes("\n")) {
    problems.push({
      kind: "header-duplicated",
      directive: CSP_HEADER,
      detail: `CSP ヘッダが複数返っている (middleware による追加の可能性): ${JSON.stringify(header)}`,
    });
  }

  const { directives, duplicated } = parseCspHeader(header);

  for (const name of duplicated) {
    problems.push({
      kind: "directive-duplicated",
      directive: name,
      detail: "同一ディレクティブが 2 回以上現れている。ブラウザは後勝ちではなく最初の 1 つを使う",
    });
  }

  const expectedNames = new Set([...Object.keys(PINNED_DIRECTIVES), "script-src"]);

  for (const name of directives.keys()) {
    if (!expectedNames.has(name)) {
      problems.push({
        kind: "directive-added",
        directive: name,
        detail:
          "契約に無いディレクティブが追加されている。意図した変更なら tests/e2e/csp-contract.ts を先に更新すること",
      });
    }
  }

  for (const name of expectedNames) {
    if (!directives.has(name)) {
      problems.push({
        kind: "directive-removed",
        directive: name,
        detail: "契約にあるディレクティブが消えている",
      });
    }
  }

  for (const [name, expected] of Object.entries(PINNED_DIRECTIVES)) {
    const actual = directives.get(name);
    if (!actual) continue;
    const { extra, missing } = diffSources(expected, actual);
    if (extra.length > 0) {
      problems.push({
        kind: "loosened",
        directive: name,
        detail: `許可元が増えている: ${extra.join(" ")}`,
      });
    }
    if (missing.length > 0) {
      problems.push({
        kind: "hardened",
        directive: name,
        detail: `許可元が消えている: ${missing.join(" ")} (この機能が壊れていないか確認すること)`,
      });
    }
  }

  const scriptSrc = directives.get("script-src");
  if (scriptSrc) {
    const { variant, diff } = resolveScriptSrcVariant(scriptSrc, expectation.scriptSrcVariant);
    const accepted =
      expectation.scriptSrcVariant === undefined
        ? ACCEPTED_SCRIPT_SRC.map((entry) => `${entry.label}: ${entry.sources.join(" ")}`).join(" / ")
        : `${variant.label} に固定: ${variant.sources.join(" ")}`;
    if (diff.extra.length > 0) {
      problems.push({
        kind: "loosened",
        directive: "script-src",
        detail: `${variant.label} 構成に対して許可元が増えている: ${diff.extra.join(" ")} (受容構成: ${accepted})`,
      });
    }
    if (diff.missing.length > 0) {
      problems.push({
        kind: "hardened",
        directive: "script-src",
        detail:
          `${variant.label} 構成に対して許可元が消えている: ${diff.missing.join(" ")}。` +
          `'unsafe-inline' の除去は docs/design/csp-script-src-decision.md の裁定 (案C = 現状維持) の` +
          `再開を意味するため、CTO 判断を経ずにここを通してはならない (受容構成: ${accepted})`,
      });
    }
  }

  return problems;
}

/** 失敗メッセージ用。契約を満たしていれば空文字列を返す。 */
export function describeCspProblems(problems: readonly CspProblem[]): string {
  return problems.map((problem) => `[${problem.kind}] ${problem.directive}: ${problem.detail}`).join("\n");
}
