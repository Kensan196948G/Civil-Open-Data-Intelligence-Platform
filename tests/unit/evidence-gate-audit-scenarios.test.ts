import { spawnSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { resolveEvidenceEnv } from "../../scripts/deploy/deploy-production.mjs";
import {
  ACCEPTED_SCRIPT_SRC,
  PINNED_DIRECTIVES,
  PRODUCTION_SCRIPT_SRC_VARIANT,
} from "../../scripts/tools/csp-contract.js";
import {
  EVIDENCE_FORMATS,
  evidenceFormatState,
  evidenceState,
} from "../../scripts/tools/production-evidence-report.js";
import { requireCspContract } from "../../scripts/tools/release-smoke.js";

/**
 * 監査文書が主張する「偽陰性シナリオ」を、実コードに対して**実行して**突き合わせる
 * (裁定2 / docs/security/evidence-gate-audit.md §2.5)。
 *
 * なぜ必要か:
 *   隣の tests/unit/evidence-gate-audit-contract.test.ts (QA 所有) は、#7 の緩さを
 *   「evidenceState の本体に fetch / spawnSync が現れるか」という**代理指標**で
 *   見ている。Issue #128 は外部呼び出しを増やさず形式検査を足す是正だったため、
 *   代理指標は 1mm も動かないまま文書の主張だけが偽になった。代理指標は
 *   「是正の形」を先読みしている点で必ずいつか外れる。
 *
 *   本ファイルは代理を置かない。文書が「こうすれば通ってしまう」と書いた操作を
 *   そのまま実行し、通ってしまうかどうかを見る。是正が入れば結果が変わり、
 *   文書側の 🔓/🔒 と食い違って落ちる。是正の実装方法には依存しない。
 *
 * 責務の境界:
 *   - 各ゲートの正しさそのもの: 各 Issue のテスト (production-evidence-report.test.ts,
 *     release-smoke-csp.test.ts, deploy-production-evidence.test.ts)
 *   - 本ファイル: **監査記録がその正しさを自己申告していないこと**。
 *     文書の主張とコードの実際の挙動が一致しているかだけを見る。
 */

const REPO_ROOT = path.resolve(__dirname, "../..");
const AUDIT_PATH = "docs/security/evidence-gate-audit.md";
const SCENARIOS_TEST_PATH = "tests/unit/evidence-gate-audit-scenarios.test.ts";
const CONTRACT_TEST_PATH = "tests/unit/evidence-gate-audit-contract.test.ts";
const REPORT_SCRIPT_PATH = "scripts/tools/production-evidence-report.js";
const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
const SMOKE_SCRIPT_PATH = "scripts/tools/release-smoke.js";
const CREATE_EVIDENCE_SCRIPT_PATH = "scripts/tools/create-neon-backup-evidence.js";
const CHECK_EVIDENCE_SCRIPT_PATH = "scripts/tools/check-neon-backup-evidence.js";
const BACKUP_WORKFLOW_PATH = ".github/workflows/neon-backup.yml";
const DEP_AUDIT_SCRIPT_PATH = "scripts/tools/check-dependency-audit.js";
const POST_RELEASE_SCRIPT_PATH = "scripts/tools/post-release-status.js";
// 読むだけ (本セッションの編集対象外)。文書がこのファイルの行を引用しているので、
// 引用先として読み込む。編集はしない。
const MONITORING_CONTRACT_TEST_PATH = "tests/unit/monitoring-runbook-contract.test.ts";
const EVIDENCE_JOB = "production-target-env";

const auditDoc = readFileSync(path.join(REPO_ROOT, AUDIT_PATH), "utf8");
const reportSource = readFileSync(path.join(REPO_ROOT, REPORT_SCRIPT_PATH), "utf8");
const ciWorkflow = readFileSync(path.join(REPO_ROOT, CI_WORKFLOW_PATH), "utf8");
const smokeSource = readFileSync(path.join(REPO_ROOT, SMOKE_SCRIPT_PATH), "utf8");
const createEvidenceSource = readFileSync(path.join(REPO_ROOT, CREATE_EVIDENCE_SCRIPT_PATH), "utf8");
const checkEvidenceSource = readFileSync(path.join(REPO_ROOT, CHECK_EVIDENCE_SCRIPT_PATH), "utf8");
const backupWorkflow = readFileSync(path.join(REPO_ROOT, BACKUP_WORKFLOW_PATH), "utf8");
const depAuditSource = readFileSync(path.join(REPO_ROOT, DEP_AUDIT_SCRIPT_PATH), "utf8");
const postReleaseSource = readFileSync(path.join(REPO_ROOT, POST_RELEASE_SCRIPT_PATH), "utf8");
const monitoringContractSource = readFileSync(
  path.join(REPO_ROOT, MONITORING_CONTRACT_TEST_PATH),
  "utf8",
);

/** 判定に日付が絡む形式 (ISO 8601 の未来日チェックなど) があるため固定する。 */
const NOW = new Date("2026-08-12T00:00:00Z");

/**
 * #128 以前の判定 = `evidenceState()`。named export をそのまま呼ぶ。
 *
 * 「legacy」は死んだコードという意味ではない。`evidenceState` は今も
 * `evidenceFormatState` の第1段 (presence) として生きており、#128 が足したのは
 * その後段の形式検査である。つまりここで観測しているのは、**形式検査を外したら
 * 何が通るか**であって、掘り起こした過去の実装ではない。
 *
 * 以前はこの probe を「`EVIDENCE_FORMATS` に spec の無い鍵を `evidenceFormatState`
 * へ渡すと presence 判定がそのまま返る」という素通りを使って作っていた。
 * 欠陥を観測装置に流用していたので、その素通りを塞ぐ是正が probe を壊す関係にあった。
 * named export にしたことで、probe は是正の対象から独立した。
 */
function legacyEvidenceState(value: string | undefined): string {
  return evidenceState(value);
}

function acceptsAsEvidence(state: string): boolean {
  return state.startsWith("✅");
}

/**
 * §2.2 #7 が名指しする 7 変数。ci.yml の `production-target-env` job が
 * `${{ vars.* }}` で渡す監視証跡の側。行番号は書かない — 実測すると以前ここにあった
 * `ci.yml:177-183` は認証系 7 行を指しており、監視証跡は隣の 7 行だった。
 * 同一集合であることは下の D で ci.yml を解析して測る。
 */
const MONITORING_EVIDENCE_KEYS = [
  "CODIP_CLOUDFLARE_ACCESS_EVIDENCE",
  "CODIP_MONITORING_CONTACTS",
  "CODIP_CLOUDFLARE_ALERT_POLICY",
  "CODIP_CLOUDFLARE_LOGS_EVIDENCE",
  "CODIP_NEON_MONITORING_EVIDENCE",
  "CODIP_SMOKE_MONITORING_SCHEDULE",
  "CODIP_ROLLBACK_OWNER",
] as const;

/** §2.2 #7 の 7 変数と対になる、バックアップ/復元の 1 変数。 */
const BACKUP_RESTORE_EVIDENCE_KEYS = ["CODIP_BACKUP_RESTORE_EVIDENCE"] as const;

/** 証跡変数の全体。分類の単位はレポート表の区切りに合わせている。 */
const ALL_EVIDENCE_KEYS: readonly string[] = [
  ...MONITORING_EVIDENCE_KEYS,
  ...BACKUP_RESTORE_EVIDENCE_KEYS,
];

/** 文書が偽陰性の実例として挙げている 2 文字。 */
const TWO_CHAR_EVIDENCE = "ok";

/**
 * probe のケース表。軸は **入力空間**であって「妥当な値の集合」ではない。
 *
 * 妥当な値から生成すると、語彙外の入力 — 空白のみ、`undefined`、一見まともだが
 * placeholder 正規表現に当たる文字列 — が定義上ケース表に現れなくなる。
 * T-B18・B19・B22 はいずれも「検査対象を期待値の側から導出したせいで、期待の外に
 * あるものが構造的に見えなくなった」事例だった。ここでは `evidenceState` が
 * 分岐している 3 経路 (trim 後が空 / placeholder 一致 / それ以外) を軸に取り、
 * 各経路へ**期待の外から**入力を置く。
 *
 * `ci-2026-08-12` は「日付入りの、人間には妥当に見える値」だが
 * `PLACEHOLDER_PATTERNS` の `/ci[-_]/i` に当たって弾かれる。
 * 妥当な値の集合からは決して出てこない種類のケースであり、この表の軸が
 * 入力空間であることの実例になっている。
 */
const LEGACY_PROBE_CASES: ReadonlyArray<{
  label: string;
  value: string | undefined;
  state: string;
  accepted: boolean;
}> = [
  { label: "undefined (変数が存在しない)", value: undefined, state: "⚠️ unset", accepted: false },
  { label: "空文字", value: "", state: "⚠️ unset", accepted: false },
  { label: "空白と改行のみ", value: "  \t\n ", state: "⚠️ unset", accepted: false },
  {
    label: "placeholder 語をそのまま含む",
    value: "REPLACE_ME",
    state: "⚠️ placeholder-like",
    accepted: false,
  },
  {
    label: "日付入りで一見まともだが ci- 接頭辞に当たる",
    value: "ci-2026-08-12",
    state: "⚠️ placeholder-like",
    accepted: false,
  },
  {
    label: "文書が偽陰性の実例に挙げる 2 文字",
    value: TWO_CHAR_EVIDENCE,
    state: "✅ set (recorded)",
    accepted: true,
  },
  {
    label: "長いだけで意味の無い値",
    value: "--------------------------------",
    state: "✅ set (recorded)",
    accepted: true,
  },
  {
    label: "実際に証跡として妥当な値",
    value: "2026-08-11 / platform-ops / drill #4",
    state: "✅ set (recorded)",
    accepted: true,
  },
];

/**
 * `evidenceState` の本体から、返しうる文字列リテラルを**実装から**取り出す。
 *
 * これが無いと、ケース表は「3 経路を踏んでいるつもり」を自己申告するだけになる。
 * `evidenceState` に 4 つめの分岐が増えたとき、表を更新し忘れたことに気づく術が
 * ケース表自身の中には無い。取れなければ throw する (空集合は等しくなるため)。
 */
function evidenceStateOutcomes(source: string): string[] {
  const anchor = "function evidenceState(value) {";
  if (source.split(anchor).length - 1 !== 1) {
    throw new Error("evidenceState の定義が一意に見つからない");
  }
  const body = source.slice(source.indexOf(anchor) + anchor.length);
  const end = body.indexOf("\n}");
  if (end === -1) throw new Error("evidenceState の本体末尾が見つからない");
  const literals = [...body.slice(0, end).matchAll(/return "([^"]+)"/g)].map((m) => m[1]);
  if (literals.length === 0) throw new Error("evidenceState の返り値リテラルを抽出できなかった");
  return [...new Set(literals)];
}

// --- CSP: 期待値は契約モジュールから組み立てる (リテラルを二重に持たない) -----

function contractCompliantCsp(): string {
  const production = ACCEPTED_SCRIPT_SRC.find(
    (variant) => variant.label === PRODUCTION_SCRIPT_SRC_VARIANT,
  );
  if (!production) throw new Error("production 構成が ACCEPTED_SCRIPT_SRC に無い");

  const segments = Object.entries(PINNED_DIRECTIVES).map(
    ([directive, sources]) => `${directive} ${sources.join(" ")}`,
  );
  segments.push(`script-src ${production.sources.join(" ")}`);
  return segments.join("; ");
}

function withoutDirective(csp: string, directive: string): string {
  return csp
    .split("; ")
    .filter((segment) => segment.split(/\s+/)[0] !== directive)
    .join("; ");
}

type SmokeCheck = { name: string; ok: boolean; detail: string };

function smokeAcceptsCsp(csp: string): boolean {
  const checks: SmokeCheck[] = [];
  requireCspContract(checks, new Headers({ "content-security-policy": csp }));
  return checks.length > 0 && checks.every((check) => check.ok);
}

/**
 * Issue #129 以前の release-smoke.js の判定を逐語で保存したもの (仕様ではない)。
 *
 * needle を配列へ出してあるのは CodeQL `js/incomplete-url-substring-sanitization`
 * (7.8 / Issue #142) 対応。理由と、厳密比較へ書き換えられない根拠、抑制コメントが
 * 効かない根拠は tests/unit/release-smoke-csp.test.ts の同名関数のコメントに書いた。
 * 値・並び・論理は旧実装と同一で、振る舞いは変えていない。
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

// --- #22: 監査契約ゲートを「実装だけ改変した木」に対して実行する ---------------

const AUDIT_GATE_PATH = "scripts/tools/check-audit-contract.js";
const AUDIT_ROUTE_PATH = "src/app/api/admin/audit-events/route.ts";
/** ゲートが cwd 起点で読むパス。src だけは実体を混ぜるので個別に組み立てる。 */
const AUDIT_GATE_LINKED_ENTRIES = ["docs", "scripts", "package.json"];
const AUDIT_GATE_LINKED_LIB = ["src/lib/audit.ts", "src/lib/audit-events-client.ts"];

const auditRouteSource = readFileSync(path.join(REPO_ROOT, AUDIT_ROUTE_PATH), "utf8");

/**
 * `check-audit-contract.js` を、`route.ts` だけ差し替えた砂場で**そのまま実行**する。
 *
 * ゲートの needle 一覧をテストへ写経しない。写経した瞬間それは代理指標になり、
 * ゲート側に本物の振る舞い検査が入っても更新されず緑のまま嘘になる (§2.5 の主旨)。
 * ゲートは `process.cwd()` 起点で読むので、cwd を差し替えるだけで実体を偽装できる。
 */
function auditContractGatePasses(routeSource: string): boolean {
  const sandbox = mkdtempSync(path.join(os.tmpdir(), "codip-audit-gate-"));
  try {
    for (const entry of AUDIT_GATE_LINKED_ENTRIES) {
      symlinkSync(path.join(REPO_ROOT, entry), path.join(sandbox, entry));
    }
    for (const file of AUDIT_GATE_LINKED_LIB) {
      mkdirSync(path.join(sandbox, path.dirname(file)), { recursive: true });
      symlinkSync(path.join(REPO_ROOT, file), path.join(sandbox, file));
    }
    mkdirSync(path.join(sandbox, path.dirname(AUDIT_ROUTE_PATH)), { recursive: true });
    writeFileSync(path.join(sandbox, AUDIT_ROUTE_PATH), routeSource);

    const result = spawnSync(process.execPath, [path.join(REPO_ROOT, AUDIT_GATE_PATH)], {
      cwd: sandbox,
      encoding: "utf8",
    });
    if (result.error) throw result.error;
    return result.status === 0;
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
}

/**
 * ADR 0002 の「監査INSERT失敗時は 503」を実装側で否定する改変。
 * 応答本体の `audit_record_failed` はそのまま残るため、文字列照合しか
 * していないゲートには見えない。
 */
function auditRouteWithoutFailureStatus(): string {
  const mutated = auditRouteSource.replace("{ status: 503 }", "{ status: 200 }");
  if (mutated === auditRouteSource) {
    throw new Error(
      `${AUDIT_ROUTE_PATH} に "{ status: 503 }" が無い。S22 の改変が実体からずれている`,
    );
  }
  return mutated;
}

/**
 * `.github/workflows/codeql.yml` から単一ジョブの本文を切り出す。
 *
 * YAML パーサを使わないのは、`js-yaml` が本リポジトリの直接依存ではないためである
 * （推移的に入っているだけの依存をテストが直接 import すると、無関係な依存整理で
 * 静かに壊れる）。ジョブ境界は「2 スペースインデントのキー行」で決まり、
 * この判定に構文解析は要らない。
 */
const codeqlWorkflow = readFileSync(path.join(REPO_ROOT, ".github/workflows/codeql.yml"), "utf8");

function jobBlock(source: string, jobName: string): string {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line === `  ${jobName}:`);
  if (start === -1) throw new Error(`job ${jobName} not found`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {2}[A-Za-z0-9_-]+:/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

// --- シナリオ登録簿 ---------------------------------------------------------

/**
 * `run()` は「**偽陰性が今も再現するか**」を返す。true = 通ってしまう。
 * 文書側の 🔓 再現する / 🔒 解消済み と突き合わせる。
 */
type Scenario =
  | { kind: "executed"; run: () => boolean }
  | { kind: "declared" };

const SCENARIOS: Record<string, Scenario> = {
  // #7: 7 変数のいずれか 1 つでも 2 文字を証跡として受理すれば再現とみなす。
  // 文書の文言は「7項目すべてが ✅」だが、1 つ通れば欠陥は残っている。
  S7: {
    kind: "executed",
    run: () =>
      MONITORING_EVIDENCE_KEYS.some((key) =>
        acceptsAsEvidence(evidenceFormatState(key, TWO_CHAR_EVIDENCE, NOW)),
      ),
  },
  S8: {
    kind: "executed",
    run: () =>
      acceptsAsEvidence(
        evidenceFormatState("CODIP_BACKUP_RESTORE_EVIDENCE", TWO_CHAR_EVIDENCE, NOW),
      ),
  },
  // #9 / #10 / #11: validate-production-target-env.js は module.exports を持たず
  // 読み込み時に main() が走る。子プロセスでの再現には production 相当の env 一式
  // (proxy secret を含む) が要り、テストへ秘密相当の値を置くことになるため実行しない。
  S9: { kind: "declared" },
  S10: { kind: "declared" },
  S11: { kind: "declared" },
  // #16: 本番スモークの CSP 判定。供給元 (fetch) は実測だが、判定が部分文字列
  // 照合だったため緩和を素通りさせていた (§1.1 の「検査対象のズレ」の一種)。
  S16: {
    kind: "executed",
    run: () => smokeAcceptsCsp(withoutDirective(contractCompliantCsp(), "connect-src")),
  },
  // #22: check-audit-contract.js は ADR 0002 の「監査INSERT失敗時は 503」を、
  // src/lib/audit-events-client.ts の**コメント文字列の存在**だけで検査する
  // (check-audit-contract.js:55)。応答コードを 503 から 200 へ落としても
  // ゲートは緑のまま通る (Issue #134)。
  S22: {
    kind: "executed",
    run: () => auditContractGatePasses(auditRouteWithoutFailureStatus()),
  },
  // 採番外: deploy スクリプト自身が証跡値を供給していた経路 (T-B7)。
  SB7: {
    kind: "executed",
    run: () => {
      try {
        resolveEvidenceEnv({});
        return true;
      } catch {
        return false;
      }
    },
  },
  // SB12: SB7 のゲートが main() から呼ばれていることは
  // deploy-production-evidence.test.ts が実行して測る。ここで宣言に留めるのは、
  // その実測が届かない残余 (観測点が fetch / spawnSync の2経路だけであること) の方で、
  // 「観測点を持たない副作用より前である」ことを実行で示す手段が今は無いためである。
  // 本ファイルへ結線検査を移すこともできない: 子プロセス砂場 (SB7 / S22) が実体の
  // spawnSync を使うため、同一ファイルで node:child_process を差し替えられない。
  SB12: { kind: "declared" },
  // SB139: CodeQL の security scan。検出内容を判定するゲート自体は
  // codeql-sarif-gate.test.ts が実測しており、そこは 🔒 になった。
  // ここで測る残余は「**必須チェック analyze の緑 = high 脆弱性ゼロ**」という
  // 読み方の偽陰性である。判定は非必須の codeql-findings へ分離してあるため、
  // analyze は high を抱えたまま緑になれる。リポジトリ内で観測できる形に落とすと
  // 「analyze ジョブのどの step も SARIF の検出内容を判定していない」になる。
  //
  // 必須化 (§17 の保護規則変更) の際に判定を analyze 側へ寄せれば、この run() は
  // false へ反転し、文書が 🔓 のままなら落ちる。分離という判断が黙って恒久化しない。
  SB139: {
    kind: "executed",
    run: () => !jobBlock(codeqlWorkflow, "analyze").includes("check-codeql-sarif.js"),
  },
  // #1 / #3 は T-B4 (Issue #126 / #127) の是正で、当時この仕組みが無かった。
  // 実行検査には Neon control-plane API と pg_dump artifact の実体が要る。
  S1: { kind: "declared" },
  S3: { kind: "declared" },
};

// --- 文書側の表を読む -------------------------------------------------------

type ScenarioRow = {
  id: string;
  claim: string;
  method: string;
  status: string;
  evidence: string;
};

function tableCells(line: string): string[] {
  return line
    .split("|")
    .slice(1, -1)
    .map((cell) => cell.trim());
}

const scenarioRows: ScenarioRow[] = auditDoc
  .split("\n")
  .filter((line) => line.trimStart().startsWith("|"))
  .map(tableCells)
  .filter((cells) => cells.length >= 5 && /^S[A-Z]?\d+$/.test(cells[0]))
  .map((cells) => ({
    id: cells[0],
    claim: cells[1],
    method: cells[2],
    status: cells[3],
    evidence: cells[4],
  }));

/** §2 のゲート行 (QA 所有の契約テストと同じ識別条件を使う)。 */
const gateRows = auditDoc
  .split("\n")
  .filter((line) => line.trimStart().startsWith("|"))
  .map(tableCells)
  .filter((cells) => cells.length >= 6 && /^\d+$/.test(cells[0]))
  .map((cells) => ({ id: cells[0], remediation: cells[cells.length - 1] }));

const EXECUTED = "🔬";
const DECLARED = "📣";
const REPRODUCES = "🔓";
const RESOLVED = "🔒";

describe("監査文書の偽陰性シナリオを実コードで検算する (裁定2)", () => {
  it("§2.5 の表が読めている", () => {
    expect(scenarioRows.length).toBeGreaterThanOrEqual(7);
    expect(gateRows.length).toBeGreaterThanOrEqual(20);
  });

  // この probe が壊れたら S7 / S8 の「旧実装との差」の主張が根拠を失う。
  it.each(LEGACY_PROBE_CASES)(
    "前提の確認: #128 以前の判定 — $label",
    ({ value, state, accepted }) => {
      expect(legacyEvidenceState(value)).toBe(state);
      expect(acceptsAsEvidence(legacyEvidenceState(value))).toBe(accepted);
    },
  );

  it("前提の確認: ケース表は evidenceState の返り値経路をすべて踏んでいる", () => {
    // 表の網羅性を、表自身ではなく実装の側から測る。分岐が増えれば落ちる。
    const declared = evidenceStateOutcomes(reportSource).sort();
    const observed = [...new Set(LEGACY_PROBE_CASES.map((c) => legacyEvidenceState(c.value)))].sort();
    expect(observed).toEqual(declared);
  });

  it("前提の確認: #129 以前の判定は契約準拠 CSP を合格させていた", () => {
    // 旧実装が最初から落ちていたのなら S16 は「素通り」の証明にならない。
    expect(legacySubstringCheck(contractCompliantCsp())).toBe(true);
    expect(legacySubstringCheck(withoutDirective(contractCompliantCsp(), "connect-src"))).toBe(
      true,
    );
  });

  it("契約準拠の CSP は本番スモークを通る (S16 の対照)", () => {
    // これが false なら S16 の失敗は「緩和を検知した」ではなく「基準がずれた」。
    expect(smokeAcceptsCsp(contractCompliantCsp())).toBe(true);
  });

  it("未改変の砂場では監査契約ゲートが通る (S22 の対照)", () => {
    // これが false なら S22 の「通ってしまう」は偽陰性の証明ではなく、
    // 砂場の組み立て失敗 (symlink 漏れ・ゲートの読取対象の増加) である。
    expect(auditContractGatePasses(auditRouteSource)).toBe(true);
  });

  it("判定ゲート自体は存在し、別ジョブで走っている (SB139 の対照)", () => {
    // SB139 の run() は「analyze が検出内容を見ていない」を true とする。対照が無いと、
    // ゲートを丸ごと削除した世界でも同じ true になり、🔓 が「分離しているから」なのか
    // 「そもそも検査が無いから」なのか区別できない。
    expect(jobBlock(codeqlWorkflow, "codeql-findings")).toContain("check-codeql-sarif.js");
  });

  it("表の各行は登録簿に存在する", () => {
    for (const row of scenarioRows) {
      expect(Object.keys(SCENARIOS)).toContain(row.id);
    }
  });

  it("登録簿の各シナリオは表に記載されている", () => {
    const documented = scenarioRows.map((row) => row.id);
    for (const id of Object.keys(SCENARIOS)) {
      expect(documented).toContain(id);
    }
  });

  it("検証方法の記号が登録簿の種別と一致する", () => {
    for (const row of scenarioRows) {
      const scenario = SCENARIOS[row.id];
      const symbol = scenario.kind === "executed" ? EXECUTED : DECLARED;
      expect(`${row.id}: ${row.method}`).toContain(symbol);
    }
  });

  describe("🔬 実行検査", () => {
    const executed = Object.entries(SCENARIOS).filter(
      (entry): entry is [string, Extract<Scenario, { kind: "executed" }>] =>
        entry[1].kind === "executed",
    );

    it.each(executed)("%s: 文書の現況と実際の挙動が一致する", (id, scenario) => {
      const row = scenarioRows.find((candidate) => candidate.id === id);
      expect(row, `${id} が §2.5 に無い`).toBeDefined();

      const documentedAsReproducing = row!.status.includes(REPRODUCES);
      const documentedAsResolved = row!.status.includes(RESOLVED);
      // どちらか一方でなければ、文書が状態を述べていない。
      expect(documentedAsReproducing).toBe(!documentedAsResolved);

      // ここが本体。文書が何と書いていようと、実コードを動かした結果を採る。
      expect(
        scenario.run(),
        documentedAsResolved
          ? `${AUDIT_PATH} は ${id} を解消済みとしているが、偽陰性が今も再現する`
          : `${AUDIT_PATH} は ${id} を未解消としているが、既に再現しない。是正が入ったなら文書を更新すること`,
      ).toBe(documentedAsReproducing);
    });
  });

  describe("📣 宣言", () => {
    const declared = scenarioRows.filter((row) => SCENARIOS[row.id]?.kind === "declared");

    it("宣言行が存在する (実行検査だけを並べて完全性を装っていない)", () => {
      expect(declared.length).toBeGreaterThan(0);
    });

    it.each(declared.map((row) => [row.id, row] as const))(
      "%s: 実行検査していない理由が書かれている",
      (_id, row) => {
        // 「これは実測ではなく宣言である」と読み手に伝わることが要件。
        expect(row.evidence).toMatch(/^未実行:/);
        expect(row.evidence.replace(/^未実行:/, "").trim().length).toBeGreaterThan(10);
      },
    );
  });

  it("是正済みと書かれたゲートは必ず §2.5 に対応行を持つ", () => {
    // これが再発防止の本体。次に誰かが是正を入れて是正案セルへ「是正済み」と
    // 書いた瞬間、その主張を機械が検算できる形にすることを強制する。
    // 文言だけ直して監査記録の見た目を整える経路を塞ぐ。
    const remediated = gateRows
      .filter((row) => row.remediation.includes("是正済み"))
      .map((row) => `S${row.id}`);

    expect(remediated.length).toBeGreaterThan(0);
    for (const id of remediated) {
      expect(scenarioRows.map((row) => row.id)).toContain(id);
    }
  });

  it("文書は本ファイルと QA 所有テストの責務境界を説明している", () => {
    // 読み手が「何がどこまで機械検査されているか」を文書だけで判断できること。
    // 二つのテストが同じものを見ていると誤解されると、片方の弱点 (代理指標が
    // 是正の形を外す) が両方に無いものとして扱われる。
    expect(auditDoc).toContain(SCENARIOS_TEST_PATH);
    expect(auditDoc).toContain(CONTRACT_TEST_PATH);
    expect(auditDoc).toContain("代理指標");
  });
});

// --- 証跡変数の集合が 4 箇所で一致していること --------------------------------

/**
 * 証跡変数の一覧は、独立に 4 箇所へ書かれている。
 *
 *   A. `EVIDENCE_FORMATS` の鍵                            書式の仕様
 *   B. `MONITORING_ENV_KEYS` / `BACKUP_RESTORE_ENV_KEYS`  レポート表の行
 *   C. `evidenceOk("...")` の呼び出し                     readiness ゲートの行
 *   D. ci.yml `production-target-env` の `${{ vars.* }}`  値の供給元
 *
 * どれか 1 つに足して他を忘れたときの症状は「落ちる」ではなく「黙って緩む」。
 * とくに **B に足して A を忘れた鍵**は、かつて `evidenceFormatState` の
 * `if (!spec) return presence;` を通り、**非空でありさえすれば ✅ になった**。
 * 表には行が増え、ゲートは緑で、書式検査だけが存在しない。増えた行はむしろ
 * 「検査項目が増えた」ように読める。
 *
 * その素通りは同 PR の後続 commit で fail-close へ是正した
 * (`⚠️ no format spec registered for <key>`)。順序が逆だと、fail-close は
 * 「素通りしている鍵は無い」という**未測定の仮定**の上に載る。だからこの一致を
 * 先に測り、そのうえで塞いでいる。塞いだ後の挙動は本 describe の末尾で確認する。
 *
 * 測り方の約束:
 *
 *   1. どの集合も他の集合から導出しない。「A の鍵が ci.yml にあるか」で数えると、
 *      どのリストにも載っていない野良の変数が定義上見えなくなる。各所を全件
 *      列挙してから突き合わせる。
 *   2. 抽出に失敗したら空集合ではなく throw する。空集合どうしは等しいので、
 *      壊れた抽出器は緑を返す。この性質自体を最後のテストで確認している。
 *   3. 差分は「不足」と「余剰」を別々に出す。どちら向きにずれたかが、そのまま
 *      原因 (登録し忘れ / 消し忘れ) を指す。
 *
 * 本ファイル側の literal (`MONITORING_EVIDENCE_KEYS` ほか) を 5 つめの列挙として
 * 残しているのは意図的である。4 箇所すべてから同時に消す変更は、互いの比較では
 * 全会一致で通ってしまう。証跡項目を減らすなら、テストの台帳も明示的に減らす。
 */

/** `const NAME = [ ... ];` の中の文字列リテラルを返す。取れなければ throw。 */
function arrayLiteralKeys(source: string, constName: string): string[] {
  const block = source.match(new RegExp(`const ${constName} = \\[([\\s\\S]*?)\\n\\];`));
  if (!block) throw new Error(`${constName} の配列リテラルが見つからない`);
  const keys = [...block[1].matchAll(/"([A-Za-z0-9_]+)"/g)].map((match) => match[1]);
  if (keys.length === 0) throw new Error(`${constName} から鍵を 1 つも抽出できなかった`);
  return keys;
}

/** readiness 行が実際に読んでいる鍵。 */
function gateCheckedKeys(source: string): string[] {
  const keys = [...source.matchAll(/evidenceOk\("([A-Za-z0-9_]+)"\)/g)].map((match) => match[1]);
  if (keys.length === 0) throw new Error("evidenceOk() の呼び出しを 1 つも抽出できなかった");
  return keys;
}

/** ジョブ直下の `env:` だけを切り出す (steps 側の env と混ぜない)。 */
function jobEnvBlock(source: string, jobName: string): string {
  const lines = jobBlock(source, jobName).split("\n");
  const start = lines.findIndex((line) => line === "    env:");
  if (start === -1) throw new Error(`job ${jobName} に env: が無い`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^ {4}[A-Za-z0-9_-]+:/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

type EnvBinding = { name: string; kind: string; source: string };

/** `NAME: ${{ kind.SOURCE }}` を全件返す。名前と供給元名の両方を保つ。 */
function envBindings(envBlock: string): EnvBinding[] {
  const bindings = [
    ...envBlock.matchAll(
      /^ {6}([A-Za-z0-9_]+):\s*\$\{\{\s*([a-z]+)\.([A-Za-z0-9_]+)\s*\}\}\s*$/gm,
    ),
  ].map((match) => ({ name: match[1], kind: match[2], source: match[3] }));
  if (bindings.length === 0) throw new Error(`${EVIDENCE_JOB} の env: から束縛を抽出できなかった`);
  return bindings;
}

/** 両方向の差分。`missing` = expected 側にあって actual に無い。 */
function setDiff(actual: readonly string[], expected: readonly string[]) {
  return {
    missing: expected.filter((key) => !actual.includes(key)).sort(),
    extra: actual.filter((key) => !expected.includes(key)).sort(),
  };
}

describe("証跡変数の集合が仕様・表・ゲート・供給元で一致している", () => {
  const evidenceEnv = envBindings(jobEnvBlock(ciWorkflow, EVIDENCE_JOB));

  it("B: レポート表の監視変数と、S7 が分母に使う一覧が双方向で一致する", () => {
    // ここがずれると S7 の分母が古いまま固定される。監視証跡を 1 つ足しても
    // 「7 項目すべて ✅」の検算は 7 項目のままで、新しい変数は**ケース表に
    // 現れないので永久に検査されない**。
    const diff = setDiff(arrayLiteralKeys(reportSource, "MONITORING_ENV_KEYS"), [
      ...MONITORING_EVIDENCE_KEYS,
    ]);
    expect(diff.missing, "コード側の一覧に無い (テスト台帳が古い)").toEqual([]);
    expect(diff.extra, "テスト台帳に無い (S7 の分母から漏れている)").toEqual([]);
  });

  it("B: レポート表のバックアップ/復元変数も双方向で一致する", () => {
    const diff = setDiff(arrayLiteralKeys(reportSource, "BACKUP_RESTORE_ENV_KEYS"), [
      ...BACKUP_RESTORE_EVIDENCE_KEYS,
    ]);
    expect(diff.missing, "コード側の一覧に無い").toEqual([]);
    expect(diff.extra, "テスト台帳に無い").toEqual([]);
  });

  it("A: 書式仕様 EVIDENCE_FORMATS の鍵が全証跡変数と一致する", () => {
    // 不足 = その変数は presence だけで ✅ になる (書式検査が存在しない)。
    // 余剰 = 誰も読まない仕様が残っている (削除漏れ)。
    const diff = setDiff(Object.keys(EVIDENCE_FORMATS), ALL_EVIDENCE_KEYS);
    expect(diff.missing, "書式仕様が無い = presence だけで通る").toEqual([]);
    expect(diff.extra, "どの表にも載っていない書式仕様").toEqual([]);
  });

  it("C: readiness ゲートが読む鍵が全証跡変数と一致する", () => {
    // 不足 = 表には出るがゲートは見ていない (報告だけされる証跡)。
    const diff = setDiff(gateCheckedKeys(reportSource), ALL_EVIDENCE_KEYS);
    expect(diff.missing, "ゲートが読んでいない証跡変数").toEqual([]);
    expect(diff.extra, "表に無い鍵をゲートが読んでいる").toEqual([]);
  });

  it("D: ci.yml が vars から渡す変数が、コード側の一覧と一致する", () => {
    // ci.yml 側は「vars 由来の env を全件」列挙する。コード側の一覧を使って
    // 絞り込むと、どのリストにも無い変数が最初から視界に入らない。
    // `inputs` 由来の名前 (CODIP_DEPLOY_TARGET) は vars では渡らないので、
    // 例外をベタ書きせず実測した inputs 集合で差し引く。
    // 範囲: vars 由来のみ。secrets 側は CF_ACCESS_* のようにレポート表へ
    // 載らない値を含むため、この主張の対象外。
    const inputsNames = evidenceEnv.filter((b) => b.kind === "inputs").map((b) => b.name);
    const expected = [
      ...arrayLiteralKeys(reportSource, "PUBLIC_ENV_KEYS"),
      ...ALL_EVIDENCE_KEYS,
    ].filter((key) => !inputsNames.includes(key));

    const diff = setDiff(
      evidenceEnv.filter((b) => b.kind === "vars").map((b) => b.name),
      expected,
    );
    expect(diff.missing, "コードは読むが ci.yml が渡していない (常に unset)").toEqual([]);
    expect(diff.extra, "ci.yml は渡すがどの一覧にも無い").toEqual([]);
  });

  it("D: 証跡変数は inputs 由来であってはならない", () => {
    // inputs はデプロイ実行者がその場で入力できる。証跡がそこから来るなら、
    // 「記録されているか」を問うゲートは自己申告の転記に落ちる。
    const fromInputs = evidenceEnv
      .filter((b) => b.kind === "inputs" && ALL_EVIDENCE_KEYS.includes(b.name))
      .map((b) => b.name);
    expect(fromInputs).toEqual([]);
  });

  it("D: vars 由来の env は名前と供給元名が一致している", () => {
    // `CODIP_X: ${{ vars.CODIP_Y }}` は、コードが X を読み、運用者が Y を
    // 設定するという食い違いを作る。どちらも存在するので気付きにくい。
    const renamed = evidenceEnv
      .filter((b) => b.kind === "vars" && b.name !== b.source)
      .map((b) => `${b.name} <- vars.${b.source}`);
    expect(renamed).toEqual([]);
  });

  it("抽出器は失敗時に空集合ではなく例外を返す", () => {
    // 空集合どうしは等しい。抽出器が壊れたときに [] を返す実装だと、
    // 上の 6 件はすべて緑のまま「一致している」と主張してしまう。
    expect(() => arrayLiteralKeys(reportSource, "NO_SUCH_CONST_NAME")).toThrow();
    expect(() => gateCheckedKeys("// 呼び出しの無いソース")).toThrow();
    expect(() => jobEnvBlock(ciWorkflow, "no-such-job")).toThrow();
    expect(() => envBindings("      PLAIN: value\n")).toThrow();
  });

  // 上の 6 件が「素通りしている鍵は無い」を測っている。そのうえでの fail-close。
  describe("書式仕様の無い鍵は ✅ を出さない (fail-close)", () => {
    const UNKNOWN_KEY = "CODIP_KEY_WITHOUT_FORMAT_SPEC";
    const PLAUSIBLE = "2026-08-11 / platform-ops / drill #4";

    it("仕様の無い鍵は、値が非空でも受理されない", () => {
      const state = evidenceFormatState(UNKNOWN_KEY, PLAUSIBLE, NOW);
      expect(acceptsAsEvidence(state)).toBe(false);
      expect(state).toContain(UNKNOWN_KEY);
    });

    it("拒否理由に値を混ぜない", () => {
      // 証跡は連絡先や運用メモを含む。理由文へ載せると readiness レポートと
      // CI ログの両方へ漏れる。名前だけを出す。
      expect(evidenceFormatState(UNKNOWN_KEY, PLAUSIBLE, NOW)).not.toContain(PLAUSIBLE);
    });

    it("presence の失敗は presence として報告される (仕様の有無に優先する)", () => {
      // 未設定の鍵に「仕様が無い」と言っても、運用者は次の一手を選べない。
      expect(evidenceFormatState(UNKNOWN_KEY, "", NOW)).toBe("⚠️ unset");
    });

    it("仕様のある鍵は従来どおり書式検査まで進む", () => {
      // fail-close が「全部拒否」に化けていないことの対照。
      const state = evidenceFormatState("CODIP_ROLLBACK_OWNER", PLAUSIBLE, NOW);
      expect(state).not.toContain("no format spec");
    });
  });
});

/**
 * 監査文書は `production-evidence-report.js:NNN-MMM` の形で実装を指す。この形式は
 * 「数字が書いてある」以上のことを何も保証しない。
 *
 * 現在の文書の引用数 (数え直した実測値。以前ここに書いていた「89 件 = 62 + 27」は
 * 一度きりの数え上げを残したもので、その後の訂正・追記に追随していなかった):
 * 完全形 63 件 + ワイルドカード形 (`check-*.js:5` など、実ファイルへ解決しない) 3 件
 * + 後方参照 `:NNN` 36 件 = 102 件。後方参照 36 件のうち 9 件は**同じ行にファイル名が
 * 無く**、持ち主が文面からは決まらない。
 *
 * HEAD の文書に対して差し替えた引用は 36 件 (完全形 24 + 後方参照 12)。置換後が 37 件に
 * なるのは、1 箇所が番号ではなく**主張**の誤りで、文ごと書き換えた結果 1 引用 → 2 引用に
 * 増えたため。原因は 1 つではない:
 *
 *   - commit 7f72626 が**文書と被引用ファイルを同じ commit で編集し、番号を編集前の
 *     ファイルから採った**。7f72626 は `ci.yml:112` に 7 行 (`@@ -112 +112,8 @@`)、
 *     `production-evidence-report.js:69` に 152 行を挿入している。ずれた引用は親
 *     (7f72626^) に対しては全部正しく解決する。差し替えた ci.yml 完全形 13 件の大半。
 *   - `create-neon-backup-evidence.js` は後から (T-B17 で `restoreDrillStatus` の供給元を
 *     足したとき) 動いた分で、原因が別。
 *   - `ci.yml` のずれは**どれも正しい job の中**を指していた。job 名で読み合わせると
 *     辻褄が合う位置なので、目視の抜き取りでは通ってしまう。
 *   - `check-dependency-audit.js` / `post-release-status.js` /
 *     `monitoring-runbook-contract.test.ts` の引用も誤っていた。これらは**自分が一度も
 *     編集していない**ファイルで、「自分の変更で動いた引用を直す」という枠の外にあった。
 *     枠を期待値から作ると、枠の外の誤りは最初から見えない。
 *
 * 逆に「動いた」だけでは誤りではない。7f72626 以降に大きく書き換わった
 * `check-neon-backup-evidence.js` 9 件と `neon-backup.yml` 7 件は、番号が当時と違っても
 * **今日の実装に対しては全件正しい**。差分の算術で一括補正すると、この 16 件を
 * 正しい位置から誤った位置へ動かすことになる。だから補正は算術ではなく実測で行う。
 * 実際、後方参照の持ち主を「同じ行の直前のファイル名」で決めて 1 件 (`neon-backup.yml`
 * の `:186`) を正しい位置から誤った位置へ動かし、差し戻している。
 *
 * 訂正のやり方そのものにも 2 つ穴があった。どちらも「検査が通った」ことを
 * 「網羅した」と読み替えたために起きている:
 *
 *   - 置換前に「その文字列が文書内に 1 回だけ現れる」ことを検査していた。これは
 *     **needle の一意性**であって**誤りの件数**ではない。同じ誤り (`:17-48`) が
 *     後方参照形と完全形の 2 つの構文で書かれており、一方だけを直して検査は緑だった。
 *     以後、置換後に**古い番号そのもの**が文書に残っていないかを走査する。
 *   - 機械的な絞り込みが出した「要確認 25 件」を目視で振り分け、大半を過剰報告として
 *     読まずに落とした。実際に読んだのは一覧より小さい部分集合で、3 件を見落としていた。
 *     絞り込みの出力は**全件読む**。判定を挟むなら、判定の側にも根拠を残す。
 *
 * そして、引用が正しく解決することは**その文が真であること**を含意しない。#20 の
 * 「CI 側には (synthetic) の注記がない」は、注記を追加した当の commit 7f72626 が
 * 同じ commit で書いた文だった。行番号を直しても文は嘘のままなので、文ごと書き換えた。
 * 範囲・job・トークンのどの検査も、この種の誤りは原理的に検出しない。
 *
 * 検査も同じ原則で書く。行番号を**文書から読み取り**、その行に何が書かれているかを
 * 実装側で確かめる。期待値を先に決めて範囲を書き下すと、測っているのは文書ではなく
 * 自分の記憶になる。コードだけ動いても、番号だけ直しても落ちる。
 *
 * 範囲は両端で固定する。「範囲内のどこかにアンカーがある」だけだと、範囲の広い引用は
 * 実装が数行ずれても窓の中にアンカーが残り、緑のまま通る (変異 R9 で実測)。同じ run 行
 * が別 job にも存在する引用 (#15 の `db:pg:check-postgis-ddl` は `:219` と `:386`) は、
 * 行の内容だけでは区別できないので job 名も固定する (変異 R21)。
 */
describe("監査文書の行番号引用が実装を指している", () => {
  const reportLines = reportSource.split("\n");

  function citedRange(pattern: RegExp): { start: number; end: number } {
    const matches = [...auditDoc.matchAll(new RegExp(pattern, "g"))];
    if (matches.length !== 1) {
      throw new Error(`文書側の引用が一意に見つからない (${matches.length} 件): ${pattern}`);
    }
    const [, start, end] = matches[0];
    return { start: Number(start), end: Number(end ?? start) };
  }

  const SOURCES: Record<string, string[]> = {
    report: reportLines,
    ci: ciWorkflow.split("\n"),
    smoke: smokeSource.split("\n"),
    create: createEvidenceSource.split("\n"),
    // 以下 4 つは、どの調査でも一度も読み合わせていなかった被引用ファイル。
    // 「引用が動いたのは自分が触ったファイルだけのはず」という前提で範囲を決めていたため、
    // 触っていないファイルの引用は最初から検査の母集団に入っていなかった。
    check: checkEvidenceSource.split("\n"),
    backup: backupWorkflow.split("\n"),
    depaudit: depAuditSource.split("\n"),
    postrelease: postReleaseSource.split("\n"),
    monitoring: monitoringContractSource.split("\n"),
  };

  const citedText = (pattern: RegExp, source = "report") => {
    const lines = SOURCES[source];
    const { start, end } = citedRange(pattern);
    if (!(start >= 1 && end >= start && end <= lines.length)) {
      throw new Error(`引用範囲が実装の行数と噛み合わない: ${start}-${end}`);
    }
    return lines.slice(start - 1, end).join("\n");
  };

  /** 引用先の行が属する YAML job 名 (インデント 2 のキーを後方へ探す)。 */
  function jobAt(lineNumber: number): string | null {
    for (let i = lineNumber - 1; i >= 0; i -= 1) {
      const key = SOURCES.ci[i].match(/^ {2}([A-Za-z0-9_-]+):\s*$/);
      if (key) return key[1];
    }
    return null;
  }

  // 範囲は**両端**で固定する。中身が含まれることだけを見ると、範囲が広い引用は
  // 実装が数行ずれてもアンカーが窓の中に残り、緑のまま通ってしまう (変異 R9 で実測)。
  const CITATIONS: Array<{
    label: string;
    doc: RegExp;
    first: RegExp;
    last: RegExp;
    source?: string;
    job?: string;
  }> = [
    {
      label: "#7 監視証跡チェックの生成箇所",
      doc: /`production-evidence-report\.js:(\d+)-(\d+)`、判定関数は/,
      first: /evidenceOk\("CODIP_CLOUDFLARE_ACCESS_EVIDENCE"\)/,
      last: /evidenceOk\("CODIP_ROLLBACK_OWNER"\)/,
    },
    {
      label: "#7 判定関数",
      doc: /判定関数は `:(\d+)-(\d+)`/,
      first: /^function evidenceFormatState\(key, value, now\) \{$/,
      last: /^\}$/,
    },
    {
      label: "#7 供給元の鍵一覧",
      doc: /`CODIP_ROLLBACK_OWNER` → `production-evidence-report\.js:(\d+)-(\d+)`/,
      first: /^const MONITORING_ENV_KEYS = \[$/,
      last: /^\];$/,
    },
    {
      label: "#7 書式仕様表",
      doc: /`EVIDENCE_FORMATS`（`:(\d+)-(\d+)`）/,
      first: /^const EVIDENCE_FORMATS = \{$/,
      last: /^\};$/,
    },
    {
      label: "#7 fail-close",
      doc: /fail-close で拒否する。`:(\d+)`）/,
      first: /no format spec registered/,
      last: /no format spec registered/,
    },
    {
      label: "#8 backup/restore チェック行",
      doc: /`Backup\/restore evidence recorded`（`production-evidence-report\.js:(\d+)`）/,
      first: /\["Backup\/restore evidence recorded", evidenceOk\(/,
      last: /\["Backup\/restore evidence recorded", evidenceOk\(/,
    },
    {
      label: "#8 供給元の鍵一覧",
      doc: /`vars\.CODIP_BACKUP_RESTORE_EVIDENCE` → `production-evidence-report\.js:(\d+)-(\d+)`/,
      first: /^const BACKUP_RESTORE_ENV_KEYS = \[$/,
      last: /^\];$/,
    },
    {
      label: "#8 backup/restore の書式仕様",
      doc: /を要求する（`:(\d+)-(\d+)`）/,
      first: /^ {2}CODIP_BACKUP_RESTORE_EVIDENCE: \{$/,
      last: /^ {2}\},$/,
    },
    {
      // 監視証跡 7 変数を渡す env 行。直前まで文書は `:177-183` を指していたが、そこは
      // 認証系の env 行だった。同じ job・同じ `${{ vars.* }}` 書式で 7 行隣にあるため、
      // job 名や見た目では区別が付かない。変数名そのものを両端に置いて縛る。
      label: "#7 ci.yml の監視証跡 env 行",
      source: "ci",
      job: "production-target-env",
      doc: /`ci\.yml:(\d+)-(\d+)` の `vars\.CODIP_CLOUDFLARE_ACCESS_EVIDENCE`/,
      first: /^ +CODIP_CLOUDFLARE_ACCESS_EVIDENCE: \$\{\{ vars\.CODIP_CLOUDFLARE_ACCESS_EVIDENCE \}\}$/,
      last: /^ +CODIP_ROLLBACK_OWNER: \$\{\{ vars\.CODIP_ROLLBACK_OWNER \}\}$/,
    },
    {
      label: "#8 ci.yml の backup/restore env 行",
      source: "ci",
      job: "production-target-env",
      doc: /`ci\.yml:(\d+)` `vars\.CODIP_BACKUP_RESTORE_EVIDENCE`/,
      first: /^ +CODIP_BACKUP_RESTORE_EVIDENCE: \$\{\{ vars\.CODIP_BACKUP_RESTORE_EVIDENCE \}\}$/,
      last: /^ +CODIP_BACKUP_RESTORE_EVIDENCE: \$\{\{ vars\.CODIP_BACKUP_RESTORE_EVIDENCE \}\}$/,
    },
    {
      // 生成と検査の 2 行。job まで縛るのは、同じ 2 行組が verify job にもあるため。
      // 実際、直前まで文書は同じ job 内の無関係な 2 ステップを指しており、job 名で
      // 読み合わせると辻褄が合ってしまっていた。
      label: "#17 ci.yml のビルド → 成果物検査",
      source: "ci",
      job: "production-target-env",
      doc: /`ci\.yml:(\d+)` → `:(\d+)`/,
      first: /^ +run: npm run cf:build$/,
      last: /^ +run: npm run release:check-cloudflare-build-artifact$/,
    },
    // 以下は、7f72626 が ci.yml:112 に入れた 7 行ぶん全部ずれていた引用。同じ commit が
    // 文書と ci.yml の両方を編集し、番号を編集前の ci.yml から採ったために起きている
    // (親 7f72626^ に対しては全て正しく解決する)。同じ手順を繰り返せば同じずれが出る
    // ので、直した番号は 1 件残らずここで縛る。
    {
      label: "#9 ci.yml の Neon branch / Hyperdrive binding env 行",
      source: "ci",
      job: "production-target-env",
      doc: /`ci\.yml:(\d+)-(\d+)` の `vars\.\*` \| 🔴 \| 実際のデプロイ先と異なる/,
      first: /^ +CODIP_HYPERDRIVE_BINDING: \$\{\{ vars\.CODIP_HYPERDRIVE_BINDING \}\}$/,
      last: /^ +CODIP_NEON_BRANCH: \$\{\{ vars\.CODIP_NEON_BRANCH \}\}$/,
    },
    {
      label: "#10 ci.yml の認証方式宣言 env 行",
      source: "ci",
      job: "production-target-env",
      doc: /`ci\.yml:(\d+)-(\d+)` の `vars\.\*` \| 🔴 \| \*\*認証方式の宣言と/,
      first: /^ +CODIP_TRUST_PROXY_AUTH: \$\{\{ vars\.CODIP_TRUST_PROXY_AUTH \}\}$/,
      last: /^ +CODIP_DISABLE_TOKEN_AUTH: \$\{\{ vars\.CODIP_DISABLE_TOKEN_AUTH \}\}$/,
    },
    {
      label: "#11 ci.yml の DB 接続 secrets 行",
      source: "ci",
      job: "production-target-env",
      doc: /`ci\.yml:(\d+)-(\d+)` の `secrets\.\*`/,
      first: /^ +DATABASE_URL: \$\{\{ secrets\.CODIP_DATABASE_URL \}\}$/,
      last: /^ +CODIP_MIGRATION_DATABASE_URL: \$\{\{ secrets\.CODIP_MIGRATION_DATABASE_URL \}\}$/,
    },
    {
      label: "#12 ci.yml の CODIP_BASE_URL env 行",
      source: "ci",
      job: "production-target-env",
      doc: /`ci\.yml:(\d+)` の `vars\.CODIP_BASE_URL`/,
      first: /^ +CODIP_BASE_URL: \$\{\{ vars\.CODIP_BASE_URL \}\}$/,
      last: /^ +CODIP_BASE_URL: \$\{\{ vars\.CODIP_BASE_URL \}\}$/,
    },
    {
      // 同じ run 行が verify job にもあるため job まで縛る。
      label: "#15 ci.yml の PostGIS DDL 検査",
      source: "ci",
      job: "production-target-env",
      doc: /`db:pg:check-postgis-ddl`、`ci\.yml:(\d+)`/,
      first: /^ +run: npm run db:pg:check-postgis-ddl$/,
      last: /^ +run: npm run db:pg:check-postgis-ddl$/,
    },
    {
      // `:225,229` は範囲ではなく 2 点だが、両端固定としてはそのまま使える。
      // 間に挟まる `--expect-standard-records` 版まで含めて位置が縛られる。
      label: "#16 ci.yml の production smoke 2 ステップ",
      source: "ci",
      job: "production-target-env",
      doc: /production smoke（`ci\.yml:(\d+),(\d+)`）/,
      first: /^ +run: npm run release:smoke -- --read-only --base-url "\$CODIP_BASE_URL"$/,
      last: /^ +run: npm run release:smoke -- --read-only --base-url "\$CODIP_BASE_URL" --expect-standard-records$/,
    },
    {
      label: "#16 release-smoke.js の fetch",
      source: "smoke",
      doc: /`release-smoke\.js:(\d+)` `fetch\(url, …\)`/,
      first: /^ +return await fetch\(url, \{ \.\.\.init, headers, signal: controller\.signal \}\);$/,
      last: /^ +return await fetch\(url, \{ \.\.\.init, headers, signal: controller\.signal \}\);$/,
    },
    {
      label: "#16 release-smoke.js の --base-url 解釈",
      source: "smoke",
      doc: /対象は `:(\d+)` `--base-url`/,
      first: /^ +const baseUrl = argValue\("--base-url",/,
      last: /^ +const baseUrl = argValue\("--base-url",/,
    },
    {
      label: "#20 ci.yml の synthetic production env ステップ",
      source: "ci",
      job: "verify",
      doc: /CI 版は `ci\.yml:(\d+)-(\d+)`/,
      first: /^ +env:$/,
      last: /^ +run: npm run release:validate-env:production$/,
    },
    {
      label: "#24 ci.yml の preview smoke ステップ",
      source: "ci",
      job: "verify",
      doc: /preview smoke（`ci\.yml:(\d+)-(\d+)`）/,
      first: /^ +env:$/,
      last: /^ +npm run release:smoke -- --base-url http:\/\/127\.0\.0\.1:3100$/,
    },
    {
      label: "#24 ci.yml の preview サーバ起動行",
      source: "ci",
      job: "verify",
      doc: /`127\.0\.0\.1:3100`（`ci\.yml:(\d+)`）/,
      first: /^ +npm run start:checked -- --hostname 127\.0\.0\.1 --port 3100 /,
      last: /^ +npm run start:checked -- --hostname 127\.0\.0\.1 --port 3100 /,
    },
    {
      label: "#24 release-smoke.js の fetch",
      source: "smoke",
      doc: /`release-smoke\.js:(\d+)` の `fetch`/,
      first: /^ +return await fetch\(url, \{ \.\.\.init, headers, signal: controller\.signal \}\);$/,
      last: /^ +return await fetch\(url, \{ \.\.\.init, headers, signal: controller\.signal \}\);$/,
    },
    // §2.1 側。こちらは同一 commit のずれではなく、T-B17 以降の自分の変更で動いた分。
    // 供給経路 (`env → 引数`) の末端。ここを create 側の引数パース行だと誤読して
    // 一度書き換え、#4 の `:185` との対 (同じ run ブロックの隣接行) を壊した。
    // 後方参照 `:NNN` の持ち主は「同じ行の直前のファイル名」では決まらない。
    {
      label: "#2 neon-backup.yml から create へのフラグ受け渡し",
      source: "backup",
      doc: /→ `:(\d+)` `--restore-drill-status`/,
      first: /^ +--restore-drill-status "\$CODIP_LAST_RESTORE_DRILL_STATUS" \\$/,
      last: /^ +--restore-drill-status "\$CODIP_LAST_RESTORE_DRILL_STATUS" \\$/,
    },
    {
      label: "#2 create-neon-backup-evidence.js の出力フィールド",
      source: "create",
      doc: /`create-neon-backup-evidence\.js:(\d+)`。既定値/,
      first: /^ +restoreDrillStatus: options\.restoreDrillStatus,$/,
      last: /^ +restoreDrillStatus: options\.restoreDrillStatus,$/,
    },
    {
      label: "#2 未指定時に停止する分岐",
      source: "create",
      doc: /未指定なら `:(\d+)-(\d+)` で異常終了する/,
      first: /^ +if \(!options\.restoreDrillStatus\) \{$/,
      last: /^ +\}$/,
    },
    {
      label: "#3 申告値が実測と矛盾したときに停止する行",
      source: "create",
      doc: /実測と矛盾すれば `:(\d+)` で異常終了する/,
      first: /^ +throw new Error\("--pg-dump-status contradicts the artifact measurement/,
      last: /^ +throw new Error\("--pg-dump-status contradicts the artifact measurement/,
    },
    {
      label: "#5 artifact を実測する関数",
      source: "create",
      doc: / \/ `create-neon-backup-evidence\.js:(\d+)-(\d+)`）/,
      first: /^function artifactFromFile\(filePath\) \{$/,
      last: /^\}$/,
    },
    {
      // 実測時点で正しかった引用。同じファイルの範囲引用がこれで 2 件になり
      // #5 側のパターンが曖昧になったので、こちらも縛って区別を固定する。
      label: "#3 status を保持する変数宣言",
      source: "create",
      doc: /\| `create-neon-backup-evidence\.js:(\d+)-(\d+)` — #5 の/,
      first: /^ +let pgDumpStatus;$/,
      last: /^ +let pgDumpStatusSource;$/,
    },
    {
      label: "#1 実測が無ければ書かずに止める分岐",
      source: "create",
      doc: /測定できなければ `:(\d+)-(\d+)` で/,
      first: /^ +if \(!Number\.isFinite\(measuredSeconds\) \|\| measuredSeconds < 0\) \{$/,
      last: /^ +\}$/,
    },
    // §4 の check-dependency-audit.js。このファイルは自分が一度も触っておらず、
    // 引用 3 件が揃って別の場所を指していた。「自分の変更で動いた分だけがずれる」
    // という前提が、母集団の側を間違えていたことの実例。
    {
      label: "#19 npm audit を実行する行",
      source: "depaudit",
      doc: /`check-dependency-audit\.js:(\d+)` `spawnSync\(/,
      first: /^ +const result = spawnSync\("npm", \["audit", "--json"\], \{$/,
      last: /^ +const result = spawnSync\("npm", \["audit", "--json"\], \{$/,
    },
    {
      // 同じ ALLOWLIST を後方参照形と完全形の 2 箇所が引く。第2次で後方参照だけを
      // 直し、完全形は同じ誤った番号のまま残った — needle の一意性検査は
      // 「その文字列が 1 回」しか見ておらず、誤りが何件あるかは測っていない。
      label: "#19 ALLOWLIST の宣言 (後方参照形)",
      source: "depaudit",
      doc: /`:(\d+)-(\d+)` の `ALLOWLIST`/,
      first: /^const ALLOWLIST = \[$/,
      last: /^\];$/,
    },
    {
      label: "#19 ALLOWLIST の宣言 (完全形)",
      source: "depaudit",
      doc: /`check-dependency-audit\.js:(\d+)-(\d+)`/,
      first: /^const ALLOWLIST = \[$/,
      last: /^\];$/,
    },
    {
      label: "#19 --input を解釈する行",
      source: "depaudit",
      doc: /`:(\d+)` の `--input`/,
      first: /^ +if \(argv\[i\] === "--input"\) \{$/,
      last: /^ +if \(argv\[i\] === "--input"\) \{$/,
    },
    {
      label: "#25 既定 production URL の定数宣言",
      source: "postrelease",
      doc: /既定 URL は `:(\d+)` の定数/,
      first: /^const DEFAULT_PRODUCTION_URL = /,
      last: /^const DEFAULT_PRODUCTION_URL = /,
    },
    // #20 は行番号だけでなく**主張**が誤っていた箇所 (「CI 側に注記がない」)。
    // 注記を足した commit 7f72626 が、同じ commit で「注記がない」と書いていた。
    // 引用が解決することは、その文が真であることを含意しない。
    {
      label: "#20 ci.yml のステップ名に付く (synthetic values)",
      source: "ci",
      job: "verify",
      doc: /ステップ名 `ci\.yml:(\d+)` が/,
      first: /^ +- name: Validate production env contract \(synthetic values\)$/,
      last: /^ +- name: Validate production env contract \(synthetic values\)$/,
    },
    {
      label: "#20 ci.yml の (synthetic) 注記コメント",
      source: "ci",
      job: "verify",
      doc: /`:(\d+)-(\d+)` のコメントが/,
      first: /^ +# \(synthetic\) — the values below are fixtures, not the production ones\.$/,
      last: /^ +# as production evidence\.$/,
    },
    // 引用先が他セッション所有のファイルでも、ずれれば散文は嘘になる。
    // 読むだけなら所有権に触れないので、ここで縛る。
    {
      label: "#26 streak を run 履歴から導く旨のテスト",
      source: "monitoring",
      doc: /contract\.test\.ts:(\d+)-(\d+)` で固定済み/,
      first: /^ {2}it\("derives the streak from run history rather than persisted state", \(\) => \{$/,
      last: /^ {2}\}\);$/,
    },
    {
      // 散文 (「対象は runbook 4ファイル」) は正しく、番号だけが別の describe を
      // 指していた。ずれは両方向に起きる。
      label: "秘密混入検査の describe",
      source: "monitoring",
      doc: /contract\.test\.ts:(\d+)-(\d+)` のみで/,
      first: /^describe\("operational runbooks contain no credentials", \(\) => \{$/,
      last: /^\}\);$/,
    },
  ];

  it.each(CITATIONS)("$label", ({ doc, first, last, source, job }) => {
    const lines = citedText(doc, source).split("\n");
    expect(lines[0]).toMatch(first);
    expect(lines[lines.length - 1]).toMatch(last);
    if (job) expect(jobAt(citedRange(doc).start)).toBe(job);
  });

  it("#7 が「7項目」と書いている以上、引用範囲にも 7 件ある", () => {
    // 範囲が正しくても件数がずれれば散文が嘘になる。行数ではなく該当行を数える。
    const rows = citedText(/`production-evidence-report\.js:(\d+)-(\d+)`、判定関数は/)
      .split("\n")
      .filter((line) => line.includes("evidenceOk("));
    expect(rows).toHaveLength(7);
  });

  it("#7 が本文に列挙する 7 変数が、引用先の ci.yml 行と順番まで一致する", () => {
    // 両端固定は範囲を縛るが、中身が本文の列挙と同じ順で並んでいることまでは見ない。
    // 本文の変数名と ci.yml の env 行を突き合わせる。ここがずれると、範囲は正しいのに
    // 「この 7 つが渡される」という散文だけが嘘になる。
    const row = auditDoc
      .split("\n")
      .find((line) => line.includes("`ci.yml:") && line.includes("`vars.CODIP_CLOUDFLARE_ACCESS_EVIDENCE`"));
    const prose = [...(row ?? "").matchAll(/`(?:vars\.)?(CODIP_[A-Z0-9_]+)`/g)].map((m) => m[1]);
    const cited = citedText(/`ci\.yml:(\d+)-(\d+)` の `vars\.CODIP_CLOUDFLARE_ACCESS_EVIDENCE`/, "ci")
      .split("\n")
      .map((line) => line.trim().split(":")[0]);
    expect(prose).toHaveLength(7);
    expect(cited).toEqual(prose);
  });

  it("秘密混入検査が「runbook 4ファイル」と書いている以上、走査対象も 4 件である", () => {
    // この行は**散文が正しく番号だけ誤っていた**組み合わせだった。番号を直したので、
    // 次は散文の側 (4ファイル) が実装から外れたときに落ちるようにしておく。
    const files = citedText(/contract\.test\.ts:(\d+)-(\d+)` のみで/, "monitoring")
      .split("\n")
      .filter((line) => /^ {4}"[^"]+\.md": /.test(line));
    const prose = auditDoc.match(/対象は runbook (\d+)ファイル/);
    expect(prose).not.toBeNull();
    expect(files).toHaveLength(Number(prose?.[1]));
  });

  it("引用が見つからないときは黙って通さない", () => {
    // 文書が書き換わって正規表現が当たらなくなったとき、空集合を検査して緑に
    // なるのが最悪の壊れ方。ここが本体の検査の土台になっている。
    expect(() => citedText(/存在しない引用 `:(\d+)-(\d+)`/)).toThrow(/一意に見つからない/);
  });
});
