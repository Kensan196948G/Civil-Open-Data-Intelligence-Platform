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
 *
 * ## 抑制チャネル (`result.suppressions`)
 *
 * SARIF は検出ごとに抑制を持てる。ゲートがこの欄を読まないと、抑制は**塞がれた**のではなく
 * **見えない場所へ移る**: 抑制した本人以外、何が免除されたのかを CI から知る手段が無くなる。
 * ここでは抑制を消すのではなく、**通れる形を 1 本だけ用意して、通ったものを必ず表に出す**。
 *
 * - 受理するのは `kind: "external"` かつ理由 (`justification`) が非空のものだけ。
 *   `inSource` (ソース中のコメントによる抑制) は受理しない。コード上の 1 行で検出を消せる
 *   経路は、レビューを経ない受容になるため
 * - 受理した検出は finding として落とさない。ただし**件数・ruleId・位置を常に出力する**
 *   (抑制ゼロでも `0 accepted suppression(s)` を出す。出力が無いことと 0 件は区別できない)
 * - 落とすのは、理由が空 / 形が不正 / 受理件数が予算 (`MAX_ACCEPTED_SUPPRESSIONS`) 超過
 *
 * 「受理」と「予算」は別の検査である。受理は finding チャネルから外す操作であり、予算は
 * その総数の上限。ゲートは理由の**中身**を判定しない (できない)。中身の要件 —
 * 受容者・受容日・owner・期限・受容したリスク — は ADR 0003 の受容記録に置き、
 * PR レビューで確認する。同じ 5 項目が、個別抑制・予算引き上げ・ゲート自体の
 * 非必須化のいずれにも適用される (ADR 0003「受容記録」)。
 */

const fs = require("node:fs");
const path = require("node:path");

// GitHub の security-severity 換算: 9.0+ critical / 7.0-8.9 high / 4.0-6.9 medium。
// 品質ゲートが critical + high をゼロと要求するので、閾値は high の下限に置く。
const FAILING_SECURITY_SEVERITY = 7.0;
// SARIF の security-severity は 0-10 の範囲で定義される。範囲外は、換算表のどの等級にも
// 対応しないので分類できない。
const MIN_SECURITY_SEVERITY = 0;
const MAX_SECURITY_SEVERITY = 10;
// security-severity を持たない (= セキュリティ系でない) rule でも、CodeQL が既定で
// error 相当と判定するものは落とす。
const FAILING_LEVELS = new Set(["error"]);
// CodeQL が出しうる level はこの3語だけ (クエリの `@problem.severity`
// error / warning / recommendation がそのまま error / warning / note へ写る)。
// SARIF 2.1.0 の enum には "none" もあるが CodeQL は出さないので、受理語彙を
// 産出器が実際に使う語より広げない。知らない語は「重大度の表明が読めない」
// ことを意味するので、既定へ落とさず構造異常として記録する。
const ACCEPTED_LEVELS = new Set(["note", "warning", "error"]);
// level が **本当に** 不在のときだけ使う既定値。SARIF 上 level は省略可能で、
// 実測 (run 31555165656 / artifact 9125778552) では 6/6 の result が level を
// 持たず、rule 87 件中 2 件は defaultConfiguration.level も持たない。つまり
// この経路は実データで常時通る。既定を廃して不在を構造異常にすると本物が落ちる。
const DEFAULT_LEVEL = "warning";

// レビューを経た受容だけを通す。ソース中のコメント (`inSource`) は 1 行で検出を消せるため
// 受理しない。SARIF 2.1.0 の kind は "inSource" / "external" の 2 値。
const ACCEPTED_SUPPRESSION_KIND = "external";
// SARIF の suppression.status。"accepted" 以外 (underReview / rejected) は、抑制が
// 効いていない状態を表すので受理しない。
const ACCEPTED_SUPPRESSION_STATUS = "accepted";
// 受理してよい抑制の総数。**現在 0**: 本ゲートに対する受容を、まだ誰も決めていない。
// 引き上げは保護規則の緩和と同じ性質の変更であり、ADR 0003 の受容記録
// (受容者・受容日・owner・期限・受容したリスク) を伴うレビュー済みの変更として行う。
// 環境変数や CLI 引数で上書きできるようにはしない。上書き手段があると、この定数が
// 取り除いたはずの自由 (誰でも黙って免除できる) がそのまま戻る。
const MAX_ACCEPTED_SUPPRESSIONS = 0;

