import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * 証跡ゲートの「自己申告系統」棚卸し (T-Q6 / Issue #126-#129 の再発防止)。
 *
 * #126-#129 で潰した欠陥は同一系統で、深刻度が 4 段階ある。
 *   等級1 自己申告      … 人が書いた文字列をそのまま証跡にする
 *   等級2 検査経路の閉塞 … 合格側の既定値が固定され、呼び出し側が上書きできない
 *     └ 下位型 scope-self-derived … 検査範囲を期待値から導出しているため、
 *        経路自体は開いているのに範囲外が構造的に見えない (後述)
 *   等級3 内容非検証    … 空でなくプレースホルダでなければ何でも合格
 *   等級4 部分一致で網羅を主張 … 文言 includes だけで「契約を満たす」と主張する
 *
 * 4 等級に当てはまらないものは、空欄にせず次の 2 語で明示する。
 *   判定不能 … ゲートの形をしているが、どの workflow からも結線されておらず
 *              CI 上で合否を作る場面が無い (runsOn === "unwired" で導出)
 *   枠外     … そもそも合否を作らない (isGate === false で導出)
 * null を残さないのは、「まだ見ていない」と「見たが決められない」が区別できず、
 * 監査表としては空欄と同義になるためである (CTO 裁定 2026-08-12)。
 *
 * ■ このテストが「分類を散文で書いただけ」に堕ちないための構造
 *
 * 分類表をここへ書き写すだけなら、それ自体が等級1 になる (人が書いた文字列が
 * 唯一の供給元)。よって本テストは 4 点をコード側から導出して突き合わせる。
 *
 *   1. 信号の導出 (deriveSignals)
 *      各ゲートが「文字列一致だけで判定しているか」「外部/ファイルシステムを
 *      実測しているか」をソースから算出し、宣言値と一致することを要求する。
 *
 *   2. 網羅性の導出 (completeness by scan)
 *      scripts/tools, scripts/deploy, .github/workflows を実際に読み、
 *      package.json の release:* / db:* が指すスクリプトも解決して、
 *      「棚卸しに載っていない実行可能ゲート」が 1 つも無いことを要求する。
 *
 *   3. 欠陥の導出 (unpairedContinueOnError / workflowFilesReadBy / defect)
 *      等級1 以上と判定した項目は、その欠陥が **本ブランチの現物に今も在る**
 *      ことを正規表現で示す。是正が統合されたら一致しなくなり、テストが落ちて
 *      再分類が強制される。「是正中だから保留」で等級を空にしない。
 *
 *   4. 実行条件の導出 (deriveRunsOn)
 *      package.json → workflow YAML → job → job の if: → workflow の on:
 *      を辿り、そのゲートが「PR で毎回走る」のか「workflow_dispatch を叩いた
 *      ときだけ走る」のか「どこからも呼ばれない」のかを算出する。
 *      skip する検査を「検査済み」の母集団へ黙って含めないための列である。
 *
 * ■ 意図的にやっていないこと
 *
 *   - docs/security/evidence-gate-audit.md との突き合わせは
 *     tests/unit/evidence-gate-audit-contract.test.ts の役割で、
 *     こちらは文書ではなく **実ファイルの網羅** を受け持つ。重複させない。
 *   - deriveRunsOn は npm script を 1 段しか辿らない。合成 script が更に別の
 *     script を呼ぶ経路 (cf:deploy:production 等) は追わない。本リポジトリでは
 *     合成 script 自体が workflow から呼ばれていないため結論は変わらないが、
 *     「追っていない」ことは限界として明記しておく。
 *   - この 4 等級は「合否の作り方が甘い」側 (偽 PASS) だけを測る尺度である。
 *     「検査は厳密だが測っている対象が意図とずれている」側 (偽 FAIL。正しい成果物を
 *     落とす) は原因が別で、混ぜると等級の大小が意味を失うため本表には載せない。
 *     ただし偽 PASS 側にも現れる亜種 —— 検査範囲を期待値から導出している型 ——
 *     だけは scopeSelfDerived として下位型に持つ (CTO 提案 2026-08-12 のうち A)。
 *   - runsOn は **ファイルが走るか** を測っており、**その検査が走るか** ではない。
 *     同じファイルが無条件 job と条件付き job の両方から、別々の引数で呼ばれる場合、
 *     条件付き側の検査モードは PR で一度も評価されない。この差は下記
 *     stepConditionalInvocations が実測で押さえる (reusable workflow / composite
 *     action / matrix は本リポジトリに存在しないことを確認済み)。
 */

const repoRoot = path.resolve(import.meta.dirname, "..", "..");
const read = (relativePath: string) => readFileSync(path.join(repoRoot, relativePath), "utf8");
const listFiles = (relativeDir: string) =>
  readdirSync(path.join(repoRoot, relativeDir), { withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => `${relativeDir}/${entry.name}`)
    .sort();
const workflowFilesOnDisk = () => listFiles(".github/workflows").filter((file) => /\.ya?ml$/.test(file));

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
// 2. 実行条件の導出
// ---------------------------------------------------------------------------

type RunsOn =
  /** 条件の付かない job から呼ばれ、pull_request / push で毎回走る */
  | "pr"
  /** 条件付き job にしか結線されておらず、その条件を満たさない限り走らない */
  | "dispatch-only"
  /** schedule 起動の workflow でしか走らない */
  | "scheduled"
  /** どの workflow からも呼ばれない。人が手で実行したときだけ走る */
  | "unwired";

type WorkflowShape = {
  file: string;
  /** on: 直下のキー (push / pull_request / schedule / workflow_dispatch) */
  triggers: string[];
  jobs: { name: string; conditional: boolean; body: string }[];
};

/**
 * workflow YAML をインデント段数だけで読む。YAML パーサを足さないのは、
 * ここで必要なのが「job 直下に if: があるか」「on: に何が並ぶか」の 2 点だけで、
 * 依存を 1 つ増やすほどの情報ではないため。
 */
export function parseWorkflowShape(file: string, yaml: string): WorkflowShape {
  const triggers: string[] = [];
  const jobs: WorkflowShape["jobs"] = [];
  let section: "none" | "on" | "jobs" = "none";
  let current: WorkflowShape["jobs"][number] | null = null;

  for (const line of yaml.split("\n")) {
    if (/^on:/.test(line)) {
      section = "on";
      current = null;
      continue;
    }
    if (/^jobs:/.test(line)) {
      section = "jobs";
      current = null;
      continue;
    }
    if (/^\S/.test(line)) {
      section = "none";
      current = null;
      continue;
    }

    if (section === "on") {
      const trigger = /^ {2}([a-z_]+):/.exec(line);
      if (trigger) triggers.push(trigger[1]);
      continue;
    }
    if (section === "jobs") {
      const job = /^ {2}([a-z][\w-]*):\s*$/.exec(line);
      if (job) {
        current = { name: job[1], conditional: false, body: "" };
        jobs.push(current);
        continue;
      }
      if (!current) continue;
      // job 直下 (4 スペース) の if: だけを見る。step の if: は更に深い
      if (/^ {4}if:/.test(line)) current.conditional = true;
      current.body += `${line}\n`;
    }
  }

  return { file, triggers, jobs };
}

/** package.json のうち、そのスクリプトファイルを直接起動する npm script 名。 */
function npmScriptsInvoking(file: string): string[] {
  const packageJson = JSON.parse(read("package.json")) as { scripts: Record<string, string> };
  return Object.entries(packageJson.scripts)
    .filter(([, command]) => command.includes(file))
    .map(([name]) => name);
}

type Invocation = { workflow: string; job: string; conditional: boolean; triggers: string[] };

/** そのスクリプトを起動している (workflow, job) を列挙する。 */
export function invocationsOf(file: string): Invocation[] {
  const names = npmScriptsInvoking(file);
  // 名前の前方一致で別 script を拾わないよう、直後に名前構成文字が来ないことを要求する
  const patterns = names.map(
    (name) => new RegExp(`npm run (?:--silent )?${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w:.-])`),
  );

  const invocations: Invocation[] = [];
  for (const workflow of workflowFilesOnDisk()) {
    const shape = parseWorkflowShape(workflow, read(workflow));
    for (const job of shape.jobs) {
      const invoked = job.body.includes(file) || patterns.some((pattern) => pattern.test(job.body));
      if (invoked) {
        invocations.push({
          workflow,
          job: job.name,
          conditional: job.conditional,
          triggers: shape.triggers,
        });
      }
    }
  }
  return invocations;
}

export function deriveRunsOn(file: string): RunsOn {
  const invocations = invocationsOf(file);
  if (invocations.length === 0) return "unwired";
  if (invocations.some((hit) => !hit.conditional && hit.triggers.includes("pull_request"))) return "pr";
  if (invocations.some((hit) => hit.triggers.includes("schedule"))) return "scheduled";
  return "dispatch-only";
}

/**
 * step 単位の if: が付いた起動を列挙する。
 *
 * runsOn はファイル単位の粒度しか持たないため、「同じゲートを別の引数で呼ぶ
 * 条件付きステップ」は runsOn === "pr" の陰に隠れる。ここで実測して可視化する。
 */
export function stepConditionalInvocations(file: string, yaml: string): string[] {
  const lines = yaml.split("\n");
  const found: string[] = [];
  lines.forEach((line, index) => {
    if (!/npm run /.test(line)) return;
    // 直前行が step レベル (6 スペース以上) の if: なら、その起動は条件付き
    if (index > 0 && /^ {6,}if:/.test(lines[index - 1])) {
      found.push(`${file}:${index + 1}`);
    }
  });
  return found;
}

/** workflow 自身の実行条件は on: だけで決まる。 */
export function deriveWorkflowRunsOn(file: string): RunsOn {
  const { triggers } = parseWorkflowShape(file, read(file));
  if (triggers.includes("pull_request")) return "pr";
  if (triggers.includes("schedule")) return "scheduled";
  return "dispatch-only";
}

// ---------------------------------------------------------------------------
// 3. 棚卸し
// ---------------------------------------------------------------------------

/**
 * 0 = 適合 (実測に基づく)、1-4 = 上記の等級。
 * "判定不能" / "枠外" は 4 等級の母集団に入らないことの明示であって、空欄ではない。
 */
type Grade = 0 | 1 | 2 | 3 | 4 | "判定不能" | "枠外";

type IssueState =
  /** 本リポジトリで未是正。Issue 起票対象 */
  | "open"
  /** 別ブランチで是正が進行中。等級は本ブランチの現物に対して付ける */
  | "remediating"
  /** 既に担当者へ割当済み (#126-#129 / T-B7 等)。重複起票しない */
  | "assigned"
  /** 是正不要 */
  | "none";

/**
 * 「その欠陥が本ブランチの現物に今も在る」ことを示す証拠。
 * 等級1 以上には substringDominant か、これのどちらかを必ず要求する。
 */
type Defect = { pattern: RegExp; means: string };

type GateEntry = {
  file: string;
  grade: Grade;
  issue: IssueState;
  why: string;
  signals: Signals;
  runsOn: RunsOn;
  /** runsOn !== "pr" のとき、走らない間に何が未検査になるか。"pr" のときは空 */
  notRunMeans: string;
  defect?: Defect;
  /** 等級2 の下位型「検査範囲を期待値から導出している」に該当する */
  scopeSelfDerived?: boolean;
};

const SCRIPT_GATES: readonly GateEntry[] = [
  {
    file: "scripts/tools/check-audit-contract.js",
    grade: 4,
    issue: "open",
    why: "17 件すべてが requireText。監査ログ保証の『契約』を名乗るが、ADR や実装へ該当語を 1 行書けば充足する。監査が実際に記録されるかは一切見ていない",
    signals: { substringDominant: true, probesExternal: false, probesFs: false },
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: "scripts/tools/check-cloudflare-build-artifact.js",
    grade: 0,
    issue: "none",
    why: "wrangler.jsonc が宣言したパスを statSync で実在確認し、未使用 wasm の不在も見る。宣言と成果物の両方を突き合わせている",
    signals: { substringDominant: false, probesExternal: false, probesFs: true },
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: "scripts/tools/check-cloudflare-neon-contract.js",
    grade: 4,
    issue: "open",
    why: "65 件の文字列一致。13 ファイルに所定の語が現れることだけを見ており、Cloudflare / Neon の実構成は参照しない",
    signals: { substringDominant: true, probesExternal: false, probesFs: true },
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: "scripts/tools/check-dependency-audit.js",
    grade: 0,
    issue: "none",
    why: "npm audit を実行し、その出力に対して判定する。allowlist は expires / owner / tracking 必須の時限付きで、放置すると自動的に失効する",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: "scripts/tools/check-doc-api-contract.js",
    grade: 4,
    issue: "open",
    why: "10 件の includes。文書に語が載っていることだけを見ており、API の実挙動とは無関係",
    signals: { substringDominant: true, probesExternal: false, probesFs: false },
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: "scripts/tools/check-docker-release-contract.js",
    grade: 4,
    issue: "open",
    why: "44 件の requireText。Dockerfile / compose の記述文字列のみを見る。イメージのビルド可否や実挙動は検査しない",
    signals: { substringDominant: true, probesExternal: false, probesFs: false },
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: "scripts/tools/check-duplicate-official-urls.js",
    grade: 0,
    issue: "none",
    why: "DB を実クエリして重複を数える。合否がデータから決まる",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: "scripts/tools/check-github-actions-contract.js",
    grade: 4,
    issue: "open",
    why: "92 件の requireText。加えて SHA ピン検査の対象がハードコード列挙で、.github/workflows の全ファイルを覆っていない (下記 workflowFilesReadBy で導出)。等級2 下位型 scope-self-derived にも該当する",
    signals: { substringDominant: true, probesExternal: false, probesFs: false },
    runsOn: "pr",
    notRunMeans: "",
    scopeSelfDerived: true,
  },
  {
    file: "scripts/tools/check-neon-backup-evidence.js",
    grade: 1,
    issue: "remediating",
    why: "本ブランチでは restoreDrillStatus が \"success\" かどうかを文字列比較するだけで、その値は create-neon-backup-evidence.js が自己申告したもの。人が書いた文字列がそのまま証跡になる (#126/#127)。backend の e199e64 が measured PITR 保持期間のみを受理する形へ是正済み (未マージ)",
    signals: { substringDominant: false, probesExternal: false, probesFs: false },
    runsOn: "scheduled",
    notRunMeans:
      "neon-backup.yml の定期実行でしか走らない。PR では一度も評価されないため、証跡の受理条件を緩める変更を入れても、次の定期実行まで検知されない",
    defect: {
      pattern: /restoreDrillStatus is success/,
      means: "自己申告値との文字列比較が合否そのものになっている",
    },
  },
  {
    file: "scripts/tools/check-openapi-route-coverage.js",
    grade: 0,
    issue: "none",
    why: "src/app/api を walk して route.ts を列挙し、未文書ルートで落ちる。網羅性が実ファイルから導出される良い型",
    signals: { substringDominant: false, probesExternal: false, probesFs: false },
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: "scripts/tools/check-postgis-standard-record-ddl.js",
    grade: 0,
    issue: "none",
    why: "PostGIS の DDL を実 DB へ問い合わせて検証する",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: "scripts/tools/check-postgresql-migration-drift.js",
    grade: 0,
    issue: "none",
    why: "prisma migrate diff を実行し、schema と migration の差分を実測する",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: "scripts/tools/check-production-placeholders.js",
    grade: 0,
    issue: "none",
    why: "wrangler.jsonc を構造として解析し、期待値をこのファイル側の定数へピン留めしている。検査対象から期待値を導出していない",
    signals: { substringDominant: false, probesExternal: false, probesFs: false },
    runsOn: "dispatch-only",
    notRunMeans:
      "ci.yml の production-target-env job (if: workflow_dispatch) にしか結線されていない。通常の PR / push では走らず、wrangler.jsonc へプレースホルダが混入したまま main へ入っても CI は緑になる",
  },
  {
    file: "scripts/tools/check-standard-record-policy.js",
    grade: 0,
    issue: "none",
    why: "実クエリで標準レコードポリシーの違反件数を数える。合否がデータから決まる",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: "scripts/tools/check-v1-standard-record-contract.js",
    grade: 4,
    issue: "open",
    why: "11 件の includes。schema / route / lib に所定のトークンが現れることだけを見る。$queryRaw 等の語はいずれも検索対象の文字列リテラルで、実クエリは行わない",
    signals: { substringDominant: true, probesExternal: false, probesFs: false },
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: "scripts/tools/cloudflare-522-diagnostics.js",
    grade: "判定不能",
    issue: "none",
    why: "判定不能。どの workflow からも呼ばれておらず (runsOn === \"unwired\" で導出)、CI 上で合否を作る場面が無い。障害時に人が手で叩く診断補助であり、4 等級は『合否の作り方の欠陥度』を測る尺度なので当てはめると誤った深刻度を与える",
    signals: { substringDominant: false, probesExternal: false, probesFs: false },
    runsOn: "unwired",
    notRunMeans:
      "CI では一度も走らない。人が障害時に手で実行したときだけ動くため、この診断ロジックが壊れていても誰も気付かない。壊れて困るのは障害対応中という最悪の時点である",
  },
  {
    file: "scripts/tools/compare-prisma-models.js",
    grade: 0,
    issue: "none",
    why: "SQLite / PostgreSQL 双方の schema を構造として解析し差分を出す。片側から期待値を作っていない",
    signals: { substringDominant: false, probesExternal: false, probesFs: false },
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: "scripts/tools/create-neon-backup-evidence.js",
    grade: 2,
    issue: "remediating",
    why: "本ブランチでは restoreDrillStatus / pgDumpStatus が \"success\" 既定値を持ち、呼び出し側が上書きしないため構造的に失敗し得ない。合格側の既定値が固定された検査経路の閉塞そのもの (#126/#127)。backend の e199e64 で既定値を撤去済み (未マージ)",
    signals: { substringDominant: false, probesExternal: false, probesFs: true },
    runsOn: "scheduled",
    notRunMeans:
      "neon-backup.yml の定期実行でしか走らない。PR では評価されないため、既定値の撤去が本当に効いているかは次の定期実行まで確認できない",
    defect: {
      pattern: /(?:restoreDrillStatus|pgDumpStatus):\s*"success"/,
      means: "合格側の既定値がリテラルとして固定されている",
    },
  },
  {
    file: "scripts/tools/post-release-status.js",
    grade: 0,
    issue: "none",
    why: "本番 URL へ実 HTTP を投げ、その応答から状態を組み立てる",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
    runsOn: "scheduled",
    notRunMeans:
      "production-smoke.yml の定期実行と workflow_dispatch でのみ走る。PR では走らないため、本番監視ロジック自体の退行は定期実行が回るまで検知されない",
  },
  {
    file: "scripts/tools/production-evidence-report.js",
    grade: 3,
    issue: "remediating",
    why: "本ブランチでは非空かつ非プレースホルダなら合格で、`ok` の 2 文字が 7 項目すべてを通す。内容非検証の典型 (#128)。backend の e199e64 が EVIDENCE_FORMATS による形式検証へ是正済み (未マージ)",
    signals: { substringDominant: false, probesExternal: false, probesFs: true },
    runsOn: "dispatch-only",
    notRunMeans:
      "ci.yml の production-target-env job (if: workflow_dispatch) にしか結線されていない。#128 の形式ゲートは現状この job 経由でしか動かないため、workflow_dispatch を叩かない限り証跡の形式は一度も検査されない。是正が入っても、走らない間はその是正も効いていない",
    defect: {
      pattern: /return "✅ set \(recorded\)"/,
      means: "空でもプレースホルダでもなければ内容を問わず合格を返す",
    },
  },
  {
    file: "scripts/tools/release-gate.js",
    grade: "判定不能",
    issue: "none",
    why: "判定不能。npm script release:gate は存在するが、どの workflow からも呼ばれていない (runsOn === \"unwired\" で導出)。集約器自身が合否を作らないうえ CI に結線されておらず、等級を付ける母集団に入らない。『production env contract』ステップが合成リテラルに対する検査である点は evidence-gate-audit.md #20 が是正不要と判断済み",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
    runsOn: "unwired",
    notRunMeans:
      "リリース集約ゲートを名乗るが CI からは一度も呼ばれない。名前から『リリース前に全ゲートが束ねて走る』と読めるのに実体が無い点は、CTO / backend へ確認が要る (本棚卸しの新規発見)",
  },
  {
    file: "scripts/tools/release-smoke.js",
    grade: 4,
    issue: "remediating",
    why: "本ブランチでは CSP の合否を csp.includes の羅列で決めており、列挙外の緩和 (未知ディレクティブの追加、許可元の差し替え) を取りこぼす。部分一致で網羅を主張する型 (#129)。実 HTTP を投げるため substringDominant は false だが、判定そのものは文字列一致である。backend の e199e64 が csp-contract.js による契約検証へ置換済み (未マージ)",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
    runsOn: "pr",
    notRunMeans: "",
    defect: {
      pattern: /csp\.includes\(/,
      means: "CSP の合否を文字列の部分一致で決めている",
    },
  },
  {
    file: "scripts/tools/validate-env.js",
    grade: 0,
    issue: "none",
    why: "環境変数の形式と必須性を検証する。期待値はこのファイル側に持つ",
    signals: { substringDominant: false, probesExternal: false, probesFs: true },
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: "scripts/tools/validate-production-target-env.js",
    grade: 0,
    issue: "none",
    why: "本番ホスト名をリテラルとしてピン留めし、validate-env.js を子プロセスで再実行する。evidence-gate-audit.md が『良い型』として挙げている期待値ピン留め",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
    runsOn: "dispatch-only",
    notRunMeans:
      "ci.yml の production-target-env job (if: workflow_dispatch) にしか結線されていない。本番向け環境変数の不整合は、workflow_dispatch を叩くか cf:deploy:production を人が実行するまで検知されない",
  },
  {
    file: "scripts/deploy/deploy-production.mjs",
    grade: 2,
    issue: "assigned",
    why: "デプロイ前検証が失敗しても続行し得る箇所 (202-225 行付近) を CTO が backend へ T-B7 として割当済み。重複起票しない",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
    runsOn: "unwired",
    notRunMeans:
      "workflow からは呼ばれず、人が手で実行する本番デプロイ経路。CI で一度も実行されないため、この検証分岐の退行はデプロイ当日まで現れない",
    defect: {
      pattern: /process\.env\[key\]\?\.trim\(\) \|\| fallback/,
      means: "証跡が未設定でも evidenceDefaults の既定文字列で埋めて続行する",
    },
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
  runsOn: RunsOn;
  notRunMeans: string;
};

const WORKFLOWS: readonly WorkflowEntry[] = [
  {
    file: ".github/workflows/ci.yml",
    grade: 0,
    issue: "none",
    why: "verify job が lint / typecheck / test / build / gitleaks を無条件に実行し、失敗すればジョブが落ちる。ただし production-target-env job だけは if: workflow_dispatch で、そこにしか結線されていない検査 (#128 の形式ゲートを含む 3 件) は PR では走らない",
    isGate: true,
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: ".github/workflows/codeql.yml",
    grade: 2,
    issue: "open",
    why: "analyze ステップが continue-on-error: true で、その outcome を見て落とし直すステップが無い。解析自体が失敗してもジョブは緑になり、『CodeQL が走った』が反証不能になる",
    isGate: true,
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: ".github/workflows/data-ingestion.yml",
    grade: "枠外",
    issue: "none",
    why: "枠外。データ取込のバッチであり証跡を受理・棄却するゲートを含まない (isGate === false)。SHA ピン検査の対象外である点は check-github-actions-contract.js 側の問題として扱う",
    isGate: false,
    runsOn: "scheduled",
    notRunMeans:
      "定期実行と workflow_dispatch でのみ動く。ゲートではないため未検査になる証跡は無いが、取込の失敗自体は定期実行が回るまで現れない",
  },
  {
    file: ".github/workflows/data-ingestion-weather.yml",
    grade: "枠外",
    issue: "none",
    why: "枠外。気象データ取込のバッチであり証跡を受理・棄却するゲートを含まない (isGate === false)。SHA ピン検査の対象外である点は data-ingestion.yml と同じ扱い",
    isGate: false,
    runsOn: "scheduled",
    notRunMeans:
      "定期実行と workflow_dispatch でのみ動く。ゲートではないため未検査になる証跡は無いが、取込の失敗自体は定期実行が回るまで現れない",
  },
  {
    file: ".github/workflows/neon-backup.yml",
    grade: 0,
    issue: "none",
    why: "continue-on-error を 1 つも持たず、証跡生成の直後に check-neon-backup-evidence.js を実行して失敗すればジョブが落ちる。workflow としての結線は健全で、証跡の質の問題は生成側スクリプト (等級2) と検査側スクリプト (等級1) に帰属させる",
    isGate: true,
    runsOn: "scheduled",
    notRunMeans:
      "定期実行と workflow_dispatch でのみ動く。バックアップ証跡の生成も検査も PR では一度も走らないため、両スクリプトの退行は次の定期実行まで検知されない",
  },
  {
    file: ".github/workflows/production-smoke.yml",
    grade: 0,
    issue: "none",
    why: "continue-on-error は付くが、後段の Enforce production readiness が outcome == 'failure' で明示的に落とし直す。証跡を残しつつ失敗を握り潰さない対の型",
    isGate: true,
    runsOn: "scheduled",
    notRunMeans:
      "定期実行と workflow_dispatch でのみ動く。本番監視は PR では走らないため、この workflow 自身の結線が壊れても次の定期実行まで気付けない",
  },
];

// ---------------------------------------------------------------------------
// 4. 欠陥の導出
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

/**
 * 等級2 下位型 scope-self-derived の導出器。
 *
 * 「検査範囲を期待値から導出している」検査は、経路が開いていても範囲外が
 * 構造的に見えない。散文で下位型を主張すると等級1 になるので、該当を主張する
 * 項目には必ずここへ導出器を置き、実際に取りこぼしが在ることを示す。
 */
const SCOPE_SELF_DERIVED_PROOFS: Record<string, () => boolean> = {
  "scripts/tools/check-github-actions-contract.js": () => {
    const inspected = workflowFilesReadBy(read("scripts/tools/check-github-actions-contract.js"));
    return inspected.length < workflowFilesOnDisk().length;
  },
};

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
    expect(WORKFLOWS.map((workflow) => workflow.file).sort()).toEqual(workflowFilesOnDisk());
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

describe("宣言した実行条件が package.json と workflow から導出した値と一致する", () => {
  it.each(SCRIPT_GATES)("$file は $runsOn", (gate) => {
    expect(deriveRunsOn(gate.file)).toBe(gate.runsOn);
  });

  it.each(WORKFLOWS)("$file は $runsOn", (workflow) => {
    expect(deriveWorkflowRunsOn(workflow.file)).toBe(workflow.runsOn);
  });

  it("PR で走らないものは、走らない間に何が未検査になるかを書いている", () => {
    for (const entry of [...SCRIPT_GATES, ...WORKFLOWS]) {
      if (entry.runsOn === "pr") {
        // 常に走るものに「走らないときの影響」を書くと、実態と読み手の理解がずれる
        expect(entry.notRunMeans, `${entry.file} は PR で毎回走るので notRunMeans は空にする`).toBe("");
        continue;
      }
      expect(
        entry.notRunMeans.length,
        `${entry.file} は ${entry.runsOn} なので、走らない間に何が未検査になるかを書くこと`,
      ).toBeGreaterThan(30);
    }
  });

  it("実行条件はファイル単位であり、検査モード単位ではない", () => {
    // runsOn === "pr" は「そのファイルが PR で走る」しか意味しない。
    // 同じファイルを別の引数で呼ぶ条件付きステップがある限り、その検査モードは
    // PR で一度も評価されず、しかも runsOn 列には現れない。
    // 現物: ci.yml の release:smoke --expect-standard-records は
    // job (workflow_dispatch) と step の二重条件下にあり、PR では走らない
    const conditional = workflowFilesOnDisk().flatMap((file) =>
      stepConditionalInvocations(file, read(file)),
    );
    expect(
      conditional.length,
      "条件付きステップが 0 件になったなら、この限界の記述ごと見直すこと",
    ).toBeGreaterThan(0);

    const ciYaml = read(".github/workflows/ci.yml").split("\n");
    const modes = stepConditionalInvocations(".github/workflows/ci.yml", ciYaml.join("\n")).map(
      (hit) => ciYaml[Number(hit.split(":")[1]) - 1].trim(),
    );
    expect(modes.join("\n")).toContain("--expect-standard-records");
  });

  it("条件付きでしか走らないゲートが実在する (検査自体が空振りしていないこと)", () => {
    // ここが 0 件になるなら deriveRunsOn が全件 "pr" へ退化している疑いがある。
    // #128 の形式ゲートがこの群に居ることが、本列を足した理由そのもの
    const dispatchOnly = SCRIPT_GATES.filter((gate) => gate.runsOn === "dispatch-only").map((gate) => gate.file);
    expect(dispatchOnly).toContain("scripts/tools/production-evidence-report.js");
    expect(dispatchOnly.length).toBeGreaterThanOrEqual(2);
    expect(SCRIPT_GATES.some((gate) => gate.runsOn === "unwired")).toBe(true);
    expect(SCRIPT_GATES.some((gate) => gate.runsOn === "pr")).toBe(true);
  });
});

describe("等級の基準が機械可読である", () => {
  it("substringDominant なものは必ず等級4 である", () => {
    for (const gate of SCRIPT_GATES) {
      if (!gate.signals.substringDominant) continue;
      expect(gate.grade, `${gate.file} は文字列一致だけで判定している`).toBe(4);
    }
  });

  it("等級1 以上と判定した項目は、その欠陥が本ブランチの現物に今も在る", () => {
    // 「是正が別ブランチで進行中だから保留」を許すと、等級表が宣言だけになる。
    // 是正が統合された時点でここが落ち、再分類が強制される
    const graded = SCRIPT_GATES.filter((gate) => typeof gate.grade === "number" && gate.grade >= 1);
    expect(graded.length).toBeGreaterThan(0);
    for (const gate of graded) {
      if (gate.signals.substringDominant) continue;
      expect(gate.defect, `${gate.file} を等級${gate.grade} とする根拠が導出できない`).toBeDefined();
      expect(
        gate.defect!.pattern.test(read(gate.file)),
        `${gate.file}: ${gate.defect!.means} — 現物に一致しない。是正済みなら等級を付け直すこと`,
      ).toBe(true);
      expect(gate.defect!.means.length).toBeGreaterThan(10);
    }
  });

  it("適合 (等級0) と判定したものは実測経路を持ち、欠陥の証拠を持たない", () => {
    for (const gate of SCRIPT_GATES.filter((entry) => entry.grade === 0)) {
      expect(gate.signals.substringDominant, `${gate.file} が等級0 と矛盾する`).toBe(false);
      expect(gate.defect, `${gate.file} は等級0 なのに欠陥の証拠を持っている`).toBeUndefined();
      const measured = gate.signals.probesExternal || gate.signals.probesFs;
      // 実測経路を持たずに適合と判定してよいのは、期待値をピン留めして
      // 検査対象を構造解析するものだけ。その旨を why に書かせる
      const pinsExpectations = /ピン留め|構造として解析|walk/.test(gate.why);
      expect(measured || pinsExpectations, `${gate.file} を適合と判定した根拠が why に無い`).toBe(true);
    }
  });

  it("判定不能はその理由が導出できる (結線されていない)", () => {
    const undecidable = [...SCRIPT_GATES, ...WORKFLOWS].filter((entry) => entry.grade === "判定不能");
    expect(undecidable.length).toBeGreaterThan(0);
    for (const entry of undecidable) {
      // 「見たが決められない」を許すのは、CI 上で合否を作る場面が無い場合だけ。
      // 結線されたゲートを判定不能へ逃がすことはできない
      expect(entry.runsOn, `${entry.file} は結線されているので等級を確定すること`).toBe("unwired");
      expect(entry.why).toMatch(/判定不能/);
    }
  });

  it("枠外はゲートを含まない workflow に限る", () => {
    for (const workflow of WORKFLOWS) {
      expect(workflow.grade === "枠外", `${workflow.file} の枠外判定と isGate が矛盾している`).toBe(!workflow.isGate);
    }
  });

  it("等級を空にできない (null / undefined を型でも実体でも許さない)", () => {
    const allowed: Grade[] = [0, 1, 2, 3, 4, "判定不能", "枠外"];
    for (const entry of [...SCRIPT_GATES, ...WORKFLOWS]) {
      expect(allowed, `${entry.file} の等級が未定義`).toContain(entry.grade);
    }
  });

  it("是正進行中の項目は参照先 commit を挙げ、等級は本ブランチの現物に対して付ける", () => {
    const remediating = [...SCRIPT_GATES, ...WORKFLOWS].filter((entry) => entry.issue === "remediating");
    expect(remediating.length).toBeGreaterThan(0);
    for (const entry of remediating) {
      expect(/\b[0-9a-f]{7,40}\b/.test(entry.why), `${entry.file} に是正 commit の参照が無い`).toBe(true);
      expect(typeof entry.grade, `${entry.file} は是正中でも等級を確定させる`).toBe("number");
    }
  });
});

describe("等級2 下位型 scope-self-derived は導出できる主張に限る", () => {
  it("該当を主張する項目には導出器があり、実際に取りこぼしが在る", () => {
    const claimed = SCRIPT_GATES.filter((gate) => gate.scopeSelfDerived);
    expect(claimed.length).toBeGreaterThan(0);
    for (const gate of claimed) {
      const prove = SCOPE_SELF_DERIVED_PROOFS[gate.file];
      expect(prove, `${gate.file} の走査範囲欠落を導出する関数が無い`).toBeDefined();
      expect(prove(), `${gate.file} は走査範囲を覆っている。下位型の主張を取り下げること`).toBe(true);
      expect(gate.why).toMatch(/scope-self-derived/);
    }
  });

  it("導出器を置いたのに主張していない項目が無い", () => {
    // 導出器だけ残って分類が消える (逆に主張だけ残って導出器が消える) のを防ぐ
    const claimed = new Set(SCRIPT_GATES.filter((gate) => gate.scopeSelfDerived).map((gate) => gate.file));
    expect(Object.keys(SCOPE_SELF_DERIVED_PROOFS).filter((file) => !claimed.has(file))).toEqual([]);
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
    const uninspected = workflowFilesOnDisk().filter((file) => !inspected.includes(file));

    // 網羅対象がハードコード列挙である限り、workflow を足しても検査は増えない。
    // 是正されて全ファイルを走査する形になったら、この期待も更新すること
    expect(uninspected.length, "検査対象が全 workflow を覆うようになったなら棚卸しを更新すること").toBeGreaterThan(0);
    expect(inspected.length).toBeLessThan(workflowFilesOnDisk().length);
  });
});

describe("Issue 起票対象が棚卸しから決まる", () => {
  it("未是正の等級2-4 だけが open である", () => {
    for (const entry of [...SCRIPT_GATES, ...WORKFLOWS]) {
      if (entry.issue !== "open") continue;
      expect(
        typeof entry.grade === "number" && entry.grade >= 2,
        `${entry.file} を open にするなら等級2-4 であること`,
      ).toBe(true);
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
