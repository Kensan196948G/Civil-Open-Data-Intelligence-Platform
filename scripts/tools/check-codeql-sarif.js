#!/usr/bin/env node

/**
 * CodeQL の SARIF を読み、severity 閾値を超える検出があればジョブを落とす。
 *
 * このリポジトリでは GHAS が使えず code-scanning へのアップロードが 403 になるため
 * (ADR 0003 / Issue #139)、`analyze` は `upload: never` で走る。その構成では
 * `analyze` が落ちるのは**アナライザ自体が失敗したとき**だけで、**検出結果では落ちない**。
 * つまり「スキャンが走った」ことしか示せず、「何も見つからなかった」ことは誰も検証していない
 * ＝ docs/security/evidence-gate-audit.md でいう等級3 (内容非検証 / presence-only) になる。
 * 本スクリプトが検出結果そのものを判定して、その穴を塞ぐ。
 *
 * ## 閾値
 *
 * 判定は `security-severity` (0-10 の数値、GitHub の換算で 7.0 以上が high / 9.0 以上が
 * critical) を主とする。組織方針の品質ゲートが「critical および high severity の未解決
 * 脆弱性ゼロ」である以上、閾値はそこに一致していなければならない。
 *
 * SARIF の `level` を閾値にしてはならない。実測 (run 31541261002 / commit 9ea42d5) では
 * `js/incomplete-url-substring-sanitization` の `defaultConfiguration.level` は `warning`
 * でありながら `security-severity` は 7.8 (high) だった。`level === "error"` を閾値にすると
 * high 6 件を検出したまま緑で通る。それは presence-only を presence-only で置き換えることになる。
 * `level: error` も落とすが、それは補助であって主判定ではない。
 *
 * ## 構造検査 (docs/security/evidence-gate-audit.md §3.5)
 *
 * 「検出 0 件」と「読めなかった」を区別する。走査対象が無い、JSON が壊れている、
 * `runs` が空、`results` キーが無い、解析が成功していない、result の rule を引けない —
 * これらは全て**検査が成立しなかった**であって合格ではない。空集合を合格として扱わない。
 */

const fs = require("node:fs");
const path = require("node:path");

// GitHub の security-severity 換算: 9.0+ critical / 7.0-8.9 high / 4.0-6.9 medium。
// 品質ゲートが critical + high をゼロと要求するので、閾値は high の下限に置く。
const FAILING_SECURITY_SEVERITY = 7.0;
// security-severity を持たない (= セキュリティ系でない) rule でも、CodeQL が既定で
// error 相当と判定するものは落とす。
const FAILING_LEVELS = new Set(["error"]);

const problems = [];
const failingResults = [];
let acceptedResults = 0;

function severityLabel(score) {
  if (score >= 9) return "critical";
  if (score >= 7) return "high";
  if (score >= 4) return "medium";
  return "low";
}

function listSarifFiles(dir) {
  if (!fs.existsSync(dir)) {
    problems.push(`SARIF output directory not found: ${dir}`);
    return [];
  }
  if (!fs.statSync(dir).isDirectory()) {
    problems.push(`SARIF output path is not a directory: ${dir}`);
    return [];
  }
  const files = fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sarif"))
    .map((entry) => path.join(dir, entry.name))
    .sort();
  // 0 件は「検出なし」ではない。analyze の output 先が変わった / step が飛ばされた、
  // つまり検査そのものが成立していない状態を、合格として通さない。
  if (files.length === 0) {
    problems.push(`no .sarif files under ${dir}: the analysis produced nothing to check`);
  }
  return files;
}

/**
 * result から rule を引く。実測した CodeQL の出力では `tool.driver.rules` は空で、
 * rule は `tool.extensions[toolComponent.index].rules[rule.index]` にある。
 * id による探索も併用し、どちらでも引けなければ**分類不能として失敗**させる
 * (分類できないことは「重大ではない」ではない)。
 */
function resolveRule(run, result) {
  const extensions = Array.isArray(run.tool?.extensions) ? run.tool.extensions : [];
  const driverRules = Array.isArray(run.tool?.driver?.rules) ? run.tool.driver.rules : [];

  const componentIndex = result.rule?.toolComponent?.index;
  const ruleIndex = result.rule?.index;
  if (Number.isInteger(ruleIndex)) {
    const rules = Number.isInteger(componentIndex) ? extensions[componentIndex]?.rules : driverRules;
    const byIndex = Array.isArray(rules) ? rules[ruleIndex] : undefined;
    if (byIndex) return byIndex;
  }

  const wantedId = result.ruleId ?? result.rule?.id;
  if (wantedId) {
    for (const rules of [driverRules, ...extensions.map((ext) => ext.rules)]) {
      const byId = Array.isArray(rules) ? rules.find((rule) => rule?.id === wantedId) : undefined;
      if (byId) return byId;
    }
  }
  return undefined;
}