const problems = [];
const failingResults = [];
const acceptedSuppressions = [];
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

/**
 * result の抑制欄を判定する。返り値は "none" (抑制されていない) / "accepted" (受理) /
 * "rejected" (受理できない形。理由は problems へ積む)。
 *
 * 受理は**全エントリが要件を満たしたとき**だけ。1 件でも不正な抑制が混ざっていれば
 * 受理しない。混在を部分的に受理すると、不正な 1 件を正当な 1 件で隠せる。
 */
function evaluateSuppressions(where, at, result) {
  const suppressions = result.suppressions;
  if (suppressions === undefined || suppressions === null) return "none";
  if (!Array.isArray(suppressions)) {
    problems.push(`${where}: suppressions of ${at} is not an array; the suppression cannot be evaluated`);
    return "rejected";
  }
  // 空配列は「抑制されていない」。SARIF 上も抑制の主張ではない。
  if (suppressions.length === 0) return "none";

  let ok = true;
  for (const suppression of suppressions) {
    if (typeof suppression !== "object" || suppression === null || Array.isArray(suppression)) {
      problems.push(`${where}: a suppression of ${at} is not an object; the suppression cannot be evaluated`);
      ok = false;
      continue;
    }

    const kind = suppression.kind;
    if (kind !== ACCEPTED_SUPPRESSION_KIND) {
      problems.push(
        `${where}: suppression of ${at} has kind=${JSON.stringify(kind) ?? "(absent)"}; ` +
          `only kind="${ACCEPTED_SUPPRESSION_KIND}" is a sanctioned channel`,
      );
      ok = false;
      continue;
    }

    const status = suppression.status;
    if (status !== undefined && status !== ACCEPTED_SUPPRESSION_STATUS) {
      problems.push(
        `${where}: suppression of ${at} has status=${JSON.stringify(status)}; ` +
          `only "${ACCEPTED_SUPPRESSION_STATUS}" is in force`,
      );
      ok = false;
      continue;
    }

    // 理由の**存在**だけを検査する。中身の要件は ADR 0003 の受容記録が定め、
    // PR レビューが確認する。ここで文面を機械判定しようとすると、書式に縛られた
    // 割に中身は保証できない検査になる。
    const justification = suppression.justification;
    if (typeof justification !== "string" || justification.trim() === "") {
      problems.push(
        `${where}: suppression of ${at} carries no justification; ` +
          `an unexplained suppression is not a record of anything`,
      );
      ok = false;
    }
  }

  if (!ok) return "rejected";
  // 理由の本文は出力しない。ここへ流すと、レビューされていない自由文が CI ログの
  // 記録になる (SARIF の message を出さないのと同じ理由)。件数・ruleId・位置は出す。
  acceptedSuppressions.push(at);
  return "accepted";
}

function describeValue(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return "an array";
  if (typeof value === "object") return "an object";
  return `a ${typeof value}`;
}

// `security-severity` は「無い」か「0-10 の数値として読める」かのどちらかでなければならない。
// 明示されているのに読めない値は、**severity 0 として合格させてはならない** —
// `Number("")` / `Number(null)` / `Number(false)` はいずれも 0 になるため、素朴な
// `Number.isFinite(Number(raw))` は空値を「重大度なし」と同じ扱いにしてしまう。
// これは抑制チャネルと同じ形の穴で、不正な入力が拒否ではなく沈黙を生む。
function evaluateSecuritySeverity(where, at, raw) {
  if (raw === undefined) return { score: undefined };

  if (typeof raw !== "string" && typeof raw !== "number") {
    problems.push(
      `${where}: security-severity of ${at} is ${describeValue(raw)}, not a string or number; ` +
        `severity is unclassifiable`,
    );
    return { rejected: true };
  }
  if (typeof raw === "string" && raw.trim() === "") {
    problems.push(
      `${where}: security-severity of ${at} is present but empty; ` +
        `an empty value is not the same as severity 0`,
    );
    return { rejected: true };
  }

  const score = Number(raw);
  if (!Number.isFinite(score)) {
    problems.push(`${where}: security-severity of ${at} is not a number; severity is unclassifiable`);
    return { rejected: true };
  }
  if (score < MIN_SECURITY_SEVERITY || score > MAX_SECURITY_SEVERITY) {
    problems.push(
      `${where}: security-severity of ${at} is ${score}, outside the defined range ` +
        `${MIN_SECURITY_SEVERITY}-${MAX_SECURITY_SEVERITY}; severity is unclassifiable`,
    );
    return { rejected: true };
  }
  return { score };
}

