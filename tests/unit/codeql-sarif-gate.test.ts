import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `scripts/tools/check-codeql-sarif.js` の検査。
 *
 * fixture の形は**実測した CodeQL の出力**から写している (run 31541261002 / commit 9ea42d5 の
 * codeql-sarif artifact)。実出力では
 *   - `results[]` に `level` が無い
 *   - `tool.driver.rules` は空
 *   - rule は `tool.extensions[result.rule.toolComponent.index].rules[result.rule.index]`
 * であり、想像で書いた fixture ではこの 3 点を全て外す。fixture を実物に合わせておかないと、
 * テストは緑でも本番の SARIF では検出をすり抜ける。
 *
 * 判定閾値が `security-severity >= 7.0` であって `level === "error"` でないことも、
 * 同じ実測に基づく: 当該 run の 6 件は**実効 level が warning** かつ `security-severity: 7.8` で、
 * level を閾値にすると high 6 件を抱えたまま緑になる。
 *
 * ここで実フィールドと実効値を分けて書く。実測 (run 31555165656 / artifact 9125778552) では
 * **6/6 の result が `level` を持たず**、`warning` は `rule.defaultConfiguration.level` 由来で
 * ある。「level が warning だった」と書くと、値が入っていたのか不在の既定値なのかが再現
 * できない。**欠落と値を同じ記述へ潰すこと**は、まさに本ゲートが摘発している欠陥と同型で
 * ある (同 run の rule 87 件中 2 件は `defaultConfiguration.level` すら持たない)。
 */

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, "scripts/tools/check-codeql-sarif.js");
// 予算はスクリプト側の定数を読む。テストへ数値を写すと、定数を動かしたときに
// テストが「動かした後の実装」ではなく「動かす前の期待値」を測り続ける。
const require = createRequire(import.meta.url);
const {
  MAX_ACCEPTED_SUPPRESSIONS,
  MIN_SECURITY_SEVERITY,
  MAX_SECURITY_SEVERITY,
  ACCEPTED_LEVELS,
  DEFAULT_LEVEL,
  FAILING_LEVELS,
  DEFAULT_ALLOWLIST_FILE,
  ALLOWLIST_REGIME_FULL,
  REGIME_LABEL_ASSUMED_FULL,
  KNOWN_DIFF_INFORMED_REGIMES,
  classifyRegime,
  normalizePath,
  parseAllowlist,
  loadAllowlist,
} = require(scriptPath) as {
  MAX_ACCEPTED_SUPPRESSIONS: number;
  MIN_SECURITY_SEVERITY: number;
  MAX_SECURITY_SEVERITY: number;
  ACCEPTED_LEVELS: Set<string>;
  DEFAULT_LEVEL: string;
  FAILING_LEVELS: Set<string>;
  DEFAULT_ALLOWLIST_FILE: string;
  ALLOWLIST_REGIME_FULL: string;
  REGIME_LABEL_ASSUMED_FULL: string;
  KNOWN_DIFF_INFORMED_REGIMES: Set<string>;
  classifyRegime: (incrementalMode: unknown) => { label: string; regimeClass: string };
  normalizePath: (uri: unknown) => string;
  parseAllowlist: (raw: string, source: string) => { entries: AllowlistEntry[]; problems: string[] };
  loadAllowlist: (file: string, explicit: boolean) => { entries: AllowlistEntry[]; problems: string[] };
};

type AllowlistEntry = {
  path: string;
  ruleId: string;
  count: number;
  justification: string;
  consumed: number;
};

/** 実測どおり `diff-informed`。定数側は "full" しか持たないため、こちらは実測値を書く。 */
const DIFF_INFORMED = "diff-informed";
/** 実測 (2026-08-26): CodeQL bundle 更新後、`pull_request` run は `diff-informed,overlay` を報告する。 */
const DIFF_INFORMED_OVERLAY = "diff-informed,overlay";

const JS_QUERIES = "codeql/javascript-queries";

type RuleOverrides = {
  id?: string;
  securitySeverity?: string | number | null;
  level?: string;
};

function rule({ id = "js/sample-query", securitySeverity = "7.8", level = "warning" }: RuleOverrides = {}) {
  const properties: Record<string, unknown> = { tags: ["security"] };
  if (securitySeverity !== null) properties["security-severity"] = securitySeverity;
  return { id, name: id, defaultConfiguration: { level }, properties };
}

function result(ruleId = "js/sample-query", ruleIndex = 0, uri = "src/example.ts", startLine = 9) {
  return {
    ruleId,
    // 実測どおり、result 自身は level を持たない。
    rule: { id: ruleId, index: ruleIndex, toolComponent: { index: 1 } },
    message: { text: "irrelevant" },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri },
          region: { startLine },
        },
      },
    ],
  };
}

type SarifOverrides = {
  results?: unknown[];
  rules?: unknown[];
  invocations?: unknown[];
  omitResults?: boolean;
  runs?: unknown[];
  /** `pull_request` の run に付く `incrementalMode` を再現する。実測値は "diff-informed"。 */
  properties?: Record<string, unknown>;
};

function sarif(overrides: SarifOverrides = {}) {
  const run: Record<string, unknown> = {
    tool: {
      driver: { name: "CodeQL", rules: [] },
      extensions: [
        { name: "codeql", rules: [] },
        { name: JS_QUERIES, rules: overrides.rules ?? [rule()] },
      ],
    },
    invocations: overrides.invocations ?? [{ executionSuccessful: true }],
  };
  if (overrides.properties) run.properties = overrides.properties;
  if (!overrides.omitResults) run.results = overrides.results ?? [];
  return { version: "2.1.0", runs: overrides.runs ?? [run] };
}

/**
 * 既定では**空の受容記録**を明示的に渡す。渡さないとスクリプトはリポジトリ本物の
 * `docs/security/codeql-accepted-findings.json` を読み、その中身が fixture 41 件すべての
 * 暗黙の基準になる。そうなると、受容記録へ 1 行足しただけで無関係なテストが落ち、
 * 落ちた理由は「記録を足した」ではなく「fixture が古い」ように見える。各テストは
 * **自分が何を受容記録としているか**を自分で宣言する。
 *
 * 本物の記録を読む経路 (引数なし = CI の実行形) は `runGateWithRepositoryRecord` が測る。
 */
