import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
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
 * 同じ実測に基づく: 当該 run の 6 件は全て `level: warning` かつ `security-severity: 7.8` で、
 * level を閾値にすると high 6 件を抱えたまま緑になる。
 */

const repoRoot = process.cwd();
const scriptPath = path.join(repoRoot, "scripts/tools/check-codeql-sarif.js");
// 予算はスクリプト側の定数を読む。テストへ数値を写すと、定数を動かしたときに
// テストが「動かした後の実装」ではなく「動かす前の期待値」を測り続ける。
const require = createRequire(import.meta.url);
const { MAX_ACCEPTED_SUPPRESSIONS } = require(scriptPath) as { MAX_ACCEPTED_SUPPRESSIONS: number };

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

function result(ruleId = "js/sample-query", ruleIndex = 0) {
  return {
    ruleId,
    // 実測どおり、result 自身は level を持たない。
    rule: { id: ruleId, index: ruleIndex, toolComponent: { index: 1 } },
    message: { text: "irrelevant" },
    locations: [
      {
        physicalLocation: {
          artifactLocation: { uri: "src/example.ts" },
          region: { startLine: 9 },
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
  if (!overrides.omitResults) run.results = overrides.results ?? [];
  return { version: "2.1.0", runs: overrides.runs ?? [run] };
}

function runGate(write: (dir: string) => string): { status: number | null; stdout: string; stderr: string } {
  const base = mkdtempSync(path.join(tmpdir(), "codip-sarif-"));
  try {
    const target = write(base);
    const outcome = spawnSync("node", [scriptPath, target], { encoding: "utf8", cwd: repoRoot });
    return { status: outcome.status, stdout: outcome.stdout, stderr: outcome.stderr };
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
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
