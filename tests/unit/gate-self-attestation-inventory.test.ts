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
 *   3. 欠陥の導出 (unpairedContinueOnError / workflowInspectionScope / defect)
 *      等級1 以上と判定した項目は、その欠陥が **本ブランチの現物に今も在る**
 *      ことを正規表現で示す。是正が統合されたら一致しなくなり、テストが落ちて
 *      再分類が強制される。「是正中だから保留」で等級を空にしない。
 *
 *      抽出器は Observation を返す。空集合には「本当に無い」と「抽出器が現物を
 *      追えなくなった」の 2 つの意味があり、後者を合格として読ませないためである
 *      (2026-08-12 実測: workflowFilesReadBy が readNormalized だけを見ていたため、
 *      backend が workflowSource へ置換した木では抽出 0 件になり、『覆っていない』
 *      という主張が空集合のまま緑で通った)。抽出 0 件は「覆っていないことを確認
 *      した」ではなく「観測に失敗した」であり、必ず失敗として扱う。
 *
 *      再分類の後も見張りは続く (fixEvidence)。`fixed` へ落とすと `defect` を外す
 *      ので、その行を木と突き合わせる経路が 1 本も無くなり、main 側の是正が revert
 *      されても表は「直った」と言い続ける——それは等級1 そのものである。よって
 *      `fixed` には「一致し**続ける**こと」を要求する裏返しの証拠を持たせ、
 *      退行が赤として現れるようにしてある。
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
 *     だけは scope-self-derived として下位型に持つ (CTO 提案 2026-08-12 のうち A)。
 *     偽 FAIL 側の亜種 B・C は捨てずに DESIGN_MISMATCHES へ **等級列を持たない
 *     別表** として残す (CTO 裁定 2026-08-12)。
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

/**
 * 抽出器の戻り値。「何を観測したか」と「そもそも観測できたか」を分けて持つ。
 *
 * 正規表現で現物から欠陥を数える抽出器は、対象の書き方が変わると静かに 0 件を
 * 返す。0 件を「欠陥が無い」と読むと、抽出器が壊れた瞬間に検査が緑になる ——
 * これは本テストが等級2 (検査経路の閉塞) として摘発している欠陥と同じ形である。
 * よって抽出器は 0 件の意味を自分で言えなければならない。
 */
type Observation<T> = {
  /** false = 抽出器が現物の形を追えていない。value を結論の根拠にしてはならない */
  observed: boolean;
  /** 追えなかった理由。observed が true なら空文字 */
  blindSpot: string;
  value: T;
};

