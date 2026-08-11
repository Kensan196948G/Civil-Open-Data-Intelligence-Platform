import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 証跡ゲートの「自己申告系統」棚卸し (T-Q6 / Issue #126-#129 の再発防止)。
 *
 * #126-#129 で潰した欠陥は同一系統で、深刻度が 4 段階ある。
 *   等級1 自己申告      … 人が書いた文字列をそのまま証跡にする
 *   等級2 検査経路の閉塞 … 合格側の既定値が固定され、呼び出し側が上書きできない
 *   等級3 内容非検証    … 空でなくプレースホルダでなければ何でも合格
 *   等級4 部分一致で網羅を主張 … 文言 includes だけで「契約を満たす」と主張する
 *
 * ■ このテストが「分類を散文で書いただけ」に堕ちないための構造
 *
 * 分類表をここへ書き写すだけなら、それ自体が等級1 になる (人が書いた文字列が
 * 唯一の供給元)。よって本テストは 3 点をコード側から導出して突き合わせる。
 *
 *   1. 信号の導出 (deriveSignals)
 *      各ゲートが「文字列一致だけで判定しているか」「外部/ファイルシステムを
 *      実測しているか」をソースから算出し、宣言値と一致することを要求する。
 *      等級4 ⟺ substringDominant の双条件で、分類基準そのものを機械可読にする。
 *
 *   2. 網羅性の導出 (completeness by scan)
 *      scripts/tools, scripts/deploy, .github/workflows を実際に読み、
 *      package.json の release:* / db:* が指すスクリプトも解決して、
 *      「棚卸しに載っていない実行可能ゲート」が 1 つも無いことを要求する。
 *      新しいゲートを足した人は、分類するまでテストを通せない。
 *      (この型は scripts/tools/check-openapi-route-coverage.js が
 *       src/app/api を walk して未文書ルートを落とすのと同じ考え方)
 *
 *   3. 欠陥の導出 (unpairedContinueOnError / workflowFilesReadBy)
 *      未是正として報告した 2 件は、いずれもここで YAML と JS から算出する。
 *      「codeql.yml が落ちない」も「SHA ピン検査が 4/6 ファイルしか見ていない」も
 *      本テストがリテラルとして持っているのではなく、現物から出している。
 *
 * ■ 意図的にやっていないこと
 *
 *   - docs/security/evidence-gate-audit.md との突き合わせは
 *     tests/unit/evidence-gate-audit-contract.test.ts (backend 所有) の役割で、
 *     こちらは文書ではなく **実ファイルの網羅** を受け持つ。重複させない。
 *   - issue: "remediating" の項目は、backend の是正が別ブランチで進行中のため
 *     本ブランチでの等級を確定しない。統合後に "none" へ更新すること。
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const read = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");
const listFiles = (relativeDir: string) =>
  readdirSync(path.join(repoRoot, relativeDir), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${relativeDir}/${entry.name}`)
    .sort();

// ---------------------------------------------------------------------------
// 1. 信号の導出
// ---------------------------------------------------------------------------

type Signals = {
  /** 文字列一致だけで合否を決めており、実測経路を 1 つも持たない */
  substringDominant: boolean;
  /** HTTP / 子プロセス / DB を実際に叩く */
  probesExternal: boolean;
  /** 成果物の実在をファイルシステムで確かめる */
  probesFs: boolean;
};

/**
 * 受け手 (`\w.`) を要求するのが要点。`"$queryRaw<"` のような **検索対象の
 * 文字列リテラル** を実クエリと取り違えると、分類器自身が等級4 になる
 * (check-v1-standard-record-contract.js で実際に踏みかけた)。
 */
const EXTERNAL_PROBE =
  /\b(?:fetch|fetcher|fetchWithTimeout|probeUrl|spawnSync|execFileSync|execSync)\s*\(|\w\.\$queryRaw(?:Unsafe)?\s*[(`<]|\bprisma\.\w+\.(?:count|findMany|findFirst|aggregate)\s*\(/g;
const FILESYSTEM_PROBE = /\b(?:statSync|existsSync)\s*\(/g;
const SUBSTRING_ASSERTION = /\.includes\(|requireText\(/g;

/**
 * 閾値 10 は「たまたま 1-2 箇所 includes を使う」ゲートと
 * 「判定の全量が includes」のゲートを分けるための線。件数そのものは宣言せず
 * 真偽値だけを持つ (件数を書くとリファクタで無意味に落ちる)。
 */
const SUBSTRING_DOMINANCE_THRESHOLD = 10;

function deriveSignals(source: string): Signals {
  const substringCount = (source.match(SUBSTRING_ASSERTION) ?? []).length;
  const externalCount = (source.match(EXTERNAL_PROBE) ?? []).length;
  return {
    substringDominant: substringCount >= SUBSTRING_DOMINANCE_THRESHOLD && externalCount === 0,
    probesExternal: externalCount > 0,
    probesFs: (source.match(FILESYSTEM_PROBE) ?? []).length > 0,
  };
}

// ---------------------------------------------------------------------------
// 2. 棚卸し
// ---------------------------------------------------------------------------

/** 0 = 適合 (実測に基づく)、1-4 = 上記の等級、null = 判定保留 */
type Grade = 0 | 1 | 2 | 3 | 4 | null;

type IssueState =
  /** 本リポジトリで未是正。Issue 起票対象 */
  | "open"
  /** 別ブランチで是正が進行中。等級は確定させない */
  | "remediating"
  /** 既に担当者へ割当済み (#126-#129 / T-B7 等)。重複起票しない */
  | "assigned"
  /** 是正不要 */
  | "none";

type GateEntry = {
  file: string;
  grade: Grade;
  issue: IssueState;
  why: string;
  signals: Signals;
};

const SCRIPT_GATES: readonly GateEntry[] = [
  {
    file: "scripts/tools/check-audit-contract.js",
    grade: 4,
    issue: "open",
    why: "17 件すべてが requireText。監査ログ保証の『契約』を名乗るが、ADR や実装へ該当語を 1 行書けば充足する。監査が実際に記録されるかは一切見ていない",
    signals: { substringDominant: true, probesExternal: false, probesFs: false },
  },
  {
    file: "scripts/tools/check-cloudflare-build-artifact.js",
    grade: 0,
    issue: "none",
    why: "wrangler.jsonc が宣言したパスを statSync で実在確認し、未使用 wasm の不在も見る。宣言と成果物の両方を突き合わせている",
    signals: { substringDominant: false, probesExternal: false, probesFs: true },
  },
  {
    file: "scripts/tools/check-cloudflare-neon-contract.js",
    grade: 4,
    issue: "open",
    why: "65 件の文字列一致。13 ファイルに所定の語が現れることだけを見ており、Cloudflare / Neon の実構成は参照しない",
    signals: { substringDominant: true, probesExternal: false, probesFs: true },
  },
  {
    file: "scripts/tools/check-dependency-audit.js",
    grade: 0,
    issue: "none",
    why: "npm audit を実行し、その出力に対して判定する。allowlist は expires / owner / tracking 必須の時限付きで、放置すると自動的に失効する",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
  },
  {
    file: "scripts/tools/check-doc-api-contract.js",
    grade: 4,
    issue: "open",
    why: "10 件の includes。文書に語が載っていることだけを見ており、API の実挙動とは無関係",
    signals: { substringDominant: true, probesExternal: false, probesFs: false },
  },
  {
    file: "scripts/tools/check-docker-release-contract.js",
    grade: 4,
    issue: "open",
    why: "44 件の requireText。Dockerfile / compose の記述文字列のみを見る。イメージのビルド可否や実挙動は検査しない",
    signals: { substringDominant: true, probesExternal: false, probesFs: false },
  },
  {
    file: "scripts/tools/check-duplicate-official-urls.js",
    grade: 0,
    issue: "none",
    why: "DB を実クエリして重複を数える。合否がデータから決まる",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
  },
  {
    file: "scripts/tools/check-github-actions-contract.js",
    grade: 4,
    issue: "open",
    why: "92 件の requireText。加えて SHA ピン検査の対象がハードコード列挙で、.github/workflows の全ファイルを覆っていない (下記 workflowFilesReadBy で導出)",
    signals: { substringDominant: true, probesExternal: false, probesFs: false },
  },
  {
    file: "scripts/tools/check-neon-backup-evidence.js",
    grade: null,
    issue: "remediating",
    why: "main では自己申告値を受理していた。backend の e199e64 が measured PITR 保持期間のみを受理する形へ是正済み (未マージ)。統合後に再分類すること",
    signals: { substringDominant: false, probesExternal: false, probesFs: false },
  },
  {
    file: "scripts/tools/check-openapi-route-coverage.js",
    grade: 0,
    issue: "none",
    why: "src/app/api を walk して route.ts を列挙し、未文書ルートで落ちる。網羅性が実ファイルから導出される良い型",
    signals: { substringDominant: false, probesExternal: false, probesFs: false },
  },
  {
    file: "scripts/tools/check-postgis-standard-record-ddl.js",
    grade: 0,
    issue: "none",
    why: "PostGIS の DDL を実 DB へ問い合わせて検証する",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
  },
  {
    file: "scripts/tools/check-postgresql-migration-drift.js",
    grade: 0,
    issue: "none",
    why: "prisma migrate diff を実行し、schema と migration の差分を実測する",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
  },
  {
    file: "scripts/tools/check-production-placeholders.js",
    grade: 0,
    issue: "none",
    why: "wrangler.jsonc を構造として解析し、期待値をこのファイル側の定数へピン留めしている。検査対象から期待値を導出していない",
    signals: { substringDominant: false, probesExternal: false, probesFs: false },
  },
  {
    file: "scripts/tools/check-standard-record-policy.js",
    grade: 0,
    issue: "none",
    why: "実クエリで標準レコードポリシーの違反件数を数える。合否がデータから決まる",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
  },
  {
    file: "scripts/tools/check-v1-standard-record-contract.js",
    grade: 4,
    issue: "open",
    why: "11 件の includes。schema / route / lib に所定のトークンが現れることだけを見る。$queryRaw 等の語はいずれも検索対象の文字列リテラルで、実クエリは行わない",
    signals: { substringDominant: true, probesExternal: false, probesFs: false },
  },
  {
    file: "scripts/tools/cloudflare-522-diagnostics.js",
    grade: null,
    issue: "none",
    why: "判定保留。障害時の診断補助であり、CI の必須チェックへ接続されていない。合否を出すゲートではないため 4 等級の枠に当てはめると誤った深刻度を与える",
    signals: { substringDominant: false, probesExternal: false, probesFs: false },
  },
  {
    file: "scripts/tools/compare-prisma-models.js",
    grade: 0,
    issue: "none",
    why: "SQLite / PostgreSQL 双方の schema を構造として解析し差分を出す。片側から期待値を作っていない",
    signals: { substringDominant: false, probesExternal: false, probesFs: false },
  },
  {
    file: "scripts/tools/create-neon-backup-evidence.js",
    grade: null,
    issue: "remediating",
    why: "main では restoreDrillStatus / pgDumpStatus が \"success\" 既定値を持ち、呼び出し側が上書きしないため構造的に失敗し得なかった (#126/#127)。backend の e199e64 で既定値を撤去済み (未マージ)",
    signals: { substringDominant: false, probesExternal: false, probesFs: true },
  },
  {
    file: "scripts/tools/post-release-status.js",
    grade: 0,
    issue: "none",
    why: "本番 URL へ実 HTTP を投げ、その応答から状態を組み立てる",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
  },
  {
    file: "scripts/tools/production-evidence-report.js",
    grade: null,
    issue: "remediating",
    why: "main では非空かつ非プレースホルダなら合格で、`ok` の 2 文字が全項目を通した (#128)。backend の e199e64 が EVIDENCE_FORMATS による形式検証へ是正済み (未マージ)",
    signals: { substringDominant: false, probesExternal: false, probesFs: true },
  },
  {
    file: "scripts/tools/release-gate.js",
    grade: null,
    issue: "none",
    why: "判定保留。各ゲートを子プロセスで順次実行する集約器であり、それ自体は合否を作らない。ただし『production env contract』ステップは合成リテラルに対する検査で、名称が本番構成の検査を示唆する (evidence-gate-audit.md #20 が是正不要と判断済み)",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
  },
  {
    file: "scripts/tools/release-smoke.js",
    grade: null,
    issue: "remediating",
    why: "main では CSP を文字列一致で検査しており、構成の緩和を取りこぼした (#129)。backend の e199e64 が csp-contract.js による契約検証へ置換済み (未マージ)",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
  },
  {
    file: "scripts/tools/validate-env.js",
    grade: 0,
    issue: "none",
    why: "環境変数の形式と必須性を検証する。期待値はこのファイル側に持つ",
    signals: { substringDominant: false, probesExternal: false, probesFs: true },
  },
  {
    file: "scripts/tools/validate-production-target-env.js",
    grade: 0,
    issue: "none",
    why: "本番ホスト名をリテラルとしてピン留めし、validate-env.js を子プロセスで再実行する。evidence-gate-audit.md が『良い型』として挙げている期待値ピン留め",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
  },
  {
    file: "scripts/deploy/deploy-production.mjs",
    grade: 2,
    issue: "assigned",
    why: "デプロイ前検証が失敗しても続行し得る箇所 (202-225 行付近) を CTO が backend へ T-B7 として割当済み。重複起票しない",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
  },
];

/** ゲートではないもの。理由を必ず持たせ、除外そのものを監査可能にする。 */
const NON_GATES: readonly { file: string; why: string }[] = [
  { file: "scripts/tools/prisma-client-loader.js", why: "Prisma クライアントの解決ヘルパー。合否判定を持たない" },
  { file: "scripts/tools/spawn-result.js", why: "子プロセス実行結果の整形ヘルパー" },
  { file: "scripts/tools/start-checked.js", why: "サーバ起動を待ち受けるヘルパー。合否判定を持たない" },
  { file: "scripts/tools/with-env.js", why: "環境変数を注入して他コマンドを起動するラッパー" },
  { file: "scripts/tools/run-ultrareview.js", why: "レビュー起動ツール。CI の合否には関与しない" },
  { file: "scripts/deploy/create-hyperdrive.mjs", why: "Hyperdrive のプロビジョニング操作。証跡の受理判定を持たない" },
  {
    file: "scripts/deploy/cloudflare-dns-record-policy.mjs",
    why: "DNS レコード計画を作る純関数。入力から出力を決めるだけで、証跡を受理・棄却する判定を持たない",
  },
];

type WorkflowEntry = {
  file: string;
  grade: Grade;
  issue: IssueState;
  why: string;
  /** ゲートを含む workflow か。false なら 4 等級の枠外 */
  isGate: boolean;
};

const WORKFLOWS: readonly WorkflowEntry[] = [
  {
    file: ".github/workflows/ci.yml",
    grade: 0,
    issue: "none",
    why: "verify job が lint / typecheck / test / build / gitleaks を無条件に実行し、失敗すればジョブが落ちる",
    isGate: true,
  },
  {
    file: ".github/workflows/codeql.yml",
    grade: 2,
    issue: "open",
    why: "analyze ステップが continue-on-error: true で、その outcome を見て落とし直すステップが無い。解析自体が失敗してもジョブは緑になり、『CodeQL が走った』が反証不能になる",
    isGate: true,
  },
  {
    file: ".github/workflows/data-ingestion.yml",
    grade: null,
    issue: "none",
    why: "判定保留。データ取込のバッチであり証跡ゲートではない。ただし SHA ピン検査の対象外である点は check-github-actions-contract.js 側の問題として扱う",
    isGate: false,
  },
  {
    file: ".github/workflows/data-ingestion-weather.yml",
    grade: null,
    issue: "none",
    why: "判定保留。気象データ取込のバッチであり証跡ゲートではない。SHA ピン検査の対象外である点は data-ingestion.yml と同じ扱い",
    isGate: false,
  },
  {
    file: ".github/workflows/neon-backup.yml",
    grade: null,
    issue: "remediating",
    why: "証跡生成と検査を担うが、生成側 (create-neon-backup-evidence.js) の是正が backend e199e64 で進行中のため等級を確定しない",
    isGate: true,
  },
  {
    file: ".github/workflows/production-smoke.yml",
    grade: 0,
    issue: "none",
    why: "continue-on-error は付くが、後段の Enforce production readiness が outcome == 'failure' で明示的に落とし直す。証跡を残しつつ失敗を握り潰さない対の型",
    isGate: true,
  },
];

// ---------------------------------------------------------------------------
// 3. 欠陥の導出
// ---------------------------------------------------------------------------

/**
 * `continue-on-error: true` を持ちながら、後続で outcome を見て落とし直す
 * ステップが無いものを列挙する。これがあるとジョブは構造的に失敗し得ない (等級2)。
 */
export function unpairedContinueOnError(yaml: string): string[] {
  const lines = yaml.split("\n");
  const unpaired: string[] = [];

  lines.forEach((line, index) => {
    if (!/^\s*continue-on-error:\s*true\s*$/.test(line)) return;

    // 直前のステップ開始 (`- ` 始まり) まで遡って id を探す
    let stepId: string | null = null;
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const current = lines[cursor];
      const idMatch = /^\s*id:\s*([\w-]+)\s*$/.exec(current);
      if (idMatch) {
        stepId = idMatch[1];
        break;
      }
      if (/^\s*-\s+\S/.test(current) && cursor !== index) break;
    }

    // id が無ければ誰も outcome を参照できない = 無条件に unpaired
    if (stepId === null) {
      unpaired.push(`line ${index + 1} (no step id)`);
      return;
    }
    const referenced = new RegExp(`steps\\.${stepId}\\.outcome`).test(yaml);
    if (!referenced) unpaired.push(`${stepId}`);
  });

  return unpaired;
}

/** check-github-actions-contract.js が実際に読み込んでいる workflow ファイル。 */
export function workflowFilesReadBy(source: string): string[] {
  return [...source.matchAll(/readNormalized\("(\.github\/workflows\/[\w.-]+)"\)/g)]
    .map((match) => match[1])
    .sort();
}

// ---------------------------------------------------------------------------
// テスト
// ---------------------------------------------------------------------------

describe("棚卸しは実ファイルを網羅する", () => {
  it("scripts/tools と scripts/deploy の全ファイルが分類済みか除外理由付きである", () => {
    const onDisk = [...listFiles("scripts/tools"), ...listFiles("scripts/deploy")].sort();
    const accounted = [...SCRIPT_GATES.map((gate) => gate.file), ...NON_GATES.map((entry) => entry.file)].sort();

    // 未分類 = 新しいゲートを足したのに等級を付けていない状態。ここで落とす
    expect(onDisk.filter((file) => !accounted.includes(file))).toEqual([]);
    // 亡霊 = 削除済みファイルの分類が残っている状態
    expect(accounted.filter((file) => !onDisk.includes(file))).toEqual([]);
  });

  it(".github/workflows の全ファイルが分類済みである", () => {
    const onDisk = listFiles(".github/workflows").filter((file) => /\.ya?ml$/.test(file));
    expect(WORKFLOWS.map((workflow) => workflow.file).sort()).toEqual(onDisk);
  });

  it("package.json の release:* / db:* が指すスクリプトがすべて棚卸しに載っている", () => {
    const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
    const referenced = new Set<string>();
    for (const [name, command] of Object.entries(packageJson.scripts)) {
      if (!/^(?:release|db|cf):/.test(name)) continue;
      for (const match of command.matchAll(/scripts\/(?:tools|deploy|db)\/[\w.-]+\.(?:js|mjs|sh)/g)) {
        referenced.add(match[0]);
      }
    }

    const accounted = new Set([
      ...SCRIPT_GATES.map((gate) => gate.file),
      ...NON_GATES.map((entry) => entry.file),
      // scripts/db は運用バッチ。ゲートではないため棚卸しの対象外
      "scripts/db/prune-operational-data.js",
    ]);

    expect([...referenced].filter((file) => !accounted.has(file)).sort()).toEqual([]);
  });

  it("除外理由は空文字や一言で済ませられない", () => {
    for (const entry of NON_GATES) {
      expect(entry.why.length, `${entry.file} の除外理由が短すぎる`).toBeGreaterThan(15);
    }
  });
});

describe("宣言した信号がソースから導出した値と一致する", () => {
  it.each(SCRIPT_GATES)("$file", (gate) => {
    expect(deriveSignals(read(gate.file))).toEqual(gate.signals);
  });
});

describe("等級の基準が機械可読である", () => {
  it("等級4 と substringDominant は同値である", () => {
    // 片側だけの主張にしない。substringDominant なのに等級4 でない項目も、
    // 等級4 なのに実測経路を持つ項目も、どちらもここで落ちる
    for (const gate of SCRIPT_GATES) {
      expect(gate.signals.substringDominant, `${gate.file} の等級と信号が矛盾している`).toBe(gate.grade === 4);
    }
  });

  it("適合 (等級0) と判定したものは必ず実測経路を持つ", () => {
    const compliant = SCRIPT_GATES.filter((gate) => gate.grade === 0);
    for (const gate of compliant) {
      const measured = gate.signals.probesExternal || gate.signals.probesFs;
      // 実測経路を持たずに適合と判定してよいのは、期待値をピン留めして
      // 検査対象を構造解析するものだけ。その旨を why に書かせる
      const pinsExpectations = /ピン留め|構造として解析|walk/.test(gate.why);
      expect(measured || pinsExpectations, `${gate.file} を適合と判定した根拠が why に無い`).toBe(true);
    }
  });

  it("判定保留は理由を伴う", () => {
    for (const entry of [...SCRIPT_GATES, ...WORKFLOWS]) {
      if (entry.grade !== null) continue;
      expect(entry.why.length, `${entry.file} の判定保留に理由が無い`).toBeGreaterThan(30);
    }
  });

  it("是正進行中の項目は参照先 commit を挙げている", () => {
    const remediating = [...SCRIPT_GATES, ...WORKFLOWS].filter((entry) => entry.issue === "remediating");
    expect(remediating.length).toBeGreaterThan(0);
    for (const entry of remediating) {
      expect(/\b[0-9a-f]{7,40}\b/.test(entry.why), `${entry.file} に是正 commit の参照が無い`).toBe(true);
      // 等級を確定させたまま "是正中" にすると、統合後にどちらが正か分からなくなる
      expect(entry.grade, `${entry.file} は是正中なので等級を確定させない`).toBeNull();
    }
  });
});

describe("未是正として報告した欠陥が現物から導出できる", () => {
  it("codeql.yml の analyze は落とし直されない (等級2)", () => {
    expect(unpairedContinueOnError(read(".github/workflows/codeql.yml"))).not.toEqual([]);
  });

  it("production-smoke.yml は continue-on-error を対で使っている (誤検知しないこと)", () => {
    // この 2 件が同じ判定になるなら、上の検査は「continue-on-error があるか」しか
    // 見ていないことになり、証跡を残すための正当な用法まで欠陥に数えてしまう
    expect(unpairedContinueOnError(read(".github/workflows/production-smoke.yml"))).toEqual([]);
  });

  it("unpaired と判定された workflow は棚卸しでも等級2 になっている", () => {
    for (const workflow of WORKFLOWS) {
      if (!workflow.isGate) continue;
      const unpaired = unpairedContinueOnError(read(workflow.file));
      if (unpaired.length > 0) {
        expect(workflow.grade, `${workflow.file} に unpaired continue-on-error がある`).toBe(2);
      }
    }
  });

  it("SHA ピン検査の対象が .github/workflows を覆っていない", () => {
    const inspected = workflowFilesReadBy(read("scripts/tools/check-github-actions-contract.js"));
    const onDisk = listFiles(".github/workflows").filter((file) => /\.ya?ml$/.test(file));
    const uninspected = onDisk.filter((file) => !inspected.includes(file));

    // 網羅対象がハードコード列挙である限り、workflow を足しても検査は増えない。
    // 是正されて全ファイルを走査する形になったら、この期待も更新すること
    expect(uninspected.length, "検査対象が全 workflow を覆うようになったなら棚卸しを更新すること").toBeGreaterThan(0);
    expect(inspected.length).toBeLessThan(onDisk.length);
  });
});

describe("Issue 起票対象が棚卸しから決まる", () => {
  it("未是正の等級2-4 だけが open である", () => {
    for (const entry of [...SCRIPT_GATES, ...WORKFLOWS]) {
      if (entry.issue !== "open") continue;
      expect(entry.grade, `${entry.file} を open にするなら等級2-4 であること`).toBeGreaterThanOrEqual(2);
    }
  });

  it("既知 (#126-#129 / T-B7) は assigned で、重複起票しない", () => {
    const assigned = [...SCRIPT_GATES, ...WORKFLOWS].filter((entry) => entry.issue === "assigned");
    for (const entry of assigned) {
      expect(/#\d{2,}|T-[A-Z]\d/.test(entry.why), `${entry.file} に割当先の参照が無い`).toBe(true);
    }
  });

  it("すべての項目が根拠を持つ", () => {
    for (const entry of [...SCRIPT_GATES, ...WORKFLOWS]) {
      expect(entry.why.length, `${entry.file} の根拠が短すぎる`).toBeGreaterThan(25);
    }
  });
});