function locationOf(result) {
  const physical = result.locations?.[0]?.physicalLocation;
  const uri = physical?.artifactLocation?.uri;
  const line = physical?.region?.startLine;
  if (!uri) return "(no location)";
  return line ? `${uri}:${line}` : uri;
}

function checkRun(file, run, runIndex) {
  const where = `${file} runs[${runIndex}]`;

  const driverName = run.tool?.driver?.name;
  if (typeof driverName !== "string" || driverName.trim() === "") {
    problems.push(`${where}: tool.driver.name is missing; this is not a recognisable analyzer output`);
  }

  // 「解析が成功した」ことを SARIF 自身に主張させる。ここが false / 欠落なら、
  // results が空でもそれは「検出なし」ではない。
  const invocations = run.invocations;
  if (!Array.isArray(invocations) || invocations.length === 0) {
    problems.push(`${where}: no invocations recorded; cannot tell whether the analysis ran`);
  } else if (!invocations.every((invocation) => invocation?.executionSuccessful === true)) {
    problems.push(`${where}: an invocation reported executionSuccessful !== true`);
  }

  // rule カタログが空なら、クエリが 1 本も走っていない = 観測点が死んでいる。
  const ruleCount =
    (Array.isArray(run.tool?.driver?.rules) ? run.tool.driver.rules.length : 0) +
    (Array.isArray(run.tool?.extensions) ? run.tool.extensions : []).reduce(
      (total, ext) => total + (Array.isArray(ext?.rules) ? ext.rules.length : 0),
      0,
    );
  if (ruleCount === 0) {
    problems.push(`${where}: the run carries no rule metadata; no queries appear to have run`);
  }

  // results キーの不在は 0 件ではない。SARIF 上は省略可能だが、省略された出力を
  // 「検出なし」と読むと、形の違う出力が黙って合格になる。
  if (!Array.isArray(run.results)) {
    problems.push(`${where}: results is not an array (absent results is not zero results)`);
    return;
  }

  for (const result of run.results) {
    const rule = resolveRule(run, result);
    const at = `${locationOf(result)} [${result.ruleId ?? result.rule?.id ?? "(no ruleId)"}]`;
    if (!rule) {
      problems.push(`${where}: cannot resolve the rule for a result at ${at}; severity is unclassifiable`);
      continue;
    }

    const raw = rule.properties?.["security-severity"];
    const level = result.level ?? rule.defaultConfiguration?.level ?? "warning";
    if (raw !== undefined && !Number.isFinite(Number(raw))) {
      problems.push(`${where}: security-severity of ${at} is not a number; severity is unclassifiable`);
      continue;
    }

    const score = raw === undefined ? undefined : Number(raw);
    if (score !== undefined && score >= FAILING_SECURITY_SEVERITY) {
      failingResults.push(`${at} security-severity=${score} (${severityLabel(score)})`);
    } else if (FAILING_LEVELS.has(level)) {
      failingResults.push(`${at} level=${level}`);
    } else {
      acceptedResults += 1;
    }
  }
}

function main() {
  const dir = process.argv[2] ?? "sarif-results";
  const files = listSarifFiles(dir);

  for (const file of files) {
    let sarif;
    try {
      sarif = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch (error) {
      problems.push(`${file}: not parseable as JSON (${error.message})`);
      continue;
    }
    if (!Array.isArray(sarif.runs) || sarif.runs.length === 0) {
      problems.push(`${file}: runs is missing or empty; there is no analysis to evaluate`);
      continue;
    }
    sarif.runs.forEach((run, index) => checkRun(file, run, index));
  }

  // 検出内容は ruleId と位置だけを出す。SARIF の message はソース断片を含み得るため、
  // CI ログへ本文を流さない。
  for (const failing of failingResults) {
    console.error(`[codeql-sarif][finding] ${failing}`);
  }
  for (const problem of problems) {
    console.error(`[codeql-sarif][error] ${problem}`);
  }

  if (problems.length > 0 || failingResults.length > 0) {
    console.error(
      `[codeql-sarif] FAIL: ${failingResults.length} finding(s) at or above security-severity ` +
        `${FAILING_SECURITY_SEVERITY}/level error, ${problems.length} structural problem(s)`,
    );
    process.exit(1);
  }

  console.log(
    `[codeql-sarif] OK (${files.length} sarif file(s), no finding at or above security-severity ` +
      `${FAILING_SECURITY_SEVERITY}; ${acceptedResults} lower-severity result(s) recorded)`,
  );
}

main();
