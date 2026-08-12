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

/** §2.2 #7 の 7 変数と対になる、バックアップ/復元の 1 変数。 */
const BACKUP_RESTORE_EVIDENCE_KEYS = ["CODIP_BACKUP_RESTORE_EVIDENCE"] as const;

/** 証跡変数の全体。分類の単位はレポート表の区切りに合わせている。 */
const ALL_EVIDENCE_KEYS: readonly string[] = [
  ...MONITORING_EVIDENCE_KEYS,
  ...BACKUP_RESTORE_EVIDENCE_KEYS,
];

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
 * とくに **B に足して A を忘れた鍵**は `evidenceFormatState` の
 * `if (!spec) return presence;` (`production-evidence-report.js:287-288`) を通り、
 * **非空でありさえすれば ✅ になる**。表には行が増え、ゲートは緑で、
 * 書式検査だけが存在しない。増えた行はむしろ「検査項目が増えた」ように読める。
 *
 * この一致が測られていない限り、未知鍵の fail-close は
 * 「素通りしている鍵は無い」という**未測定の仮定**の上に載る。だから順序として
 * ここが先にある。
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

const REPORT_SCRIPT_PATH = "scripts/tools/production-evidence-report.js";
const CI_WORKFLOW_PATH = ".github/workflows/ci.yml";
const EVIDENCE_JOB = "production-target-env";

const reportSource = readFileSync(path.join(REPO_ROOT, REPORT_SCRIPT_PATH), "utf8");
const ciWorkflow = readFileSync(path.join(REPO_ROOT, CI_WORKFLOW_PATH), "utf8");

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
});