const observed = <T>(value: T): Observation<T> => ({ observed: true, blindSpot: "", value });
const blind = <T>(blindSpot: string, value: T): Observation<T> => ({ observed: false, blindSpot, value });

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
  /**
   * 是正が本ブランチの現物へ着地済み。`none` (最初から是正不要) とは区別する。
   *
   * この状態が要る理由: 着地を `none` へ畳むと「欠陥が在ったが直った」と
   * 「そもそも欠陥が無い」が同じ表記になり、等級を下げた判断の根拠が消える。
   * 2026-08-12 に実際に 4 件が「別ブランチで是正中 (未マージ)」のまま腐った
   * ——着地を書き戻す先が型に無かったことがその一因である。
   * `fixed` は是正 commit を why に名指すことを下のアサーションで強制する。
   */
  | "fixed"
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
  /**
   * `issue: "fixed"` のとき、**是正が本ブランチの現物に在る**ことを示す証拠。
   *
   * これが要る理由: `fixed` へ落とすと `defect` を外すので、欠陥側の見張りが消える。
   * その状態で main 側の修正が revert されると、この表は「直った」と言い続ける。
   * つまり `fixed` は放っておくと**申告**へ退化する——この表が等級1 と呼んでいるものそのものだ。
   *
   * `defect` の裏返しとして、`fixEvidence.pattern` が現物に**一致し続けること**を要求する。
   * 是正が消えれば pattern も消えるので、退行はテストの赤として現れる。
   */
  fixEvidence?: Defect;
  // 等級2 の下位型 scope-self-derived はここに真偽を持たない。
  // 現物から導出できる主張を散文や真偽値で固定すると、是正が入っても言い張れて
  // しまう (2026-08-12: 実際に偽になった)。供給元は SCOPE_SELF_DERIVED_PROOFS だけ。
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
    why:
      "requireText による文言の部分一致で workflow の内容を検査している。" +
      "SHA ピン検査の走査範囲が全 workflow を覆っているかは散文で主張せず、" +
      "SCOPE_SELF_DERIVED_PROOFS が現物から導出する (Issue #133 として起票済み)",
    signals: { substringDominant: true, probesExternal: false, probesFs: false },
    runsOn: "pr",
    notRunMeans: "",
  },
  {
    file: "scripts/tools/check-neon-backup-evidence.js",
    grade: 1,
    issue: "open",
    why: "restoreDrillStatus が \"success\" かどうかを文字列比較するだけで (235-237 行)、その値に出所の裏づけが無い。#126/#127 の是正は 7f72626 (PR #137) で main へ着地し、PITR 保持期間は measured のみ受理へ、pgDumpStatus は lastPgDumpStatusSource が artifact-stat: で始まることの検査へ変わった (245-247 行)。しかし restoreDrillStatus には対になる Source が create 側でも書かれず (create-neon-backup-evidence.js 294 行は pgDump のみ)、check 側でも検査されない。等級1 の根拠はこの一点へ絞られる",
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
    grade: 0,
    issue: "fixed",
    why: "7f72626 (PR #137, backend e199e64 由来。#126/#127) が main へ着地し、合格側の既定値が撤去された。restoreDrillStatus は未指定なら throw し (278 行)、pgDumpStatus も --pg-dump-file が無ければ throw する (267 行)。\"success\" が入るのは artifact-stat で実測できた場合だけで、既定値による検査経路の閉塞は現物から消えている",
    signals: { substringDominant: false, probesExternal: false, probesFs: true },
    runsOn: "scheduled",
    notRunMeans:
      "neon-backup.yml の定期実行でしか走らない。PR では評価されないため、既定値の撤去が本当に効いているかは次の定期実行まで確認できない",
    fixEvidence: {
      pattern: /there is no default outcome/,
      means: "既定値の不在が throw のメッセージとして現物に在る。既定値を戻せばこの文言も消える",
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
    grade: 0,
    issue: "fixed",
    why: "7f72626 (PR #137, backend e199e64 由来。#128) が main へ着地し、期待する形式を EVIDENCE_FORMATS としてチェッカ側へピン留めした (137 行)。実測: MONITORING_ENV_KEYS 7 件はすべて EVIDENCE_FORMATS 8 件に含まれ、`ok` の 2 文字はどのキーでも通らない。⚠ 残る穴は evidenceFormatState の `if (!spec) return presence` (288 行) で、spec の無いキーを足すと存在検査だけへ静かに退化する。現時点で該当キーは無いが、この包含関係を現物から導出する検査は未整備",
    signals: { substringDominant: false, probesExternal: false, probesFs: true },
    runsOn: "dispatch-only",
    notRunMeans:
      "ci.yml の production-target-env job (if: workflow_dispatch) にしか結線されていない。#128 の形式ゲートは現状この job 経由でしか動かないため、workflow_dispatch を叩かない限り証跡の形式は一度も検査されない。是正が入っても、走らない間はその是正も効いていない",
    fixEvidence: {
      pattern: /"✅ set \(recorded, format checked\)"/,
      means:
        "合格の表示自体が『形式を検査した』と述べる分岐に在る。存在確認だけの旧経路へ戻すとこの文言が消える",
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
    grade: 0,
    issue: "fixed",
    why: "7f72626 (PR #137, backend e199e64 由来。#129) が main へ着地し、csp.includes の羅列を csp-contract.js の evaluateCspHeaders による契約検証へ置換した (requireCspContract, 81-83 行)。現物に csp.includes は 1 箇所も無い。ディレクティブ単位で過不足を出すため、列挙外の緩和 (未知ディレクティブの追加、許可元の差し替え) も検知する",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
    runsOn: "pr",
    notRunMeans: "",
    fixEvidence: {
      pattern: /evaluateCspHeaders\(/,
      means: "契約検証器の呼び出しが現物に在る。csp.includes の羅列へ戻せばこの呼び出しが消える",
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
    grade: 0,
    issue: "fixed",
    why: "T-B7 の是正が 7f72626 (PR #137) で main へ着地し、evidenceDefaults による穴埋めが撤去された。resolveEvidenceEnv (125 行) は EVIDENCE_ENV_KEYS の欠落を全件集めて throw し、『スクリプトが供給した値はリリース報告書に検証済み証跡として載ってしまう』ことを拒否理由として明示している。等級2 とした続行経路は現物から消えている",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
    runsOn: "unwired",
    notRunMeans:
      "workflow からは呼ばれず、人が手で実行する本番デプロイ経路。CI で一度も実行されないため、この検証分岐の退行はデプロイ当日まで現れない",
    fixEvidence: {
      pattern: /missing required production evidence env/,
      means: "欠落を拒否理由として述べる throw が現物に在る。既定値で穴埋めする経路へ戻せば消える",
    },
  },
  {
    file: "scripts/deploy/deploy-mvp.mjs",
    grade: 0,
    issue: "none",
    why: "MVP公開環境 (codip-mvp.mirai-dx-platform.com) のデプロイパイプライン。resolveMvpEnv は必須クレデンシャル欠落を全件集めて throw し、DNS 計画は cloudflare-dns-record-policy.mjs の純関数へ委譲する。本番 deploy-production.mjs と同型の運用スクリプトであり、証跡の受理判定を独自に持たない",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
    runsOn: "unwired",
    notRunMeans:
      "workflow からは呼ばれず、人が手で実行する MVP デプロイ経路。CI で一度も実行されないため、この分岐の退行はデプロイ当日まで現れない",
  },
  {
    file: "scripts/tools/review-role-assignments.js",
    grade: 2,
    issue: "open",
    why: "期限切れ・期限間近のロール割当を DB から実測して --strict で合否を返せるが、既定は strict=false で、package.json の ops:review-roles は --strict を渡さず、どの workflow からも起動されていない。検査経路が閉塞しており、期限切れ割当があっても CI のどこからも失敗として現れない",
    signals: { substringDominant: false, probesExternal: true, probesFs: false },
    runsOn: "unwired",
    notRunMeans:
      "CI に結線されていないため、ロール割当の期限切れ・期限間近は人が手で ops:review-roles を実行するまで検知されない",
    defect: {
      pattern: /strict: false/,
      means: "既定 strict=false を呼び出し側 (npm script / workflow) が上書きしておらず、期限切れ割当でも合否が失敗にならない",
    },
  },
];

/**
 * ゲートではないもの。理由を必ず持たせ、除外そのものを監査可能にする。
 *
 * `arrivesWith` は「他ブランチに在るが本ブランチにはまだ無い」ファイル用の欄。
 * 分類を統合後まで先送りすると、統合した瞬間に未分類として落ちて統合作業を止める。
 * かといって恒久的に猶予すると、消えたファイルの分類が亡霊として残り続ける。
 * よって期限を持たせ、`until` を過ぎたら落ちる —— 猶予であって緩和ではない
 * (時限付き allowlist。check-dependency-audit.js の expires と同じ型)。
 */
type NonGate = {
  file: string;
  why: string;
  arrivesWith?: { ref: string; until: string };
};

const NON_GATES: readonly NonGate[] = [
  {
    file: "scripts/tools/csp-contract.js",
    why:
      "CSP 期待値のリテラル定義とヘッダ評価関数のライブラリ。合否を作るのは呼び出し側 " +
      "(release-smoke.js / tests/e2e/csp-contract.spec.ts) であり、このファイル自体は証跡を受理・棄却しない。" +
      "devDependencies 無しで読めるよう素の CommonJS で書かれている点も、ライブラリとしての位置づけを裏づける",
    // arrivesWith は 7f72626 (PR #137) / PR #131 で main へ到着したため撤去した。
    // 上の docblock の規則どおり、到着した時点で猶予は役目を終える。
  },
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

/**
 * 等級列を持たない別表 (CTO 裁定 2026-08-12)。
 *
 * 4 等級は「合否の作り方が甘い」側 —— 偽 PASS —— の順序尺度である。ここに挙げる
 * のは反対側、つまり検査は厳密なのに測っている対象が意図とずれていて、正しい
 * 成果物を落とす型 (偽 FAIL) である。原因が別なので等級を付けると大小関係が
 * 壊れるが、実在するので消しもしない。
 *
 * 亜種の区別:
 *   B = 測定対象の取り違え。検査そのものは正しく動いている
 *   C = 検査の粒度が対象の粒度と合っていない
 */
type DesignMismatch = {
  id: string;
  subtype: "B" | "C";
  what: string;
  /** いつ・どこで実際に観測したか。机上の懸念をここへ書かない */
  observed: string;
  /** 再発時に何が気づかせるか */
  guard: string;
};

const DESIGN_MISMATCHES: readonly DesignMismatch[] = [
  {
    id: "graded-on-a-tree-that-already-has-the-fix",
    subtype: "B",
    what:
      "等級表の defect 正規表現を、是正 commit が既に載っている木で評価すると不一致になり FAIL する。" +
      "検査は正しく『この木には欠陥が無い』と言っているが、統合経路に載る木はそれではないため、" +
      "その FAIL に従って等級を下げると逆に偽になる",
    observed:
      "2026-08-12 CTO 実測。backend tip 93c6a6d 上で create-neon-backup-evidence.js の行が FAIL したが、" +
      "原因は §17 決裁待ちで着地しない T-B4 (6257ed2) が同じ木に載っていたこと。" +
      "codeql.yml も同じ形 (3088c3d が同じ木に在る)",
    guard:
      "等級は必ず『どの木で測ったか』とセットで読む。統合前の他ブランチ tip で測った FAIL は、" +
      "その commit が実際に統合経路へ載るかを確かめるまで是正の根拠にしない",
  },
  {
    id: "file-granularity-vs-check-granularity",
    subtype: "C",
    what:
      "runsOn / grade はファイル単位でしか持てないが、実際の実行条件と検査品質はスクリプト内の" +
      "検査モード単位で変わる。同じファイルが PR で走る経路と dispatch でしか走らない経路の両方を持つ場合、" +
      "ファイル単位の分類はどちらかを必ず取りこぼす",
    observed:
      "2026-08-12 棚卸し時。production-evidence-report.js が該当し、#128 の形式ゲートが" +
      "dispatch-only 側にだけ結線されている",
    guard: "「実行条件はファイル単位であり、検査モード単位ではない」テストが、取りこぼす側の存在を明示的に固定している",
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
  /**
   * 他ブランチで是正済みの commit。本ブランチの現物から欠陥が消えていた場合に、
   * 「なぜ等級表がまだ欠陥を載せているのか」を答えられるようにするための欄。
   * 欠陥が現物に在る間は等級側が根拠になるので、この欄だけでは何も主張しない。
   */
  remediatedBy?: string;
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
    grade: 0,
    issue: "fixed",
    why:
      "かつては analyze ステップが continue-on-error: true で、その outcome を見て落とし直すステップが" +
      "無かった。解析自体が失敗してもジョブは緑になり、『CodeQL が走った』が反証不能だった。" +
      "Issue #132 として起票し、7f72626 (PR #137, backend 3088c3d 由来) が analyze から " +
      "continue-on-error を撤去する契約へ反転させて main へ着地した。現物の continue-on-error は 0 件。" +
      "⚠ 別問題として upload: never (Issue #139 / ADR 0003) のため SARIF は code scanning へ流れず " +
      "CI artifact に留まる。所見件数の門は codeql-findings (PR #143) 側の担当で、この行の対象外",
    isGate: true,
    runsOn: "pr",
    notRunMeans: "",
    remediatedBy: "7f72626",
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
  {
    file: ".github/workflows/sla-monitor.yml",
    grade: "枠外",
    issue: "none",
    why: "枠外。SLA 鮮度監視とウォッチリスト通知ダイジェストの発行を行う運用バッチであり、証跡を受理・棄却するマージゲートを含まない (isGate === false)。continue-on-error は SLA/通知の結果を digest Issue と artifact に残すためのもので、結果によるジョブの成否は作らない",
    isGate: false,
    runsOn: "scheduled",
    notRunMeans:
      "定期実行と workflow_dispatch でのみ動く。SLA 違反と通知ダイジェストは次の定期実行まで現れない",
  },
  {
    file: ".github/workflows/load-test.yml",
    grade: "枠外",
    issue: "none",
    why: "枠外。k6 による負荷測定の手動実行バッチであり、証跡を受理・棄却するマージゲートを含まない (isGate === false)。入力検証 (max_vus) は実行時に入力が不正なら失敗するだけ",
    isGate: false,
    runsOn: "dispatch-only",
    notRunMeans:
      "workflow_dispatch でのみ動く。負荷測定は人が明示的に実行したときだけ走り、その失敗は dispatch した時点でしか現れない",
  },
];

// ---------------------------------------------------------------------------
// 4. 欠陥の導出
// ---------------------------------------------------------------------------

/**
 * `continue-on-error: true` を持ちながら、後続で outcome を見て落とし直す
 * ステップが無いものを列挙する。これがあるとジョブは構造的に失敗し得ない (等級2)。
 *
 * 空集合ハザード対策: `continue-on-error` という語の出現数 (粗い指標) と、
 * `true` / `false` のリテラルとして読めた行数 (精密な指標) を突き合わせる。
 * 両者が一致しなければ、書式変更や式による指定で述語が現物を追えていない状態
 * なので、空集合を「欠陥なし」の証拠にせず観測失敗として返す。
 */
export function unpairedContinueOnError(yaml: string): Observation<string[]> {
  // 「言及」はキーとして現れた行だけを数える。コメント行や説明文に単語として
  // 出てくる "continue-on-error" は YAML の指定ではないため、式形式の検出に
  // 混ぜると production-smoke.yml の説明コメントだけで観測失敗に落ちる。
  const keyForm = /^\s*(?:-\s+)?continue-on-error:/gm;
  const mentions = (yaml.match(keyForm) ?? []).length;
  const readable = (yaml.match(/^\s*(?:-\s+)?continue-on-error:\s*(?:true|false)\s*$/gm) ?? []).length;
  if (mentions !== readable) {
    return blind(
      `continue-on-error の言及 ${mentions} 件に対し true/false のリテラルとして読めたのは ${readable} 件。` +
        "書式が変わったか値が式で与えられている。空集合を『対で使われている』の証拠にしてはならない",
      [],
    );
  }

  const lines = yaml.split("\n");
  const unpaired: string[] = [];

  lines.forEach((line, index) => {
    if (!/^\s*continue-on-error:\s*true\s*$/.test(line)) return;

    // 直前のステップ開始 (`- ` 始まり) まで遡って id を探す
    let stepId: string | null = null;
    for (let cursor = index; cursor >= 0; cursor -= 1) {
      const current = lines[cursor];
      // `- id: foo` (ステップ開始行に id が乗る形) も拾う。取りこぼすと id が在るのに
    // 「誰も参照できない」と読み、対で使っている workflow を欠陥に数えてしまう
    const idMatch = /^\s*(?:-\s+)?id:\s*([\w-]+)\s*$/.exec(current);
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

  return observed(unpaired);
}

/**
 * 検査スクリプトが実際に走査する workflow ファイルの集合を導出する。
 *
 * 対象の指定には 2 つの形があり、両方を見なければ範囲を誤る。
 *   1. ディレクトリ列挙 — その場に何ファイルあっても全件が対象になる
 *   2. 名指し — 列挙されたものだけが対象になる
 *
 * 名指しのヘルパー名は変わり得る (実例: readNormalized → workflowSource)。
 * 名前を並べて追随させるだけでは、次に変わったとき静かに 0 件へ落ちる。
 * よって「1 件も抽出できない」は空集合ではなく観測失敗として返す。
 */
export function workflowInspectionScope(source: string, onDisk: readonly string[]): Observation<string[]> {
  if (/readdirSync\([\s\S]{0,80}?(?:WORKFLOW_DIR|\.github\/workflows)/.test(source)) {
    return observed([...onDisk].sort());
  }

  const named = [
    ...source.matchAll(/(?:readNormalized|workflowSource)\("(\.github\/workflows\/[\w.-]+)"\)/g),
  ].map((match) => match[1]);
  const unique = [...new Set(named)].sort();

  if (unique.length === 0) {
    return blind(
      "workflow ファイルへの参照を 1 件も抽出できない。ディレクトリ列挙も名指しも見つからず、" +
        "抽出器が現物の書き方を追えていない。空集合を『覆っていない』の証拠に使ってはならない",
      [],
    );
  }
  return observed(unique);
}

/**
 * 等級2 下位型 scope-self-derived の導出器。
 *
 * 「検査範囲を期待値から導出している」検査は、経路が開いていても範囲外が
 * 構造的に見えない。散文で下位型を主張すると等級1 になるので、該当の有無は
 * ここでの導出だけを供給元とし、棚卸しのエントリ側へ真偽を書き込まない。
 *
 * `positiveSample` / `negativeSample` は導出器そのものへの変異入力である。
 * 現物の状態は統合の進み方で変わるため、「実際に取りこぼしが在る」を非空虚性の
 * 根拠にすると、是正が入った瞬間に検査が空虚化する。合成入力で両方の答が出せる
 * ことを要求すれば、非空虚性はブランチの状態から独立する。
 */
type ScopeProof = {
  /** 対象ソースから、実際に走査される集合を導出する */
  scopeOf: (source: string, universe: readonly string[]) => Observation<string[]>;
  /** 覆うべき母集合 */
  universe: () => string[];
  /** 取りこぼしと判定されなければならない合成入力 */
  positiveSample: (universe: readonly string[]) => string;
  /** 覆っていると判定されなければならない合成入力 */
  negativeSample: (universe: readonly string[]) => string;
  /** 観測失敗と判定されなければならない合成入力 */
  blindSample: (universe: readonly string[]) => string;
};

const SCOPE_SELF_DERIVED_PROOFS: Record<string, ScopeProof> = {
  "scripts/tools/check-github-actions-contract.js": {
    scopeOf: workflowInspectionScope,
    universe: workflowFilesOnDisk,
    positiveSample: (universe) => `const source = workflowSource(${JSON.stringify(universe[0])});`,
    negativeSample: () => `fs.readdirSync(path.join(root, WORKFLOW_DIR), { withFileTypes: true })`,
    blindSample: () => `const sources = collectWorkflows({ dir: WORKFLOW_DIR });`,
  },
};

/**
 * 走査範囲を期待値から導出しているか。観測できなければ真偽を答えない。
 */
function scopeSelfDerivedOf(file: string): Observation<boolean> {
  const proof = SCOPE_SELF_DERIVED_PROOFS[file];
  if (!proof) return blind(`${file} に走査範囲の導出器が無い`, false);
  const universe = proof.universe();
  const scope = proof.scopeOf(read(file), universe);
  if (!scope.observed) return blind(scope.blindSpot, false);
  return observed(scope.value.length < universe.length);
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
    // 亡霊 = 削除済みファイルの分類が残っている状態。統合待ちのものは期限付きで除く
    const pending = new Set(NON_GATES.filter((entry) => entry.arrivesWith).map((entry) => entry.file));
    expect(accounted.filter((file) => !onDisk.includes(file) && !pending.has(file))).toEqual([]);
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

  it("統合待ちの分類は期限を持ち、期限内であり、到着したら猶予が外れる", () => {
    const today = new Date().toISOString().slice(0, 10);
    for (const entry of NON_GATES) {
      if (!entry.arrivesWith) continue;
      expect(entry.arrivesWith.ref.length, `${entry.file} に到着元の参照が無い`).toBeGreaterThan(5);
      expect(entry.arrivesWith.until).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      // 期限切れ = 統合が来ないまま分類だけが残っている。猶予を無期限にしない
      expect(
        entry.arrivesWith.until >= today,
        `${entry.file} の統合待ち猶予が ${entry.arrivesWith.until} で切れている。` +
          "到着していないなら分類を外し、到着したなら arrivesWith を外すこと",
      ).toBe(true);
      // 到着後にこの欄が残っていても分類そのものは通常どおり検査される
      // (亡霊検知が空振りするだけで、未分類検知と除外理由の検査は効いている)。
      // 残骸を掃除させる強制力は until が持つ
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

    // 一覧に溜めてから表明する。for 内で expect を呼ぶと最初の失敗で中断し、
    // 後続の腐った行が隠れる。2026-08-12 に実測: 1 件が報告された時点で止まり、
    // 実際には 3 件が腐っていた。「落ちた 1 件を直したら緑になった」で終わると
    // 残り 2 件は宣言のまま生き残る
    const unsupported: string[] = [];
    const gone: string[] = [];
    for (const gate of graded) {
      if (gate.signals.substringDominant) continue;
      if (!gate.defect || gate.defect.means.length <= 10) {
        unsupported.push(gate.file);
        continue;
      }
      if (!gate.defect.pattern.test(read(gate.file))) {
        gone.push(`${gate.file}: ${gate.defect.means}`);
      }
    }
    expect(unsupported, "等級1 以上とする根拠 (defect) が導出できない").toEqual([]);
    expect(
      gone,
      "欠陥が現物に一致しない。是正済みなら issue を fixed にし、等級を付け直すこと",
    ).toEqual([]);
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
    // 件数の下限は置かない。`remediating` が 0 件なのは正常な状態 (全部着地した) であり、
    // 「1 件以上あること」を要求すると、全件が着地したときにこの検査自体が赤になって、
    // 腐った行を 1 件わざと残す動機を作ってしまう。空虚さは下の 2 本が別経路で塞ぐ
    for (const entry of [...SCRIPT_GATES, ...WORKFLOWS].filter((e) => e.issue === "remediating")) {
      expect(/\b[0-9a-f]{7,40}\b/.test(entry.why), `${entry.file} に是正 commit の参照が無い`).toBe(true);
      expect(typeof entry.grade, `${entry.file} は是正中でも等級を確定させる`).toBe("number");
    }
  });

  it("「未マージ」と書けるのは remediating だけで、着地したなら着地先を名指す", () => {
    // これが要る背景: 「別ブランチで是正中 (未マージ)」と書いた行を、統合後に誰も
    // 書き戻さなかった。squash merge で元 commit hash が main に無くなるため、
    // 「hash を挙げている」だけでは腐りを検知できない。文言そのものを状態へ縛る
    const stale: string[] = [];
    const unsourced: string[] = [];
    const stillAccused: string[] = [];

    for (const entry of [...SCRIPT_GATES, ...WORKFLOWS]) {
      const claimsPending = /未マージ|未統合|本ブランチに(?:は)?(?:まだ)?無い/.test(entry.why);
      if (claimsPending && entry.issue !== "remediating") {
        stale.push(`${entry.file} (issue: ${entry.issue})`);
      }
      if (entry.issue !== "fixed") continue;
      if (claimsPending || !/\b[0-9a-f]{7,40}\b/.test(entry.why)) {
        unsourced.push(entry.file);
      }
    }
    // fixed なのに欠陥の証拠を持ち続けている = 直ったと言いながら告発も続けている
    for (const gate of SCRIPT_GATES) {
      if (gate.issue === "fixed" && gate.defect) stillAccused.push(gate.file);
    }

    expect(stale, "着地したのに『未マージ』のまま残っている。着地先を名指して issue を更新すること").toEqual([]);
    expect(unsourced, "fixed にするなら着地した commit を why で名指すこと").toEqual([]);
    expect(stillAccused, "fixed と defect は両立しない。どちらが現物かを決めること").toEqual([]);
  });

  /**
   * `fixed` を測る側の検査。
   *
   * `fixed` へ落とすと `defect` を外すので、その行を木と突き合わせる経路が 1 本も無くなる。
   * その状態で main 側の是正が revert されても、この表は「直った」と言い続ける——
   * それは本ファイルが等級1 (自己申告) と呼んでいるものそのものだ。
   * `fixEvidence` は `defect` の論理的裏返し (「一致してはならない」→「一致し続けよ」) で、
   * 退行が赤として現れることを保証する。
   *
   * WORKFLOWS は対象外。`remediatedBy` と codeql.yml 用の動的アサーション
   * (continue-on-error を現物から数える) が既に同じ役目を果たしている。
   */
  it("fixed は是正が現物に在ることを示し、退行すれば落ちる", () => {
    const fixed = SCRIPT_GATES.filter((gate) => gate.issue === "fixed");
    expect(fixed.length, "fixed が 1 件も無い。行を落としていないか").toBeGreaterThan(0);

    const undeclared: string[] = [];
    const regressed: string[] = [];
    for (const gate of fixed) {
      if (!gate.fixEvidence || gate.fixEvidence.means.length <= 10) {
        undeclared.push(gate.file);
        continue;
      }
      // 一覧で落とす。for 内 expect は最初の失敗で中断し、後続の退行を隠す
      if (!gate.fixEvidence.pattern.test(read(gate.file))) {
        regressed.push(`${gate.file}: ${gate.fixEvidence.means}`);
      }
    }
    expect(undeclared, "fixed にするなら是正が現物に在る証拠を挙げること").toEqual([]);
    expect(
      regressed,
      "是正が現物から消えている。退行なら issue と等級を戻し、意図的な書き換えなら fixEvidence を更新すること",
    ).toEqual([]);
  });
});

describe("等級2 下位型 scope-self-derived は現物から導出する", () => {
  const proofFiles = Object.keys(SCOPE_SELF_DERIVED_PROOFS);

  it("導出器の対象が棚卸しに載っている", () => {
    expect(proofFiles.length).toBeGreaterThan(0);
    for (const file of proofFiles) {
      expect(SCRIPT_GATES.map((gate) => gate.file), `${file} の導出器だけ在って分類が無い`).toContain(file);
    }
  });

  it.each(proofFiles)("%s の走査範囲を観測できる", (file) => {
    // 観測できない状態を「覆っていない」とも「覆っている」とも読ませない。
    // これが 2026-08-12 に緑のまま主張が偽になった経路そのものである
    const derived = scopeSelfDerivedOf(file);
    expect(derived.observed, derived.blindSpot).toBe(true);
  });

  it.each(proofFiles)("%s の導出器は合成入力で答を変える (定数化していない)", (file) => {
    // 非空虚性を現物の状態に頼ると、是正が統合された瞬間に検査が空虚化する。
    // 導出器そのものへ変異入力を与えて、両方の答が出せることを要求する
    const proof = SCOPE_SELF_DERIVED_PROOFS[file];
    const universe = proof.universe();
    expect(universe.length, "母集合が 1 件以下では取りこぼしを作れない").toBeGreaterThan(1);

    const shortfall = proof.scopeOf(proof.positiveSample(universe), universe);
    expect(shortfall.observed, `positiveSample を観測できない: ${shortfall.blindSpot}`).toBe(true);
    expect(shortfall.value.length, "名指し 1 件の入力を『覆っている』と判定した").toBeLessThan(universe.length);

    const full = proof.scopeOf(proof.negativeSample(universe), universe);
    expect(full.observed, `negativeSample を観測できない: ${full.blindSpot}`).toBe(true);
    expect(full.value.length, "ディレクトリ列挙の入力を『取りこぼし』と判定した").toBe(universe.length);

    const unreadable = proof.scopeOf(proof.blindSample(universe), universe);
    expect(unreadable.observed, "追えない書き方を観測できたことにしている").toBe(false);
    expect(unreadable.blindSpot.length).toBeGreaterThan(10);
  });

  it.each(proofFiles)("%s が該当するなら等級2 以上である", (file) => {
    const derived = scopeSelfDerivedOf(file);
    expect(derived.observed).toBe(true);
    if (!derived.value) return;
    const gate = SCRIPT_GATES.find((entry) => entry.file === file)!;
    expect(typeof gate.grade === "number" && gate.grade >= 2, `${file} は走査範囲を覆っていない`).toBe(true);
  });

  it("該当の真偽を散文や真偽値で固定していない", () => {
    // 現物から導出できる主張を棚卸し側へ書き込むと、是正が入っても言い張れる。
    // 供給元を導出器ひとつに保つ
    for (const gate of SCRIPT_GATES) {
      expect(gate.why, `${gate.file} が下位型の該当を散文で主張している`).not.toMatch(/scope-self-derived/);
    }
  });
});

describe("未是正として報告した欠陥が現物から導出できる", () => {
  it("unpairedContinueOnError は合成入力で対・非対・観測失敗を区別する", () => {
    // 非空虚性を現物へ頼らない。是正が統合されても、この 3 件は形が変わらない
    const unpaired = ["jobs:", "  a:", "    steps:", "      - id: analyze", "        continue-on-error: true"].join("\n");
    const paired = [...unpaired.split("\n"), "      - if: steps.analyze.outcome == 'failure'", "        run: exit 1"].join("\n");
    const expression = ["      - id: analyze", "        continue-on-error: ${{ github.event_name == 'push' }}"].join("\n");

    expect(unpairedContinueOnError(unpaired).value).toEqual(["analyze"]);
    expect(unpairedContinueOnError(paired).value).toEqual([]);
    // 値が式なら true/false として読めない = 対かどうかを答えられない
    expect(unpairedContinueOnError(expression).observed, "式による指定を読めたことにしている").toBe(false);
  });

  it("codeql.yml の等級は現物の continue-on-error 状態と一致する", () => {
    const codeql = WORKFLOWS.find((workflow) => workflow.file === ".github/workflows/codeql.yml")!;
    const unpaired = unpairedContinueOnError(read(codeql.file));
    expect(unpaired.observed, unpaired.blindSpot).toBe(true);

    if (unpaired.value.length > 0) {
      expect(codeql.grade, "analyze が落とし直されないなら等級2").toBe(2);
      expect(codeql.issue, "欠陥が現物に在るのに起票状態が none になっている").not.toBe("none");
      return;
    }
    // 現物から消えている木で評価された場合。等級表は統合経路の木に対して書かれて
    // いるので、是正 commit を名指しできることを要求する (DESIGN_MISMATCHES 亜種B)
    expect(
      codeql.remediatedBy,
      "codeql.yml から欠陥が消えている。是正 commit を remediatedBy へ書くか、等級を付け直すこと",
    ).toBeDefined();
  });

  it("production-smoke.yml は continue-on-error を対で使っている (誤検知しないこと)", () => {
    // この判定が上の合成入力と同じ答になるなら、述語は「continue-on-error があるか」しか
    // 見ていないことになり、証跡を残すための正当な用法まで欠陥に数えてしまう
    const observation = unpairedContinueOnError(read(".github/workflows/production-smoke.yml"));
    expect(observation.observed, observation.blindSpot).toBe(true);
    expect(observation.value).toEqual([]);
  });

  it("unpaired と判定された workflow は棚卸しでも等級2 になっている", () => {
    for (const workflow of WORKFLOWS) {
      if (!workflow.isGate) continue;
      const unpaired = unpairedContinueOnError(read(workflow.file));
      expect(unpaired.observed, `${workflow.file}: ${unpaired.blindSpot}`).toBe(true);
      if (unpaired.value.length > 0) {
        expect(workflow.grade, `${workflow.file} に unpaired continue-on-error がある`).toBe(2);
      }
    }
  });

  it("SHA ピン検査の走査範囲は観測できる形で導出されている", () => {
    const target = "scripts/tools/check-github-actions-contract.js";
    const onDisk = workflowFilesOnDisk();
    const scope = workflowInspectionScope(read(target), onDisk);

    // 抽出 0 件は「覆っていないことを確認した」ではなく「観測に失敗した」。
    // ここを空集合のまま通すと、両方の不等式が成立して主張が偽のまま緑になる
    expect(scope.observed, scope.blindSpot).toBe(true);
    expect(scope.value.length, "走査対象が 1 件も無いのに観測成功と答えている").toBeGreaterThan(0);
    // 覆っているかどうかは主張せず、覆っていない場合だけ等級側へ結び付ける
    expect(scope.value.every((file) => onDisk.includes(file)), "走査対象に現存しない workflow が挙がっている").toBe(true);
  });
});

describe("Issue 起票対象が棚卸しから決まる", () => {
  /**
   * 旧規則は「open にできるのは等級2-4 だけ」だった。等級1 (自己申告) を起票不可に
   * していたのは、当時 1 件も無かったからにすぎない。
   *
   * 2026-08-12 に check-neon-backup-evidence.js が等級1 として残った
   * (restoreDrillStatus に出所の裏づけが無い)。旧規則のままだと、起票するために
   * 等級を 2 へ盛るか、起票を諦めて none へ落とすかの二択になる。どちらも
   * 「等級は現物に対して付ける」という上の原則を破る。
   *
   * よって閾値ではなく**証拠**を条件にした。門は緩んでいない: 等級1 以上の全件が
   * 「欠陥が現物に在る」ことの機械検査 (defect / substringDominant) を通っており、
   * ここで緩んだのは「起票してよい範囲」であって「見落としてよい範囲」ではない。
   */
  it("open にするなら、現物に在る欠陥を名指している", () => {
    const unfounded: string[] = [];
    for (const entry of [...SCRIPT_GATES, ...WORKFLOWS]) {
      if (entry.issue !== "open") continue;
      if (!(typeof entry.grade === "number" && entry.grade >= 1)) {
        unfounded.push(`${entry.file}: 等級が ${String(entry.grade)}`);
      }
    }
    expect(unfounded, "欠陥が無い (等級0 / 判定不能 / 枠外) ものを起票対象にしている").toEqual([]);

    // 等級1 以上であることは「欠陥が現物に在る」ことの検査を通ったことを意味する。
    // その検査が実在することをここでも確かめ、規則が宙に浮かないようにする
    const openGates = SCRIPT_GATES.filter((gate) => gate.issue === "open");
    expect(openGates.length, "open が 1 件も無い。起票対象の検査が空回りしている").toBeGreaterThan(0);
    expect(
      openGates.filter((gate) => !gate.defect && !gate.signals.substringDominant).map((gate) => gate.file),
      "open にするなら欠陥の在処を defect か substringDominant で示すこと",
    ).toEqual([]);
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

describe("設計のずれ (偽 FAIL 側) は等級を持たない別表で管理する", () => {
  it("等級と混ざらない", () => {
    // 4 等級は偽 PASS の順序尺度である。偽 FAIL を同じ列へ入れると大小関係が
    // 意味を失うため、型の上でも等級を持たせない (CTO 裁定 2026-08-12)
    expect(DESIGN_MISMATCHES.length).toBeGreaterThan(0);
    for (const mismatch of DESIGN_MISMATCHES) {
      expect(Object.keys(mismatch).sort()).toEqual(["guard", "id", "observed", "subtype", "what"]);
    }
  });

  it("id が一意で、亜種 B・C の両方が実在する", () => {
    const ids = DESIGN_MISMATCHES.map((mismatch) => mismatch.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(DESIGN_MISMATCHES.map((mismatch) => mismatch.subtype))).toEqual(new Set(["B", "C"]));
  });

  it("机上の懸念ではなく、いつ観測したかを書いている", () => {
    for (const mismatch of DESIGN_MISMATCHES) {
      expect(mismatch.observed, `${mismatch.id} に観測日が無い`).toMatch(/\d{4}-\d{2}-\d{2}/);
      expect(mismatch.what.length, `${mismatch.id} の説明が短すぎる`).toBeGreaterThan(40);
      expect(mismatch.guard.length, `${mismatch.id} に再発時の気づき方が無い`).toBeGreaterThan(20);
    }
  });
});