// `level` は「無い」か「受理語彙のいずれか」かのどちらかでなければならない。
//
// 初版は `result.level ?? rule.defaultConfiguration?.level ?? "warning"` だった。
// `??` は **明示された null** と **不在** を区別できないため、次の3つが1点へ潰れる:
// 産出器が null と言った / フィールドが無い / `"fatall"` と書き間違えた。いずれも
// warning になり、level を根拠にした失敗判定 (FAILING_LEVELS) が黙って消える。
// security-severity 側は同じ判定のもう一方の入口を厳格に見ているのに、level 側だけ
// 素通りしていた。**同じ判定の2つの入口で強度が違うこと自体が欠陥**である。
//
// 探索順は SARIF の優先順 (result 自身 → rule の既定) に従う。先に見つかった側が
// 実効値であり、そこが読めなければ後段へ落とさない — 落とすと「読めない値」が
// 「不在」として既定へ流れ、いま塞いだ穴がそのまま開く。
function evaluateLevel(where, at, result, rule) {
  const sources = [
    ["result", result],
    ["rule defaultConfiguration", rule.defaultConfiguration],
  ];

  for (const [source, holder] of sources) {
    if (holder === null || typeof holder !== "object") continue;
    if (!Object.prototype.hasOwnProperty.call(holder, "level")) continue;

    const raw = holder.level;
    if (typeof raw !== "string") {
      problems.push(
        `${where}: ${source} level of ${at} is ${describeValue(raw)}, not a string; ` +
          `an explicitly stated level is not the same as an absent one`,
      );
      return { rejected: true };
    }
    if (!ACCEPTED_LEVELS.has(raw)) {
      problems.push(
        `${where}: ${source} level of ${at} is ${JSON.stringify(raw)}, outside the accepted ` +
          `vocabulary ${[...ACCEPTED_LEVELS].join("/")}; severity is unclassifiable`,
      );
      return { rejected: true };
    }
    return { level: raw };
  }

  return { level: DEFAULT_LEVEL };
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

    // 抑制の判定は severity 分類より先。受理された検出は finding として数えないが、
    // 受理できない形の抑制はここで problems になり、severity に関係なく落ちる。
    const suppression = evaluateSuppressions(where, at, result);
    if (suppression !== "none") continue;

    const levelOutcome = evaluateLevel(where, at, result, rule);
    if (levelOutcome.rejected) continue;
    const level = levelOutcome.level;

    const severity = evaluateSecuritySeverity(where, at, rule.properties?.["security-severity"]);
    if (severity.rejected) continue;

    const score = severity.score;
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

  // 受理した抑制は、合格・不合格のどちらでも必ず出す。免除の記録が出力に現れない構成は、
  // 抑制を塞いだのではなく見えない場所へ移しただけになる。0 件でも 0 件と書く。
  for (const suppressed of acceptedSuppressions) {
    console.log(`[codeql-sarif][suppressed] ${suppressed}`);
  }
  console.log(
    `[codeql-sarif] ${acceptedSuppressions.length} accepted suppression(s) ` +
      `(budget ${MAX_ACCEPTED_SUPPRESSIONS})`,
  );
  if (acceptedSuppressions.length > MAX_ACCEPTED_SUPPRESSIONS) {
    problems.push(
      `${acceptedSuppressions.length} accepted suppression(s) exceed the sanctioned budget of ` +
        `${MAX_ACCEPTED_SUPPRESSIONS}; raising it requires an acceptance record in ADR 0003`,
    );
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

if (require.main === module) {
  main();
}

module.exports = {
  MAX_ACCEPTED_SUPPRESSIONS,
  ACCEPTED_SUPPRESSION_KIND,
  MIN_SECURITY_SEVERITY,
  MAX_SECURITY_SEVERITY,
  ACCEPTED_LEVELS,
  DEFAULT_LEVEL,
  FAILING_LEVELS,
};
