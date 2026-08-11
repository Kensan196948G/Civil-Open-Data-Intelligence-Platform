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
import { evidenceFormatState } from "../../scripts/tools/production-evidence-report.js";
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
const auditDoc = readFileSync(path.join(REPO_ROOT, AUDIT_PATH), "utf8");

/** 判定に日付が絡む形式 (ISO 8601 の未来日チェックなど) があるため固定する。 */
const NOW = new Date("2026-08-12T00:00:00Z");

/**
 * #128 以前の `evidenceState()` の判定を、実コードから取り出す。
 *
 * `evidenceFormatState` は `EVIDENCE_FORMATS` に spec が無い鍵に対しては
 * presence 判定 (非空 + placeholder 正規表現) の結果をそのまま返す
 * (`production-evidence-report.js:268-269`)。つまり未知の鍵を渡せば、旧判定が
 * そのまま観測できる。テスト内へ placeholder 正規表現を写経するより退行に強い。
 *
 * ⚠ 未知の鍵が将来 fail-closed になったら、下の「前提の確認」が落ちて
 *   この probe が無効になったことを知らせる。そのときは probe を作り直すこと。
 */
function legacyEvidenceState(value: string): string {
  return evidenceFormatState("__UNSPECIFIED_PROBE_KEY__", value, NOW);
}

function acceptsAsEvidence(state: string): boolean {
  return state.startsWith("✅");
}

/** §2.2 #7 が名指しする 7 変数 (ci.yml:177-183)。 */
const MONITORING_EVIDENCE_KEYS = [
  "CODIP_CLOUDFLARE_ACCESS_EVIDENCE",
  "CODIP_MONITORING_CONTACTS",
  "CODIP_CLOUDFLARE_ALERT_POLICY",
  "CODIP_CLOUDFLARE_LOGS_EVIDENCE",
  "CODIP_NEON_MONITORING_EVIDENCE",
  "CODIP_SMOKE_MONITORING_SCHEDULE",
  "CODIP_ROLLBACK_OWNER",
] as const;

/** 文書が偽陰性の実例として挙げている 2 文字。 */
const TWO_CHAR_EVIDENCE = "ok";

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

/** Issue #129 以前の release-smoke.js の判定を逐語で保存したもの (仕様ではない)。 */
function legacySubstringCheck(csp: string): boolean {
  return (
    csp.includes("default-src 'self'") &&
    csp.includes("object-src 'none'") &&
    csp.includes("frame-ancestors 'none'") &&
    csp.includes("https://cyberjapandata.gsi.go.jp") &&
    !csp.includes("'unsafe-eval'")
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

// --- SB13: restoreDrillRecord の参照解決 -------------------------------------

const BACKUP_EVIDENCE_GATE = "scripts/tools/check-neon-backup-evidence.js";

/**
 * 他の判定行がすべて緑になる証跡。restoreDrillRecord 以外の次元で落ちると
 * run() の false が「解決検査が効いた」なのか「別の検査が落ちた」なのか
 * 区別できなくなるため、参照だけを動かせる土台として置く。
 */
const RESOLVABLE_DRILL_RECORD = "docs/runbooks/restore-drill-record.md";

function backupEvidenceWith(restoreDrillRecord: string) {
  return {
    checkedAt: "2026-07-20T07:00:00Z",
    projectId: "falling-dawn-93620497",
    branch: "main",
    endpointHost: "ep-main.example.neon.tech",
    historyWindowHours: 24,
    historyRetentionSecondsMeasured: 86400,
    historyRetentionMeasuredAt: "2026-07-20T07:00:00Z",
    historyRetentionProjectId: "falling-dawn-93620497",
    historyRetentionSource: "neon-api:GET /projects/{project_id}#history_retention_seconds",
    lastPgDumpAt: "2026-07-20T06:30:00Z",
    lastPgDumpStatus: "success",
    lastPgDumpStatusSource: "artifact-stat:regular-file,size>0",
    lastPgDumpArtifact: "secure-artifact://codip/neon/20260720T063000Z.dump",
    lastRestoreDrillAt: "2026-07-19T06:30:00Z",
    restoreDrillStatus: "success",
    restoreDrillRecord,
    owner: "release-manager",
  };
}

/** ゲートを実プロセスで走らせ、通ったかどうかを返す。 */
function backupEvidenceGatePasses(restoreDrillRecord: string): boolean {
  const result = spawnSync(
    process.execPath,
    [
      path.join(REPO_ROOT, BACKUP_EVIDENCE_GATE),
      "--evidence-json",
      JSON.stringify(backupEvidenceWith(restoreDrillRecord)),
      "--now",
      "2026-07-20T07:30:00Z",
    ],
    { cwd: REPO_ROOT, encoding: "utf8" },
  );
  return result.status === 0;
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
  // SB13: 採番外。#2 / #4 の 🔴 を緩和している「台帳を参照させる」経路そのもの。
  // 参照の検査が非空判定だけだったため、実在しないアンカーを指した参照が ✅ で
  // 記録されていた (2026-08-12 に本番の変数で実測)。裏付けとして数えられていた
  // ものが、実際には何も指していなかったことになる。
  //
  // run() は「解決できない参照でもゲートが通るか」を測る。真の値の代わりに
  // #2026-07-19 を使うのは、本番の値をテストへ写すとその文字列が正解として
  // 固定され、記録側を直したときに落ちるべき所で落ちなくなるためである。
  // どちらも同じ欠陥クラス (実在しないアンカー) を代表する。
  SB13: {
    kind: "executed",
    run: () => backupEvidenceGatePasses(`${RESOLVABLE_DRILL_RECORD}#2026-07-19`),
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

  it("前提の確認: #128 以前の判定は 2 文字を証跡として受理していた", () => {
    // この probe が壊れたら S7 / S8 の「旧実装との差」の主張が根拠を失う。
    expect(acceptsAsEvidence(legacyEvidenceState(TWO_CHAR_EVIDENCE))).toBe(true);
    expect(acceptsAsEvidence(legacyEvidenceState(""))).toBe(false);
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

  it("解決できる参照なら同じ証跡がゲートを通る (SB13 の対照)", () => {
    // これが false なら SB13 の「通らない」は解決検査の成果ではなく、土台の
    // 証跡が別の次元 (鮮度・実測欄) で落ちているだけである。
    expect(backupEvidenceGatePasses(RESOLVABLE_DRILL_RECORD)).toBe(true);
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