function runGate(
  write: (dir: string) => string,
  acceptance: unknown = { entries: [] },
): { status: number | null; stdout: string; stderr: string } {
  const base = mkdtempSync(path.join(tmpdir(), "codip-sarif-"));
  try {
    const target = write(base);
    const record = path.join(base, "acceptance.json");
    writeFileSync(record, typeof acceptance === "string" ? acceptance : JSON.stringify(acceptance));
    const outcome = spawnSync("node", [scriptPath, target, record], { encoding: "utf8", cwd: repoRoot });
    return { status: outcome.status, stdout: outcome.stdout, stderr: outcome.stderr };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/** 受容記録を渡さない = CI が実際に走らせる形。既定パスの解決までを含めて測る。 */
function runGateWithRepositoryRecord(write: (dir: string) => string) {
  const base = mkdtempSync(path.join(tmpdir(), "codip-sarif-"));
  try {
    const outcome = spawnSync("node", [scriptPath, write(base)], { encoding: "utf8", cwd: repoRoot });
    return { status: outcome.status, stdout: outcome.stdout, stderr: outcome.stderr };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

/** 記録ファイルそのものを置かない（= 明示指定が解決できない）経路を測るための実行形。 */
function runGateWithMissingRecord(write: (dir: string) => string) {
  const base = mkdtempSync(path.join(tmpdir(), "codip-sarif-"));
  try {
    const absent = path.join(base, "does-not-exist.json");
    const outcome = spawnSync("node", [scriptPath, write(base), absent], { encoding: "utf8", cwd: repoRoot });
    return { status: outcome.status, stdout: outcome.stdout, stderr: outcome.stderr, record: absent };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

type FindingSpec = {
  path: string;
  ruleId: string;
  found: number;
  /** 既定は失格相当 (security-severity 7.8)。閾値未満を作るときだけ渡す。 */
  securitySeverity?: string;
  level?: string;
};

/**
 * `path` は **encodeURI した形** で SARIF へ書く。実物の SARIF は
 * `data/Civil%20Open%20Data%20Intelligence%20Platform%20(1).html` のように percent-encoded で、
 * 受容記録の側は人が読める形で書く。fixture が復号済みの文字列を書いてしまうと、
 * 突き合わせの復号が消えてもテストは緑のままになる。
 */
function findingsSarif(specs: FindingSpec[], regime?: string) {
  // rule が 1 件も無い run は「クエリが走っていない」として別の structural problem に
  // なる。検出ゼロを作りたいだけの fixture がそちらへ落ちると、測っているつもりの
  // ものと落ちた理由が食い違う。空のときは既定の rule を 1 件だけ残す。
  const rules =
    specs.length === 0
      ? [rule()]
      : specs.map((spec) =>
          rule({ id: spec.ruleId, securitySeverity: spec.securitySeverity ?? "7.8", level: spec.level ?? "warning" }),
        );
  const results = specs.flatMap((spec, index) =>
    Array.from({ length: spec.found }, (_, offset) =>
      result(spec.ruleId, index, encodeURI(spec.path), 100 + offset),
    ),
  );
  return sarif({ rules, results, ...(regime === undefined ? {} : { properties: { incrementalMode: regime } }) });
}

function withSarif(content: unknown, fileName = "javascript.sarif") {
  return (base: string) => {
    const dir = path.join(base, "sarif-results");
    mkdirSync(dir);
    writeFileSync(path.join(dir, fileName), typeof content === "string" ? content : JSON.stringify(content));
    return dir;
  };
}

describe("CodeQL SARIF findings gate", () => {
  it("passes on a genuinely empty result set", () => {
    // 対照実験。無条件に赤いゲートは、赤いことを何も意味しない。
    const outcome = runGate(withSarif(sarif({ results: [] })));
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("[codeql-sarif] OK");
  });

  it("fails on a finding at or above high severity even when its level is only warning", () => {
    const outcome = runGate(withSarif(sarif({ results: [result()] })));
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("[codeql-sarif][finding]");
    expect(outcome.stderr).toContain("security-severity=7.8 (high)");
    expect(outcome.stderr).toContain("src/example.ts:9");
  });

  it("accepts a finding below the high threshold", () => {
    // 閾値が実在することの確認。全件赤なら上のテストは何も測っていない。
    const outcome = runGate(
      withSarif(sarif({ results: [result()], rules: [rule({ securitySeverity: "6.9" })] })),
    );
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("1 lower-severity result(s) recorded");
  });

  it("fails on a level: error finding that carries no security-severity", () => {
    const outcome = runGate(
      withSarif(
        sarif({ results: [result()], rules: [rule({ securitySeverity: null, level: "error" })] }),
      ),
    );
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("level=error");
  });

  it("does not print the SARIF message text", () => {
    // message.text はソース断片を含み得る。CI ログへ本文を流さない。
    const outcome = runGate(withSarif(sarif({ results: [result()] })));
    expect(`${outcome.stdout}${outcome.stderr}`).not.toContain("irrelevant");
  });

  // ここから下は「検出 0 件」と「検査が成立しなかった」の区別
  // (docs/security/evidence-gate-audit.md §3.5)。いずれも空集合を合格として扱わない。

  it("fails when the output directory does not exist", () => {
    const outcome = runGate((base) => path.join(base, "absent"));
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("SARIF output directory not found");
  });

  it("fails when the output directory holds no .sarif file", () => {
    const outcome = runGate((base) => {
      const dir = path.join(base, "sarif-results");
      mkdirSync(dir);
      writeFileSync(path.join(dir, "notes.txt"), "not a sarif");
      return dir;
    });
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("produced nothing to check");
  });

  it("fails when the SARIF is not parseable", () => {
    const outcome = runGate(withSarif("{ this is not json"));
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("not parseable as JSON");
  });

  it("fails when runs is empty", () => {
    const outcome = runGate(withSarif({ version: "2.1.0", runs: [] }));
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("there is no analysis to evaluate");
  });

  it("fails when the results key is absent (absent is not zero)", () => {
    const outcome = runGate(withSarif(sarif({ omitResults: true })));
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("absent results is not zero results");
  });

  it("fails when an invocation did not succeed", () => {
    const outcome = runGate(withSarif(sarif({ invocations: [{ executionSuccessful: false }] })));
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("executionSuccessful !== true");
  });

  it("fails when no invocation is recorded at all", () => {
    const outcome = runGate(withSarif(sarif({ invocations: [] })));
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("cannot tell whether the analysis ran");
  });

  it("fails when the run carries no rule metadata", () => {
    // クエリが 1 本も走っていない状態。results が空でも「検出なし」ではない。
    const outcome = runGate(withSarif(sarif({ rules: [] })));
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("no queries appear to have run");
  });

  it("resolves a rule by id when the index does not point at it", () => {
    // 実出力は index で引けるが、id 探索は保険として残してある。生きていることを測る。
    const byIdOnly = { ...result(), rule: { id: "js/sample-query", index: 42, toolComponent: { index: 1 } } };
    const outcome = runGate(withSarif(sarif({ results: [byIdOnly] })));
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("security-severity=7.8 (high)");
  });

  it("fails when a result's rule cannot be resolved at all", () => {
    const orphan = {
      ...result(),
      ruleId: "js/unknown",
      rule: { id: "js/unknown", index: 42, toolComponent: { index: 1 } },
    };
    const outcome = runGate(withSarif(sarif({ results: [orphan] })));
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("severity is unclassifiable");
  });

  it("fails when security-severity is present but not numeric", () => {
    const outcome = runGate(
      withSarif(sarif({ results: [result()], rules: [rule({ securitySeverity: "high" })] })),
    );
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("is not a number");
  });
});

/**
 * 抑制チャネル (`result.suppressions`)。
 *
 * ゲートがこの欄を読まないと、抑制は塞がれたのではなく**見えない場所へ移る**。
 * ここで測るのは 2 つの独立した性質である。
 *   受理: 要件を満たした抑制は finding として落とさない (かつ必ず出力される)
 *   予算: 受理件数の上限。超過は受理とは別の失敗
 * 予算 0 のとき「ちょうど予算」は抑制なしの状態と一致するので、受理そのものは
 * 「予算+1 件で落ちるが finding は 1 件も出ない」という形で観測する。
 */
describe("CodeQL SARIF suppression channel", () => {
  function suppressed(overrides: Record<string, unknown> = {}, line = 9) {
    return {
      ...result(),
      locations: [
        {
          physicalLocation: {
            artifactLocation: { uri: "src/example.ts" },
            region: { startLine: line },
          },
        },
      ],
      suppressions: [
        { kind: "external", justification: "accepted in ADR 0003 acceptance record", ...overrides },
      ],
    };
  }

  it("always reports the accepted suppression count, including zero", () => {
    // 出力が無いことと 0 件は区別できない。既定でも件数を出す。
    const outcome = runGate(withSarif(sarif({ results: [] })));
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain(`0 accepted suppression(s) (budget ${MAX_ACCEPTED_SUPPRESSIONS})`);
  });

  it("reports the count on the failing path too", () => {
    const outcome = runGate(withSarif(sarif({ results: [result()] })));
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain("0 accepted suppression(s)");
  });

  it("takes an accepted suppression out of the finding channel but bounds it by the budget", () => {
    const results = Array.from({ length: MAX_ACCEPTED_SUPPRESSIONS + 1 }, (_unused, index) =>
      suppressed({}, index + 1),
    );
    const outcome = runGate(withSarif(sarif({ results })));

    // security-severity 7.8 のまま。それでも finding としては 1 件も出ない ＝ 受理が効いている。
    expect(outcome.stderr).not.toContain("[codeql-sarif][finding]");
    expect(outcome.stdout).toContain(`[codeql-sarif][suppressed] src/example.ts:1 [js/sample-query]`);
    expect(outcome.stdout).toContain(
      `${MAX_ACCEPTED_SUPPRESSIONS + 1} accepted suppression(s) (budget ${MAX_ACCEPTED_SUPPRESSIONS})`,
    );
    // 落ちる理由は finding ではなく予算超過である。
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("exceed the sanctioned budget");
  });

  it("passes at exactly the budget", () => {
    const results = Array.from({ length: MAX_ACCEPTED_SUPPRESSIONS }, (_unused, index) =>
      suppressed({}, index + 1),
    );
    const outcome = runGate(withSarif(sarif({ results })));
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain(`${MAX_ACCEPTED_SUPPRESSIONS} accepted suppression(s)`);
  });

  it("fails on a suppression with an empty justification", () => {
    const outcome = runGate(withSarif(sarif({ results: [suppressed({ justification: "   " })] })));
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("carries no justification");
    expect(outcome.stdout).toContain("0 accepted suppression(s)");
  });

  it("fails on a suppression with no justification key at all", () => {
    const outcome = runGate(
      withSarif(sarif({ results: [{ ...suppressed(), suppressions: [{ kind: "external" }] }] })),
    );
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("carries no justification");
  });

  it("does not accept an inSource suppression", () => {
    // ソース中のコメント 1 行で検出を消せる経路は、レビューを経ない受容になる。
    const outcome = runGate(withSarif(sarif({ results: [suppressed({ kind: "inSource" })] })));
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain('only kind="external" is a sanctioned channel');
    expect(outcome.stdout).not.toContain("[codeql-sarif][suppressed]");
  });

  it("does not accept a suppression whose kind is absent", () => {
    const outcome = runGate(
      withSarif(sarif({ results: [{ ...suppressed(), suppressions: [{ justification: "why" }] }] })),
    );
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("kind=(absent)");
  });

  it("does not accept a suppression that is not in force", () => {
    const outcome = runGate(withSarif(sarif({ results: [suppressed({ status: "underReview" })] })));
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain('only "accepted" is in force');
  });

  it("fails when suppressions is not an array", () => {
    const outcome = runGate(
      withSarif(sarif({ results: [{ ...suppressed(), suppressions: { kind: "external" } }] })),
    );
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("is not an array");
  });

  it("fails when a suppression entry is not an object", () => {
    const outcome = runGate(
      withSarif(sarif({ results: [{ ...suppressed(), suppressions: ["external"] }] })),
    );
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("is not an object");
  });

  it("rejects the whole result when a valid suppression is mixed with an invalid one", () => {
    // 部分受理を許すと、不正な 1 件を正当な 1 件で隠せる。
    const outcome = runGate(
      withSarif(
        sarif({
          results: [
            {
              ...suppressed(),
              suppressions: [
                { kind: "external", justification: "accepted" },
                { kind: "inSource", justification: "accepted" },
              ],
            },
          ],
        }),
      ),
    );
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain("0 accepted suppression(s)");
    expect(outcome.stdout).not.toContain("[codeql-sarif][suppressed]");
  });

  it("does not print the justification text", () => {
    // レビューされていない自由文を CI ログの記録にしない (message を出さないのと同じ理由)。
    const outcome = runGate(
      withSarif(sarif({ results: [suppressed({ justification: "SECRET-LOOKING-RATIONALE" })] })),
    );
    expect(`${outcome.stdout}${outcome.stderr}`).not.toContain("SECRET-LOOKING-RATIONALE");
  });
});

/**
 * `security-severity` の値検証。
 *
 * 初版は `!Number.isFinite(Number(raw))` だけを見ていた。JavaScript の `Number()` は
 * `""` / `null` / `false` / `[]` をいずれも **0** へ変換するため、これらは有限値として
 * 通過し、**severity 0 として合格**していた（実測: 6 種のうち 4 種が exit 0）。
 * 「重大度が明示されているが読めない」ことと「重大度が無い」ことを同じに扱う穴で、
 * 抑制チャネルと同じく、不正な入力が拒否ではなく沈黙を生む形をしている。
 *
 * 明示された `0` は正当な値であり、空値とは区別する。これが本検査の核心なので、
 * 0 が合格し続けることを回帰として固定する。
 */
describe("CodeQL SARIF security-severity validation", () => {
  // `rule()` は securitySeverity: null をプロパティ省略として扱うため、明示的な null や
  // boolean を保持するにはプロパティを直接組み立てる必要がある。
  function ruleWithRawSeverity(raw: unknown) {
    return {
      id: "js/sample-query",
      name: "js/sample-query",
      defaultConfiguration: { level: "warning" },
      properties: { tags: ["security"], "security-severity": raw },
    };
  }

  function runWithSeverity(raw: unknown) {
    return runGate(withSarif(sarif({ rules: [ruleWithRawSeverity(raw)], results: [result()] })));
  }

  const unclassifiable: ReadonlyArray<[string, unknown, string]> = [
    ["an empty string", "", "present but empty"],
    ["a whitespace-only string", "   ", "present but empty"],
    ["an explicit null", null, "is null, not a string or number"],
    ["a boolean false", false, "is a boolean, not a string or number"],
    ["an array", [], "is an array, not a string or number"],
    ["an object", {}, "is an object, not a string or number"],
  ];

  it.each(unclassifiable)("rejects %s as a structural problem, not severity 0", (_label, raw, expected) => {
    const outcome = runWithSeverity(raw);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain(expected);
    // severity 0 として黙って受理されていた頃の挙動に戻っていないこと。
    expect(outcome.stderr).toContain("1 structural problem(s)");
  });

  it("rejects a severity below the defined range", () => {
    const outcome = runWithSeverity(MIN_SECURITY_SEVERITY - 1);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain(`outside the defined range ${MIN_SECURITY_SEVERITY}-${MAX_SECURITY_SEVERITY}`);
  });

  it("rejects a severity above the defined range as a structural problem, not a finding", () => {
    const outcome = runWithSeverity(MAX_SECURITY_SEVERITY + 1);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain(`outside the defined range ${MIN_SECURITY_SEVERITY}-${MAX_SECURITY_SEVERITY}`);
    // 範囲外は「極めて重大な検出」ではなく「読めない値」である。
    expect(outcome.stderr).not.toContain("[codeql-sarif][finding]");
  });

  it("rejects a non-numeric string", () => {
    const outcome = runWithSeverity("critical");
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("is not a number");
  });

  it.each([
    ["a string zero", "0"],
    ["a numeric zero", 0],
  ])("accepts %s as a genuine severity 0", (_label, raw) => {
    const outcome = runWithSeverity(raw);
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("no unaccepted finding at or above security-severity");
  });

  it.each([
    ["the range maximum", MAX_SECURITY_SEVERITY],
    ["a string at the maximum", String(MAX_SECURITY_SEVERITY)],
  ])("still fails on %s as a finding", (_label, raw) => {
    const outcome = runWithSeverity(raw);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("[codeql-sarif][finding]");
    expect(outcome.stderr).toContain("0 structural problem(s)");
  });

  it.each([
    ["a string severity", "7.8"],
    ["a numeric severity", 7.8],
  ])("still classifies %s as a high finding", (_label, raw) => {
    const outcome = runWithSeverity(raw);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("security-severity=7.8 (high)");
  });
});

/**
 * `level` の値検証。
 *
 * 初版は `result.level ?? rule.defaultConfiguration?.level ?? "warning"` の1行で、
 * **`level` を一切検証していなかった**。`??` は明示された `null` と不在を区別しないため、
 * 「産出器が null と言った」「フィールドが無い」「`error` を `fatall` と書き間違えた」の
 * 3つが1点へ潰れ、いずれも `warning` になる。結果として `FAILING_LEVELS` を根拠にした
 * 失敗判定が黙って消える。実測 (改変 SARIF を投入):
 *   - lv-error   (level: "error")   : exit 1  ← 唯一落ちていた
 *   - lv-fatal   (level: "fatal")   : exit 0  (生存)
 *   - lv-null    (level: null)      : exit 0  (生存)
 *   - lv-obj     (level: {})        : exit 0  (生存)
 *   - lv-dflt-fatal / lv-dflt-obj   : exit 0  (生存)
 *
 * security-severity 側は同じ判定のもう一方の入口を厳格に見ている (非文字列・空・
 * 非有限・範囲外を構造異常として拒否)。**同じ判定の2つの入口で強度が違うこと自体が
 * 欠陥**であり、弱いほうの入口が実効的な強度を決める。
 *
 * 一方で「不在」は SARIF 上正当であり、実データではそちらが常態である
 * (run 31555165656: result 6/6 が level 不在、rule 87 件中 2 件は
 * defaultConfiguration.level も不在)。不在まで構造異常にすると本物の SARIF が落ちる。
 * したがって **不在は既定へ落とし、明示された読めない値だけを拒否する**。
 */
describe("CodeQL SARIF level validation", () => {
  // `rule()` は level を必ず文字列として埋めるため、明示 null や非文字列を保持するには
  // rule を直接組み立てる必要がある (severity 側の ruleWithRawSeverity と同じ理由)。
  function ruleWithRawLevel(raw: unknown, { omit = false } = {}) {
    const defaultConfiguration: Record<string, unknown> = {};
    if (!omit) defaultConfiguration.level = raw;
    return {
      id: "js/sample-query",
      name: "js/sample-query",
      defaultConfiguration,
      // level 側だけを見たいので、severity では落ちない値に固定する。
      properties: { tags: ["security"], "security-severity": "1.0" },
    };
  }

  function runWithResultLevel(raw: unknown) {
    return runGate(
      withSarif(
        sarif({
          results: [{ ...result(), level: raw }],
          rules: [ruleWithRawLevel("warning")],
        }),
      ),
    );
  }

  function runWithRuleLevel(raw: unknown, options?: { omit?: boolean }) {
    return runGate(withSarif(sarif({ results: [result()], rules: [ruleWithRawLevel(raw, options)] })));
  }

  const unreadable: ReadonlyArray<[string, unknown, string]> = [
    ["an explicit null", null, "is null, not a string"],
    ["a boolean", false, "is a boolean, not a string"],
    ["an object", {}, "is an object, not a string"],
    ["an array", [], "is an array, not a string"],
    ["a number", 3, "is a number, not a string"],
  ];

  it.each(unreadable)("rejects %s on the result as a structural problem", (_label, raw, expected) => {
    const outcome = runWithResultLevel(raw);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain(`result level of`);
    expect(outcome.stderr).toContain(expected);
    expect(outcome.stderr).toContain("1 structural problem(s)");
  });

  it.each(unreadable)("rejects %s on the rule default as a structural problem", (_label, raw, expected) => {
    const outcome = runWithRuleLevel(raw);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("rule defaultConfiguration level of");
    expect(outcome.stderr).toContain(expected);
  });

  it.each([
    ["a typo of error", "fatall"],
    ["a level SARIF defines but CodeQL never emits", "none"],
    ["an empty string", ""],
    ["a case variant", "Error"],
  ])("rejects %s as outside the accepted vocabulary", (_label, raw) => {
    const outcome = runWithResultLevel(raw);
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("outside the accepted vocabulary");
    // 読めない値は「検出」ではない。finding として数えると重大度が捏造される。
    expect(outcome.stderr).not.toContain("[codeql-sarif][finding]");
  });

  it("does not leak the offending level into a bare unquoted form", () => {
    // 値は JSON として引用して出す。裸で連結すると空文字が消えて読めなくなる。
    const outcome = runWithResultLevel("");
    expect(outcome.stderr).toContain('is "", outside the accepted vocabulary');
  });

  it.each([...ACCEPTED_LEVELS].map((level) => [level] as const))(
    "accepts %s on the result without recording a structural problem",
    (level) => {
      const outcome = runWithResultLevel(level);
      if (FAILING_LEVELS.has(level)) {
        // error は finding として落ちる。それは構造異常ではない — 両者を分けて見る。
        expect(outcome.status).toBe(1);
        expect(outcome.stderr).toContain(`level=${level}`);
        expect(outcome.stderr).toContain("0 structural problem(s)");
      } else {
        expect(outcome.status).toBe(0);
        // 合格経路には structural problem の行が出ない。受理された件数のほうを見る。
        expect(outcome.stdout).toContain("1 lower-severity result(s) recorded");
      }
    },
  );

  it("treats a truly absent level as the default, not as a structural problem", () => {
    // 実データで常時通る経路。ここを厳格化すると本物の SARIF が落ちる。
    const outcome = runWithRuleLevel(undefined, { omit: true });
    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain("no unaccepted finding at or above security-severity");
  });

  it("prefers the result level over the rule default, and stops there when it is unreadable", () => {
    // 先に見つかった側が実効値。読めないときに後段へ落とすと、いま塞いだ穴が開く。
    const outcome = runGate(
      withSarif(
        sarif({
          results: [{ ...result(), level: "fatall" }],
          rules: [ruleWithRawLevel("warning")],
        }),
      ),
    );
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("result level of");
    expect(outcome.stderr).not.toContain("rule defaultConfiguration level of");
  });

  it("still fails on an error level that reaches the gate through the rule default", () => {
    // 退行の本丸: 検証を足したことで level 経路の失敗判定を殺していないこと。
    const outcome = runWithRuleLevel("error");
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("level=error");
    expect(outcome.stderr).toContain("0 structural problem(s)");
  });
});

/**
 * 上の各 describe は期待値を判定定数から導出している。振る舞いの検査としては
 * それが正しい: 定数を動かしたときに「動かす前の期待値」を測り続けるテストは
 * 退行検知にならない。
 *
 * ただし導出**だけ**にすると、定数の値そのものを書き換えた変異が全件緑を保つ。
 * 実測 (単体ファイル 44 tests):
 *   - MAX_ACCEPTED_SUPPRESSIONS 0 -> 99          : 44/44 passed (生存)
 *   - MIN/MAX_SECURITY_SEVERITY 0-10 -> -100..100 : 44/44 passed (生存)
 * 後者が通ると負の security-severity が構造異常として記録されず黙って合格する。
 *
 * 定数には2つの役割がある。実装の詳細であるうちは導出でよい。**方針の表明**で
 * あるとき — 抑制をまだ1件も受け入れていない / SARIF の security-severity は
 * 0-10 で定義される — その変更はテストが追随してよい変更ではなく、レビューを
 * 要する変更である。だから固定は2層にする。
 *
 *   1. 値そのものを直接固定する (方針を書き換えたら落ちる)
 *   2. 定数を一切経由しないリテラルで要求を固定する (1 と定数を同時に
 *      書き換えても落ちる)
 *
 * 2 は 1 の重複ではない。1 だけなら「定数と固定値を揃えて書き換える」変異が
 * 生き残り、それはまさにこのゲートが扱っている欠陥族 — 検査が対象と一緒に
 * 動いてしまい、緑が網羅を意味しなくなる — と同型である。
 *
 * env / CLI から上書きさせない設計は、ソース直接編集に対しては何も守らない。
 */
describe("CodeQL SARIF gate policy constants", () => {
  it("pins the accepted-suppression budget at zero", () => {
    // 0 は「抑制を受け入れないと決めた」ではなく「受容をまだ誰も決めていない」。
    // 引き上げるには ADR 0003 の受容記録が要る。テストが黙って追随してはならない。
    expect(MAX_ACCEPTED_SUPPRESSIONS).toBe(0);
  });

  it("pins the security-severity domain at the SARIF-defined 0-10", () => {
    expect(MIN_SECURITY_SEVERITY).toBe(0);
    expect(MAX_SECURITY_SEVERITY).toBe(10);
  });

  it("pins the accepted level vocabulary at the three CodeQL emits", () => {
    // 語彙を広げるのは「読めない値を受理する」と決めることであり、テストが黙って
    // 追随してよい変更ではない。SARIF の enum には "none" もあるが CodeQL は出さない。
    expect([...ACCEPTED_LEVELS].sort()).toEqual(["error", "note", "warning"]);
    expect(DEFAULT_LEVEL).toBe("warning");
    expect([...FAILING_LEVELS]).toEqual(["error"]);
  });

  it.each([
    ["a typo of error", "fatall"],
    ["an explicit null", null],
  ])("records %s as a structural problem, without consulting the vocabulary constant", (_label, raw) => {
    // リテラルで固定する。ACCEPTED_LEVELS を書き換えても、上の pin と同時に
    // 書き換えても落ちる — 定数と期待値を揃えて動かす変異を生かさないため。
    const outcome = runGate((dir) =>
      withSarif(
        sarif({
          results: [{ ...result(), level: raw }],
          rules: [rule({ securitySeverity: "1.0" })],
        }),
      )(dir),
    );

    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("1 structural problem(s)");
    expect(outcome.stderr).not.toContain("[codeql-sarif][finding]");
  });

  it("fails a severity-0 rule whose level is error, without consulting either constant", () => {
    // security-severity 0 の受理は**本ゲートのローカル方針**であって、
    // 「重大度なし」を意味する GitHub の解釈とは別物である (ADR 0003 §「0 の扱い」)。
    // 0 が level=error を覆い隠すと、方針が判定を弱める側へ漏れる。
    const outcome = runGate((dir) =>
      withSarif(sarif({ results: [result()], rules: [rule({ securitySeverity: "0", level: "error" })] }))(dir),
    );

    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("level=error");
    expect(outcome.stderr).toContain("0 structural problem(s)");
  });

  it("fails on a single suppressed result, without consulting the budget constant", () => {
    const outcome = runGate((dir) =>
      withSarif(
        sarif({
          results: [
            {
              ...result(),
              suppressions: [{ kind: "external", justification: "accepted in ADR 0003 acceptance record" }],
            },
          ],
        }),
      )(dir),
    );

    // リテラル 1 件。budget を経由しないので、budget を 99 へ動かしても落ちる。
    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain("1 accepted suppression(s)");
  });

  it.each([
    ["a negative severity", "-5"],
    ["a severity above ten", "11"],
  ])("records %s as a structural problem, not as a finding", (_label, raw) => {
    const outcome = runGate((dir) =>
      withSarif(sarif({ rules: [rule({ securitySeverity: raw })], results: [result()] }))(dir),
    );

    expect(outcome.status).toBe(1);
    // レンジ端をテストへ写さない: 数値を書くと定数と一緒に書き換えられる。
    // 「範囲外と判定された」という事実だけを見る。
    expect(outcome.stderr).toContain("outside the defined range");
    // 11 は範囲を広げると score>=7 の finding として exit 1 を保つ。exit code
    // だけを見ると変異が生き残るため、finding として数えられていないことも見る。
    expect(outcome.stderr).not.toContain("[codeql-sarif][finding]");
  });
});

describe("CodeQL SARIF acceptance record", () => {
  // 実物と同じ形 (空白と括弧を含み、SARIF 側では percent-encoded になる) を使う。
  const HTML = "data/Design Reference (1).html";
  const RULE = "js/xss-through-dom";
  const WHY = "design reference export; not shipped";

  function record(entries: Array<Record<string, unknown>>) {
    return { entries };
  }

  it("passes a full run when the consumed count equals the declared count", () => {
    const outcome = runGate(
      withSarif(findingsSarif([{ path: HTML, ruleId: RULE, found: 2 }])),
      record([{ path: HTML, ruleId: RULE, count: 2, justification: WHY }]),
    );

    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain(`[codeql-sarif][acceptance] ${HTML} [${RULE}] consumed 2/2`);
    expect(outcome.stdout).toContain("2 accepted (allowlist)");
    expect(outcome.stderr).not.toContain("[codeql-sarif][finding]");
  });

  it("matches a percent-encoded SARIF uri against the decoded record path", () => {
    expect(normalizePath(encodeURI(HTML))).toBe(HTML);

    const outcome = runGate(
      withSarif(findingsSarif([{ path: HTML, ruleId: RULE, found: 1 }])),
      record([{ path: HTML, ruleId: RULE, count: 1, justification: WHY }]),
    );

    expect(outcome.status).toBe(0);
    // 受容行と記録行が同じファイルを指していることを読み取れる形で出す。片方だけ
    // 生値だと、同一ファイルであることが出力から判断できない。
    expect(outcome.stdout).toContain(`[codeql-sarif][accepted] ${HTML}:100`);
    expect(outcome.stdout).not.toContain("%20");
  });

  it.each([
    // `incrementalMode` 欠落は full と**見なす**だけなので、ラベルは宣言された "full" と
    // 別の文字列で出る。同じ文字列にすると、ログ上で推定と宣言が区別できない。
    ["a full run", undefined, REGIME_LABEL_ASSUMED_FULL],
    ["a diff-informed run", DIFF_INFORMED, DIFF_INFORMED],
  ])("fails %s when more findings match than were accepted", (_label, regime, printed) => {
    const outcome = runGate(
      withSarif(findingsSarif([{ path: HTML, ruleId: RULE, found: 2 }], regime)),
      record([{ path: HTML, ruleId: RULE, count: 1, justification: WHY }]),
    );

    expect(outcome.status).toBe(1);
    // 超過はどちらのレジームでも観測できる。「見えている以上、多いことは確実に言える」。
    expect(outcome.stderr).toContain("matched 2 finding(s) but 1 is what was accepted");
    expect(outcome.stderr).toContain(`[regime: ${printed}]`);
  });

  it("fails a full run when the record accepts more than the analysis found", () => {
    const outcome = runGate(
      withSarif(findingsSarif([{ path: HTML, ruleId: RULE, found: 1 }])),
      record([{ path: HTML, ruleId: RULE, count: 2, justification: WHY }]),
    );

    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain(`consumed 1/2`);
    expect(outcome.stderr).toContain("only 1 was found in a full analysis");
    expect(outcome.stderr).toContain("stale");
  });

  it("does not fail a diff-informed run when the accepted findings lie outside the diff", () => {
    // これが #143 自身の PR run である。`pull_request` は diff-informed で、
    // 差分外の html の検出は**報告されない**。厳密一致をそのまま当てると、
    // このゲートは自分の PR を赤にする。不足は「見ていない」を含むため落とさない。
    const outcome = runGate(
      withSarif(findingsSarif([{ path: HTML, ruleId: RULE, found: 0 }], DIFF_INFORMED)),
      record([{ path: HTML, ruleId: RULE, count: 2, justification: WHY }]),
    );

    expect(outcome.status).toBe(0);
    expect(outcome.stdout).toContain(`[codeql-sarif][acceptance] ${HTML} [${RULE}] consumed 0/2`);
    expect(outcome.stdout).toContain("0 accepted (allowlist)");
    expect(outcome.stdout).toContain(`analysis regime: ${DIFF_INFORMED}`);
  });

  it("does not let a result below the failing threshold consume an acceptance", () => {
    // 閾値未満まで消費させると、count が「受容した件数」ではなく「たまたま一致した
    // 件数」になる。消費 0 のまま full run で陳腐化として落ちるのが正しい。
    const outcome = runGate(
      withSarif(findingsSarif([{ path: HTML, ruleId: RULE, found: 1, securitySeverity: "4.0", level: "warning" }])),
      record([{ path: HTML, ruleId: RULE, count: 1, justification: WHY }]),
    );

    expect(outcome.status).toBe(1);
    expect(outcome.stdout).toContain(`consumed 0/1`);
    expect(outcome.stdout).toContain("0 accepted (allowlist)");
  });

  it.each([
    ["path is missing", { ruleId: RULE, count: 1, justification: WHY }, "path is missing or empty"],
    ["ruleId is missing", { path: HTML, count: 1, justification: WHY }, "ruleId is missing or empty"],
    ["justification is blank", { path: HTML, ruleId: RULE, count: 1, justification: "   " }, "carries no justification"],
    ["count is zero", { path: HTML, ruleId: RULE, count: 0, justification: WHY }, "integer >= 1"],
    ["count is not an integer", { path: HTML, ruleId: RULE, count: 1.5, justification: WHY }, "integer >= 1"],
    ["the row is not an object", "not-an-object", "is not an object"],
  ])("rejects an entry where %s", (_label, row, fragment) => {
    const parsed = parseAllowlist(JSON.stringify({ entries: [row] }), "record.json");

    expect(parsed.entries).toEqual([]);
    expect(parsed.problems.join("\n")).toContain(fragment);
  });

  it("rejects a second entry for the same path and ruleId", () => {
    const parsed = parseAllowlist(
      JSON.stringify(
        record([
          { path: HTML, ruleId: RULE, count: 1, justification: WHY },
          { path: HTML, ruleId: RULE, count: 3, justification: WHY },
        ]),
      ),
      "record.json",
    );

    // 2 行あると、どちらが何件を消費したのか決められない。一致判定が何も固定しなくなる。
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.problems.join("\n")).toContain("duplicates an earlier entry");
  });

  it("treats an encoded and a decoded path as the same entry", () => {
    const parsed = parseAllowlist(
      JSON.stringify(
        record([
          { path: HTML, ruleId: RULE, count: 1, justification: WHY },
          { path: encodeURI(HTML), ruleId: RULE, count: 1, justification: WHY },
        ]),
      ),
      "record.json",
    );

    // 符号化違いで重複判定をすり抜けると、同じファイルに 2 つの受容枠ができる。
    expect(parsed.entries).toHaveLength(1);
    expect(parsed.problems.join("\n")).toContain("duplicates an earlier entry");
  });

  it.each([
    ["the record is not parseable as JSON", "{ not json", "not parseable as JSON"],
    ["entries is not an array", { entries: {} }, "entries is not an array"],
    ["entries is absent", { documentation: "docs/security/codeql-accepted-findings.md" }, "entries is not an array"],
  ])("fails the run when %s", (_label, acceptance, fragment) => {
    const outcome = runGate(withSarif(sarif()), acceptance);

    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain(fragment);
  });

  it("fails the run when an explicitly named record cannot be read", () => {
    const outcome = runGateWithMissingRecord(withSarif(sarif()));

    // 既定パスの不在は無記録として通すが、名指しした記録が読めないのは別物である。
    // 読めない記録を黙って空として扱うと、パスを打ち間違えた受容が全部消える。
    expect(outcome.status).toBe(1);
    expect(outcome.stderr).toContain("cannot be read");
    // 解決したパスは必ず出力に残す。既定以外の記録が使われたなら、それがログに現れる。
    expect(outcome.stdout).toContain(`acceptance record: ${outcome.record}`);
  });

  it.each([
    ["a run without incrementalMode", undefined, REGIME_LABEL_ASSUMED_FULL],
    ["a run declaring full", ALLOWLIST_REGIME_FULL, ALLOWLIST_REGIME_FULL],
    ["a diff-informed run", DIFF_INFORMED, DIFF_INFORMED],
  ])("prints the regime and a zero acceptance count for %s", (_label, regime, printed) => {
    const outcome = runGate(withSarif(findingsSarif([], regime)));

    expect(outcome.status).toBe(0);
    // レジームを書かなければ、diff-informed の「0 件」が full の「0 件」と同じ文字列で出る。
    expect(outcome.stdout).toContain(`analysis regime: ${printed}`);
    expect(outcome.stdout).toContain(`[regime: ${printed}]`);
    // 0 件でも必ず出す。出さないと「受容が無い」と「受容の手段が無い」が区別できない。
    expect(outcome.stdout).toContain("0 accepted (allowlist)");
  });

  describe("analysis regime vocabulary", () => {
    // 緩和を与える語彙は**実装から読む**。ここへ "diff-informed" と書き写すと、探査
    // ケースが「正しい値の集合」から導出され、語彙外こそが危険な入力なのにテストは
    // 語彙内しか試さなくなる。実測値としての "diff-informed" は下の 1 本で固定する。
    const OUTSIDE_VOCABULARY = ["overlay", "none", "Diff-Informed"].filter(
      (value) => value !== ALLOWLIST_REGIME_FULL && !KNOWN_DIFF_INFORMED_REGIMES.has(value),
    );

    it("keeps the measured value in the vocabulary and the sentinel out of it", () => {
      // 実測: `pull_request` の run は "diff-informed"。語彙がこれを失ったら、本番の
      // PR run が語彙外として落ちる。逆に "full" が語彙へ入ったら、full run が緩和を
      // 受け取る側へ移り、陳腐化検査が消える。両方向を固定する。
      expect(KNOWN_DIFF_INFORMED_REGIMES.has(DIFF_INFORMED)).toBe(true);
      expect(KNOWN_DIFF_INFORMED_REGIMES.has(ALLOWLIST_REGIME_FULL)).toBe(false);
      // 番兵と実データ値の分離。同一文字列だと、推定 (欠落) と宣言が出力で区別できない。
      expect(REGIME_LABEL_ASSUMED_FULL).not.toBe(ALLOWLIST_REGIME_FULL);
      // 探査ケースが語彙の成長で黙って縮まないようにする。3 本のうち 1 本でも語彙へ
      // 入ったなら、それは意図的な緩和であり、ここで気づく必要がある。
      expect(OUTSIDE_VOCABULARY).toHaveLength(3);
    });

    it("recognises the CodeQL diff-informed,overlay variant as diff-informed (not structural)", () => {
      // 実測 (2026-08-26): CodeQL bundle 更新後、`pull_request` run は `incrementalMode` が
      // "diff-informed,overlay" になる。これを語彙外として落とすと、diff-informed の PR 全 run が
      // 陳腐化 (stale) の偽陽性で赤になり、あらゆる PR のマージを止める (実測で #173〜#180 が
      // codeql-findings で fail した)。これはゲートの意図しないブロッカーであり、是正は語彙へ
      // 足すこと (check-codeql-sarif.js の設計コメントに明記)。
      // "diff-informed,overlay" は diff-informed 系列の variant で、差分外の finding を報告しない
      // 性質は素の "diff-informed" と同一のため、同じ緩和を与えてよい。
      const { label, regimeClass } = classifyRegime(DIFF_INFORMED_OVERLAY);
      expect(regimeClass).toBe("diff-informed");
      expect(label).toBe(DIFF_INFORMED_OVERLAY);
      // 差分外の finding が報告されない場合も、陳腐化 (stale) として落とさない。
      const outcome = runGate(
        withSarif(findingsSarif([{ path: HTML, ruleId: RULE, found: 0 }], DIFF_INFORMED_OVERLAY)),
        record([{ path: HTML, ruleId: RULE, count: 2, justification: WHY }]),
      );
      expect(outcome.status).toBe(0);
      expect(outcome.stdout).toContain(`analysis regime: ${DIFF_INFORMED_OVERLAY}`);
    });

    it.each(OUTSIDE_VOCABULARY)(
      "treats regime %s as a structural problem instead of granting leniency",
      (regime) => {
        // 緩和を否定形 (`full でない`) で与えると、未知の値が全部緩い側へ落ちる。
        // CodeQL が push run にも値を付け始めた日に、main の full run が誰にも
        // 気づかれずに陳腐化検査をやめる。肯定形なら、その日は赤で知らされる。
        const outcome = runGate(
          withSarif(findingsSarif([{ path: HTML, ruleId: RULE, found: 1 }], regime)),
          record([{ path: HTML, ruleId: RULE, count: 2, justification: WHY }]),
        );

        expect(outcome.status).toBe(1);
        expect(outcome.stderr).toContain("outside the known vocabulary");
        // 陳腐化判定そのものも緩まないこと。structural problem だけ立てて不足を
        // 見逃すなら、緩和が消えていない。
        expect(outcome.stderr).toContain("stale");
        expect(outcome.stdout).toContain(`analysis regime: unrecognised(${JSON.stringify(regime)})`);
      },
    );

    it("does not grant leniency when a full run is mixed with a diff-informed run", () => {
      // `some(full でない)` は混在でも緩和していた。誤りである: full run が 1 本でも
      // あれば結果の和集合は全体を含むので、不足は「見ていない」ではなく本物の
      // ドリフトになる。緩和は**全 run が diff-informed のとき**だけ。
      const fullRun = findingsSarif([{ path: HTML, ruleId: RULE, found: 1 }]) as { runs: unknown[] };
      const diffRun = findingsSarif([{ path: HTML, ruleId: RULE, found: 0 }], DIFF_INFORMED) as {
        runs: unknown[];
      };
      const outcome = runGate(
        withSarif({ version: "2.1.0", runs: [...fullRun.runs, ...diffRun.runs] }),
        record([{ path: HTML, ruleId: RULE, count: 2, justification: WHY }]),
      );

      expect(outcome.status).toBe(1);
      expect(outcome.stderr).toContain("stale");
      expect(outcome.stdout).toContain(`analysis regime: ${DIFF_INFORMED}, ${REGIME_LABEL_ASSUMED_FULL}`);
    });

    it("does not echo an unbounded regime string into the log", () => {
      // レジーム値は解析対象由来で、長さも中身も保証が無い。CI ログへそのまま流さない。
      const long = "x".repeat(500);
      const { label, regimeClass } = classifyRegime(long);
      expect(regimeClass).toBe("unrecognised");
      expect(label.length).toBeLessThan(80);
      expect(label).toContain("…");
    });
  });
});

describe("CodeQL SARIF acceptance record shipped in the repository", () => {
  // 記録の中身をテストへ写経しない。写経すると、記録を更新したときにテストは
  // 「更新後の実装」ではなく「更新前の期待値」を測り続ける。
  const shipped = loadAllowlist(DEFAULT_ALLOWLIST_FILE, true);

  it("parses without a structural problem", () => {
    expect(shipped.problems).toEqual([]);
    expect(shipped.entries.length).toBeGreaterThan(0);
  });

  it("gives every entry a non-empty justification", () => {
    for (const entry of shipped.entries) {
      expect(entry.justification.trim()).not.toBe("");
    }
  });

  it("accepts exactly what it declares when the gate resolves it by default", () => {
    const specs = shipped.entries.map((entry) => ({
      path: entry.path,
      ruleId: entry.ruleId,
      found: entry.count,
    }));
    const outcome = runGateWithRepositoryRecord(withSarif(findingsSarif(specs)));

    expect(outcome.status).toBe(0);
    for (const entry of shipped.entries) {
      expect(outcome.stdout).toContain(
        `[codeql-sarif][acceptance] ${entry.path} [${entry.ruleId}] consumed ${entry.count}/${entry.count}`,
      );
    }
    const declared = shipped.entries.reduce((total, entry) => total + entry.count, 0);
    expect(outcome.stdout).toContain(`${declared} accepted (allowlist)`);
    expect(outcome.stdout).toContain(`acceptance record: ${DEFAULT_ALLOWLIST_FILE}`);
  });

  it("documents itself where the gate says it does", () => {
    const raw = JSON.parse(readFileSync(DEFAULT_ALLOWLIST_FILE, "utf8")) as { documentation?: string };
    expect(raw.documentation).toBeDefined();
    expect(readFileSync(path.join(repoRoot, raw.documentation as string), "utf8").length).toBeGreaterThan(0);
  });
});
